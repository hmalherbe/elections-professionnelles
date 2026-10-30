import { Router } from "express";
import { db } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { renderTemplate, type TemplateFields } from "../lib/template.js";
import { wrapEmailHtml } from "../lib/emailLayout.js";
import { sendBrevoEmails, fetchAccountInfo, getBrevoApiKey } from "../services/brevo.js";
import { currentImportId } from "../services/stats.js";
import { getOrgSettings } from "../services/orgSettings.js";
import { buildLogoHtml, buildSocialLinksHtml } from "../lib/socialLinks.js";
import { appendRelanceLog } from "../lib/relanceLog.js";
import {
  insertRelanceTracking,
  listRelanceTracking,
  clearRelanceTracking,
  refreshPendingRelanceTracking,
  getMailSeries,
} from "../services/relanceTracking.js";

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

function templateFieldsFor(r: Recipient): TemplateFields {
  const settings = getOrgSettings();
  return {
    nom: r.nom,
    prenom: r.prenom,
    scrutin1_non_votant: Boolean(r.scrutin1Matched) && !r.scrutin1Votant,
    scrutin2_non_votant: Boolean(r.scrutin2Matched) && !r.scrutin2Votant,
    logo: buildLogoHtml(settings.logoPath),
    reseaux_sociaux: buildSocialLinksHtml(settings.socialLinks),
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
    subject: renderTemplate(String(subject), fields),
    htmlContent: wrapEmailHtml(renderTemplate(String(body), fields)),
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
      subject: renderTemplate(template.subject, fields),
      htmlContent: wrapEmailHtml(renderTemplate(template.body, fields)),
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

export default router;
