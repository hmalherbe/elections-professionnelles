import { Router } from "express";
import { db } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { renderTemplate, buildIfTestCases, type TemplateFields } from "../lib/template.js";
import { wrapEmailHtml } from "../lib/emailLayout.js";
import { sendBrevoEmails, fetchAccountInfo, getBrevoApiKey } from "../services/brevo.js";
import { currentImportId } from "../services/stats.js";
import { getOrgSettings } from "../services/orgSettings.js";
import { buildLogoHtml, buildBannerHtml, buildSocialLinksHtml } from "../lib/socialLinks.js";
import { appendRelanceLog } from "../lib/relanceLog.js";
import {
  insertRelanceTracking,
  listRelanceTracking,
  clearRelanceTracking,
  refreshPendingRelanceTracking,
  getMailSeries,
} from "../services/relanceTracking.js";
import { buildUnsubscribeUrl } from "../lib/unsubscribeToken.js";
import { isOptedOut, listOptOuts, removeOptOut } from "../services/optout.js";

const MAX_TEST_RECIPIENTS = 20;
const DEFAULT_TEST_RECIPIENTS = 3;

function clampTestLimit(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_TEST_RECIPIENTS;
  return Math.min(Math.floor(n), MAX_TEST_RECIPIENTS);
}

const router = Router();
router.use(requireAuth);

router.get("/account", async (_req, res) => {
  const apiKey = getBrevoApiKey();
  if (!apiKey) {
    res.status(400).json({ error: "Clé API Brevo non configurée (onglet Paramètres)." });
    return;
  }
  const info = await fetchAccountInfo(apiKey);
  if (!info) {
    res.status(400).json({ error: "Impossible de récupérer les informations du compte Brevo (clé invalide ?)." });
    return;
  }
  res.json(info);
});

router.get("/templates/email", (_req, res) => {
  const row = db.prepare("SELECT subject, body FROM email_template WHERE id = 1").get() as
    | { subject: string; body: string }
    | undefined;
  res.json(row ?? { subject: "", body: "" });
});

router.put("/templates/email", (req, res) => {
  const { subject = "", body = "" } = req.body ?? {};
  db.prepare(
    `INSERT INTO email_template (id, subject, body, updated_at) VALUES (1, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET subject = excluded.subject, body = excluded.body, updated_at = datetime('now')`
  ).run(String(subject), String(body));
  res.json({ ok: true });
});

interface Recipient {
  nom: string;
  prenom: string;
  mail: string | null;
  scrutin1Matched: number;
  scrutin1Votant: number;
  scrutin2Matched: number;
  scrutin2Votant: number;
}

/**
 * Adhérents croisés par nom/prénom avec les émargements des 2 scrutins
 * nationaux agricoles — nécessaire pour les champs de modèle
 * scrutin1_non_votant / scrutin2_non_votant.
 */
function matchedAdherents(): Recipient[] {
  const id1 = currentImportId("scrutin1");
  const id2 = currentImportId("scrutin2");
  if (id1 == null && id2 == null) return [];
  return db
    .prepare(
      `SELECT a.nom, a.prenom, a.mail,
              MAX(CASE WHEN e1.id IS NOT NULL THEN 1 ELSE 0 END) AS scrutin1Matched,
              MAX(COALESCE(e1.votant, 0)) AS scrutin1Votant,
              MAX(CASE WHEN e2.id IS NOT NULL THEN 1 ELSE 0 END) AS scrutin2Matched,
              MAX(COALESCE(e2.votant, 0)) AS scrutin2Votant
       FROM adherents a
       LEFT JOIN emargements e1 ON e1.nom_norm = a.nom_norm AND e1.prenom_norm = a.prenom_norm AND e1.import_id = ?
       LEFT JOIN emargements e2 ON e2.nom_norm = a.nom_norm AND e2.prenom_norm = a.prenom_norm AND e2.import_id = ?
       GROUP BY a.id`
    )
    .all(id1, id2) as Recipient[];
}

/** Logo du Spelc fédéral (champ {{logo_spelc}}), image fixe (backend/assets),
 * plus de gestion par l'admin (voir Dashboard.tsx, carte "Logo" retirée). */
const SPELC_LOGO_PATH = "/api/assets/logo/spelc.png";

/** Bannière de campagne (champ {{logo_rugby}}), image fixe (backend/assets). */
const RUGBY_BANNER_PATH = "/api/assets/logo/rugby.png";

function templateFieldsFor(r: Recipient): TemplateFields {
  const settings = getOrgSettings();
  const contact = r.mail ? r.mail.trim().toLowerCase() : null;
  return {
    nom: r.nom,
    prenom: r.prenom,
    scrutin1_non_votant: Boolean(r.scrutin1Matched) && !r.scrutin1Votant,
    scrutin2_non_votant: Boolean(r.scrutin2Matched) && !r.scrutin2Votant,
    logo_spelc: buildLogoHtml(SPELC_LOGO_PATH),
    logo_rugby: buildBannerHtml(RUGBY_BANNER_PATH, "Transformez l'essai ! Votez 2 fois Spelc"),
    reseaux_sociaux: buildSocialLinksHtml(settings.socialLinks),
    lien_desinscription: contact ? buildUnsubscribeUrl(contact) : "",
  };
}

/**
 * Une personne est ciblée si elle est retrouvée dans au moins un des 2
 * scrutins et n'y a pas encore voté. Un adhérent absent des 2 listes (nom/
 * prénom non reconnu, ou pas électeur) n'est jamais ciblé.
 */
function needsRelance(r: Recipient): boolean {
  return (Boolean(r.scrutin1Matched) && !r.scrutin1Votant) || (Boolean(r.scrutin2Matched) && !r.scrutin2Votant);
}

function firstNonVotantAdherent(): Recipient | null {
  return matchedAdherents().find(needsRelance) ?? null;
}

/** Destinataire de secours pour l'aperçu quand aucun adhérent non-votant
 * n'est disponible (base vide, ou tout le monde a déjà voté) — l'aperçu
 * reste utilisable pour vérifier la mise en forme du modèle. */
const FICTIONAL_RECIPIENT: Recipient = {
  nom: "Dupont",
  prenom: "Jean",
  mail: "jean.dupont@exemple.fr",
  scrutin1Matched: 0,
  scrutin1Votant: 0,
  scrutin2Matched: 0,
  scrutin2Votant: 0,
};

/** Adhérents réellement dans la situation décrite par `overrides` (mêmes
 * champs booléens que templateFieldsFor) — pour l'aperçu, montrer un rendu
 * authentique avec un nom différent par cas plutôt que toujours le même. */
function recipientsMatchingCase(recipients: Recipient[], overrides: Record<string, boolean>): Recipient[] {
  return recipients.filter((r) => {
    const fields = templateFieldsFor(r);
    return Object.entries(overrides).every(([key, value]) => Boolean(fields[key]) === value);
  });
}

/**
 * Aperçu du mail de relance (contenu actuellement saisi à l'écran, pas
 * forcément encore enregistré) — même pipeline de rendu que l'envoi réel,
 * mais sans aucun envoi. Un cas par condition {{#if ...}} distincte du
 * modèle (voir buildIfTestCases) : pour chaque cas, on cherche un adhérent
 * réellement dans cette situation (recipientsMatchingCase) pour montrer un
 * rendu authentique ; à défaut, on retombe sur le premier adhérent
 * non-votant avec les champs booléens forcés, ou, si aucun n'existe
 * (base vide, ou tout le monde a déjà voté), sur un nom fictif
 * (FICTIONAL_RECIPIENT) pour que l'aperçu reste toujours disponible. Un
 * modèle sans aucun {{#if}} ne produit qu'un seul cas.
 */
router.post("/templates/email/preview", (req, res) => {
  const { subject = "", body = "" } = req.body ?? {};
  const fallbackRecipient = firstNonVotantAdherent() ?? FICTIONAL_RECIPIENT;
  const pool = matchedAdherents();
  const testCases = buildIfTestCases(`${String(subject)}\n${String(body)}`);
  res.json({
    cases: testCases.map(({ label, overrides }) => {
      const recipient = recipientsMatchingCase(pool, overrides)[0] ?? fallbackRecipient;
      const isFictional = recipient === FICTIONAL_RECIPIENT;
      const fields = { ...templateFieldsFor(recipient), ...overrides };
      return {
        label: `${label} — ${recipient.prenom} ${recipient.nom}${isFictional ? " (exemple)" : ""}`,
        subject: renderTemplate(String(subject), fields, "text"),
        html: wrapEmailHtml(renderTemplate(String(body), fields, "html")),
      };
    }),
  });
});

router.post("/templates/email/test", async (req, res) => {
  const { subject = "", body = "" } = req.body ?? {};
  const testEmail = getOrgSettings().testEmail;
  if (!testEmail) {
    res.status(400).json({ error: "Renseigner un mail de test (onglet Paramètres)." });
    return;
  }
  const apiKey = getBrevoApiKey();
  if (!apiKey) {
    res.status(400).json({ error: "Clé API Brevo non configurée (onglet Paramètres)." });
    return;
  }
  const recipient = firstNonVotantAdherent();
  if (!recipient) {
    res.status(400).json({ error: "Aucun adhérent non-votant disponible pour prévisualiser le modèle." });
    return;
  }
  const fields = templateFieldsFor(recipient);
  const result = await sendBrevoEmails({
    apiKey,
    to: [{ email: testEmail, name: `${recipient.prenom} ${recipient.nom}` }],
    subject: renderTemplate(String(subject), fields, "text"),
    htmlContent: wrapEmailHtml(renderTemplate(String(body), fields, "html")),
    tag: "test-modele",
  });
  appendRelanceLog({
    timestamp: new Date().toISOString(),
    campagneTag: "test-modele",
    nom: recipient.nom,
    prenom: recipient.prenom,
    contact: testEmail,
    testMode: true,
    success: result.sent > 0,
  });
  insertRelanceTracking({
    ownerUserId: req.user!.id,
    campagneTag: "test-modele",
    nom: recipient.nom,
    prenom: recipient.prenom,
    contact: testEmail,
    testMode: true,
    sendOk: result.sent > 0,
    messageId: result.messageId,
    errorMessage: result.errorMessage,
  });
  res.json({ sent: result.sent, errors: result.errors, errorMessage: result.errorMessage });
});

/** Nombre de destinataires que toucherait réellement une campagne avec les réglages actuels. */
router.get("/campaigns/preview", (req, res) => {
  const testMode = req.query.testMode === "true";
  const testLimit = clampTestLimit(req.query.testLimit);
  let recipients = (testMode ? matchedAdherents() : matchedAdherents().filter((r) => r.mail)).filter(needsRelance);
  // Jamais de mail à une adresse désinscrite (voir routes/unsubscribe.ts).
  recipients = recipients.filter((r) => !r.mail || !isOptedOut(r.mail.trim().toLowerCase()));
  if (testMode) recipients = recipients.slice(0, testLimit);
  res.json({ recipients: recipients.length });
});

router.post("/campaigns/email", async (req, res) => {
  const { tag, testMode, testLimit } = req.body ?? {};
  const apiKey = getBrevoApiKey();
  if (!apiKey) {
    res.status(400).json({ error: "Clé API Brevo non configurée (onglet Paramètres)." });
    return;
  }
  const template = db.prepare("SELECT subject, body FROM email_template WHERE id = 1").get() as
    | { subject: string; body: string }
    | undefined;
  if (!template) {
    res.status(400).json({ error: "Aucun modèle de mail configuré." });
    return;
  }
  const testEmail = testMode ? getOrgSettings().testEmail : null;
  if (testMode && !testEmail) {
    res.status(400).json({ error: "Renseigner un mail de test (onglet Paramètres)." });
    return;
  }

  let recipients = (testMode ? matchedAdherents() : matchedAdherents().filter((r) => r.mail)).filter(needsRelance);
  // Jamais de mail à une adresse désinscrite (voir routes/unsubscribe.ts).
  recipients = recipients.filter((r) => !r.mail || !isOptedOut(r.mail.trim().toLowerCase()));
  if (testMode) recipients = recipients.slice(0, clampTestLimit(testLimit));

  const campagneTag = (tag ?? "relance") + (testMode ? "-test" : "");
  let sent = 0;
  let errors = 0;
  for (const r of recipients) {
    const fields = templateFieldsFor(r);
    const email = testMode ? String(testEmail) : r.mail!;
    const result = await sendBrevoEmails({
      apiKey,
      to: [{ email, name: `${r.prenom} ${r.nom}` }],
      subject: renderTemplate(template.subject, fields, "text"),
      htmlContent: wrapEmailHtml(renderTemplate(template.body, fields, "html")),
      tag: tag ?? "relance",
    });
    sent += result.sent;
    errors += result.errors;
    appendRelanceLog({
      timestamp: new Date().toISOString(),
      campagneTag,
      nom: r.nom,
      prenom: r.prenom,
      contact: email,
      testMode: Boolean(testMode),
      success: result.sent > 0,
    });
    insertRelanceTracking({
      ownerUserId: req.user!.id,
      campagneTag,
      nom: r.nom,
      prenom: r.prenom,
      contact: email,
      testMode: Boolean(testMode),
      sendOk: result.sent > 0,
      messageId: result.messageId,
      errorMessage: result.errorMessage,
    });
  }

  res.status(201).json({ sent, errors, total: recipients.length });
});

router.get("/tracking/mail", (_req, res) => {
  res.json({ rows: getMailSeries() });
});

router.get("/relance-tracking", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 500, 2000);
  res.json({ rows: listRelanceTracking(limit) });
});

router.post("/relance-tracking/refresh", async (_req, res) => {
  const result = await refreshPendingRelanceTracking();
  res.json(result);
});

router.delete("/relance-tracking", (_req, res) => {
  const deleted = clearRelanceTracking();
  res.json({ deleted });
});

/** Liste des adresses désinscrites (lien {{lien_desinscription}}), pour l'onglet Relances adhérents. */
router.get("/optout", (_req, res) => {
  res.json({ optouts: listOptOuts() });
});

/** Réinscription d'une adresse désinscrite par erreur. */
router.delete("/optout", (req, res) => {
  const contact = (req.query.contact as string) || "";
  if (!contact) {
    res.status(400).json({ error: "Paramètre contact requis." });
    return;
  }
  const ok = removeOptOut(contact);
  res.json({ ok });
});

export default router;
