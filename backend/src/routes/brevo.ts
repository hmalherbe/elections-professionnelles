import { Router } from "express";
import dayjs from "dayjs";
import { db } from "../db/index.js";
import { requireAuth, requireRole, canAccessSpelc } from "../middleware/auth.js";
import { renderTemplate, type TemplateFields } from "../lib/template.js";
import { wrapEmailHtml } from "../lib/emailLayout.js";
import {
  sendBrevoEmails,
  sendBrevoSms,
  fetchAggregatedEmailStats,
  fetchAggregatedSmsStats,
  fetchAccountInfo,
} from "../services/brevo.js";
import { currentImportIds } from "../services/stats.js";
import { getTestContactSettings } from "../services/settings.js";
import { getSpelcSettings, updateSpelcSettings } from "../services/spelcSettings.js";
import { buildLogoHtml, buildSocialLinksHtml, type SocialLinks } from "../lib/socialLinks.js";
import { appendRelanceLog } from "../lib/relanceLog.js";
import {
  insertRelanceTracking,
  listRelanceTrackingByScope,
  refreshPendingRelanceTracking,
} from "../services/relanceTracking.js";
import { normalizeFrenchMobile } from "../lib/phone.js";

const MAX_TEST_RECIPIENTS = 20;
const DEFAULT_TEST_RECIPIENTS = 3;

function clampTestLimit(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_TEST_RECIPIENTS;
  return Math.min(Math.floor(n), MAX_TEST_RECIPIENTS);
}

/** Plafond d'envoi SMS (réel ou test) pour éviter de consommer tous les crédits d'un coup. */
const MAX_SMS_SEND_LIMIT = 500;
const DEFAULT_SMS_SEND_LIMIT = 20;

function clampSmsLimit(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_SMS_SEND_LIMIT;
  return Math.min(Math.floor(n), MAX_SMS_SEND_LIMIT);
}

const router = Router();
router.use(requireAuth);

function spelcAcademie(spelc: string): string | null {
  const row = db.prepare("SELECT academie FROM ref_spelc WHERE spelc = ?").get(spelc) as
    | { academie: string }
    | undefined;
  return row?.academie ?? null;
}

function assertSpelcAccess(req: import("express").Request, res: import("express").Response, spelc: string): boolean {
  if (!canAccessSpelc(req.user!, spelcAcademie(spelc), spelc)) {
    res.status(403).json({ error: "Accès non autorisé à ce Spelc." });
    return false;
  }
  return true;
}

/**
 * Clé API Brevo : gérée par l'admin Spelc concerné pour ses campagnes, ou
 * par l'admin général pour les relances PSA (compte séparé, non rattaché à
 * un Spelc).
 */
router.get("/settings", requireRole("admin_spelc", "admin_general"), (req, res) => {
  const row = db.prepare("SELECT brevo_api_key FROM users WHERE id = ?").get(req.user!.id) as
    | { brevo_api_key: string | null }
    | undefined;
  res.json({ configured: Boolean(row?.brevo_api_key), maskedKey: row?.brevo_api_key ? "••••••••" + row.brevo_api_key.slice(-4) : null });
});

router.put("/settings", requireRole("admin_spelc", "admin_general"), (req, res) => {
  const { apiKey } = req.body ?? {};
  if (!apiKey) {
    res.status(400).json({ error: "apiKey requise." });
    return;
  }
  db.prepare("UPDATE users SET brevo_api_key = ? WHERE id = ?").run(String(apiKey), req.user!.id);
  res.json({ ok: true });
});

/** Crédits mail/SMS restants sur le compte Brevo configuré. */
router.get("/account", requireRole("admin_spelc", "admin_general"), async (req, res) => {
  const user = db.prepare("SELECT brevo_api_key FROM users WHERE id = ?").get(req.user!.id) as {
    brevo_api_key: string | null;
  };
  if (!user.brevo_api_key) {
    res.status(400).json({ error: "Clé API Brevo non configurée." });
    return;
  }
  const info = await fetchAccountInfo(user.brevo_api_key);
  if (!info) {
    res.status(400).json({ error: "Impossible de récupérer les informations du compte Brevo (clé invalide ?)." });
    return;
  }
  res.json(info);
});

router.get("/templates/email", (req, res) => {
  const spelc = req.query.spelc as string;
  if (!spelc || !assertSpelcAccess(req, res, spelc)) return;
  const row = db.prepare("SELECT subject, body FROM email_templates WHERE spelc = ?").get(spelc) as
    | { subject: string; body: string }
    | undefined;
  res.json(row ?? { subject: "", body: "" });
});

router.put("/templates/email", requireRole("admin_spelc", "admin_general"), (req, res) => {
  const spelc = (req.body?.spelc as string) || req.user!.spelc || "";
  if (!spelc || !assertSpelcAccess(req, res, spelc)) return;
  const { subject = "", body = "" } = req.body ?? {};
  db.prepare(
    `INSERT INTO email_templates (spelc, subject, body, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(spelc) DO UPDATE SET subject = excluded.subject, body = excluded.body, updated_at = datetime('now')`
  ).run(spelc, String(subject), String(body));
  res.json({ ok: true });
});

router.get("/templates/sms", (req, res) => {
  const spelc = req.query.spelc as string;
  if (!spelc || !assertSpelcAccess(req, res, spelc)) return;
  const row = db.prepare("SELECT body FROM sms_templates WHERE spelc = ?").get(spelc) as
    | { body: string }
    | undefined;
  res.json(row ?? { body: "" });
});

router.put("/templates/sms", requireRole("admin_spelc", "admin_general"), (req, res) => {
  const spelc = (req.body?.spelc as string) || req.user!.spelc || "";
  if (!spelc || !assertSpelcAccess(req, res, spelc)) return;
  const { body = "" } = req.body ?? {};
  db.prepare(
    `INSERT INTO sms_templates (spelc, body, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(spelc) DO UPDATE SET body = excluded.body, updated_at = datetime('now')`
  ).run(spelc, String(body));
  res.json({ ok: true });
});

/**
 * Réglages propres à un Spelc pour ses relances : logo + réseaux sociaux
 * insérés dans ses modèles de mail, et mail/mobile de test propres à ce
 * Spelc (utilisés en priorité sur le mail/mobile de test global de l'admin
 * général, réservé lui aux relances PSA).
 */
router.get("/spelc-settings", (req, res) => {
  const spelc = req.query.spelc as string;
  if (!spelc || !assertSpelcAccess(req, res, spelc)) return;
  res.json(getSpelcSettings(spelc));
});

router.put("/spelc-settings", requireRole("admin_spelc", "admin_general"), (req, res) => {
  const spelc = (req.body?.spelc as string) || req.user!.spelc || "";
  if (!spelc || !assertSpelcAccess(req, res, spelc)) return;
  const { logoDataUri, socialLinks, testEmail, testMobile } = req.body ?? {};
  updateSpelcSettings(spelc, {
    logoDataUri: typeof logoDataUri === "string" ? logoDataUri : undefined,
    socialLinks: socialLinks && typeof socialLinks === "object" ? (socialLinks as SocialLinks) : undefined,
    testEmail: typeof testEmail === "string" ? testEmail : undefined,
    testMobile: typeof testMobile === "string" ? testMobile : undefined,
  });
  res.json({ ok: true });
});

interface Recipient {
  nom: string;
  prenom: string;
  mail: string | null;
  mobile: string | null;
  votantLocal: number | null;
  scrutinLocal: string | null;
  votantNational: number | null;
}

/**
 * Adhérents du Spelc, croisés par nom/prénom à la fois avec le scrutin
 * national CCMMEP et avec les scrutins locaux (1D+2D) — nécessaire pour les
 * champs de template CCMMEP_non_votant / scrutin_local_non_votant /
 * scrutin_local.
 */
function matchedAdherents(spelc: string): Recipient[] {
  const academie = spelcAcademie(spelc);
  if (!academie) return [];
  const localImportIds = currentImportIds("academique", academie);
  const nationalImportIds = currentImportIds("national", null);
  if (localImportIds.length === 0 && nationalImportIds.length === 0) return [];

  const localPlaceholders = localImportIds.length ? localImportIds.map(() => "?").join(",") : "NULL";
  const nationalPlaceholders = nationalImportIds.length ? nationalImportIds.map(() => "?").join(",") : "NULL";

  return db
    .prepare(
      `SELECT a.nom, a.prenom, a.mail, a.mobile,
              MAX(el.votant) AS votantLocal,
              MAX(el.scrutin_type) AS scrutinLocal,
              MAX(en.votant) AS votantNational
       FROM adherents a
       LEFT JOIN emargements el ON el.spelc = a.spelc AND el.nom_norm = a.nom_norm AND el.prenom_norm = a.prenom_norm
         AND el.import_id IN (${localPlaceholders})
       LEFT JOIN emargements en ON en.spelc = a.spelc AND en.nom_norm = a.nom_norm AND en.prenom_norm = a.prenom_norm
         AND en.import_id IN (${nationalPlaceholders})
       WHERE a.spelc = ?
       GROUP BY a.id`
    )
    .all(...localImportIds, ...nationalImportIds, spelc) as Recipient[];
}

function templateFieldsFor(r: Recipient, spelc: string): TemplateFields {
  const scrutinLocal = r.scrutinLocal ?? "";
  const votantLocal = Boolean(r.votantLocal);
  const settings = getSpelcSettings(spelc);
  return {
    nom: r.nom,
    prenom: r.prenom,
    scrutin_local: scrutinLocal,
    CCMMEP_non_votant: !r.votantNational,
    scrutin_local_non_votant: !votantLocal,
    // alias conservés pour compatibilité avec d'anciens modèles
    scrutin: scrutinLocal,
    votant: votantLocal,
    logo: buildLogoHtml(settings.logoDataUri),
    reseaux_sociaux: buildSocialLinksHtml(settings.socialLinks),
  };
}

/** Mail/mobile de test propres au Spelc si configurés, sinon ceux globaux de l'admin général. */
function resolveTestContact(spelc: string): { testEmail: string | null; testMobile: string | null } {
  const spelcSettings = getSpelcSettings(spelc);
  const global = getTestContactSettings();
  return {
    testEmail: spelcSettings.testEmail || global.testEmail,
    testMobile: spelcSettings.testMobile || global.testMobile,
  };
}

/** Une personne est ciblée par une relance si elle n'a voté à AU MOINS un des deux scrutins. */
function needsRelance(r: Recipient): boolean {
  return !r.votantNational || !r.votantLocal;
}

function firstNonVotantAdherent(spelc: string): Recipient | null {
  return matchedAdherents(spelc).find(needsRelance) ?? null;
}

/**
 * Envoie un mail/SMS de test unique, en utilisant le contenu actuellement
 * saisi (pas forcément encore enregistré) et les champs dynamiques du
 * premier adhérent non-votant du Spelc — pour prévisualiser le rendu réel
 * sans attendre d'enregistrer puis de lancer une vraie campagne.
 */
router.post("/templates/email/test", requireRole("admin_spelc", "admin_general"), async (req, res) => {
  const spelc = (req.body?.spelc as string) || req.user!.spelc || "";
  if (!spelc || !assertSpelcAccess(req, res, spelc)) return;
  const { subject = "", body = "" } = req.body ?? {};
  const testEmail = resolveTestContact(spelc).testEmail;
  if (!testEmail) {
    res.status(400).json({ error: "Aucun mail de test configuré (ni pour ce Spelc, ni globalement)." });
    return;
  }
  const user = db.prepare("SELECT brevo_api_key FROM users WHERE id = ?").get(req.user!.id) as {
    brevo_api_key: string | null;
  };
  if (!user.brevo_api_key) {
    res.status(400).json({ error: "Clé API Brevo non configurée." });
    return;
  }
  const recipient = firstNonVotantAdherent(spelc);
  if (!recipient) {
    res.status(400).json({ error: "Aucun adhérent non-votant disponible pour prévisualiser le modèle." });
    return;
  }
  const fields = templateFieldsFor(recipient, spelc);
  const result = await sendBrevoEmails({
    apiKey: user.brevo_api_key,
    to: [{ email: testEmail, name: `${recipient.prenom} ${recipient.nom}` }],
    subject: renderTemplate(String(subject), fields),
    htmlContent: wrapEmailHtml(renderTemplate(String(body), fields)),
    tag: "test-modele",
  });
  appendRelanceLog({
    timestamp: new Date().toISOString(),
    type: "mail",
    provider: "Brevo",
    scope: spelc,
    campagneTag: "test-modele",
    nom: recipient.nom,
    prenom: recipient.prenom,
    contact: testEmail,
    testMode: true,
    success: result.sent > 0,
  });
  insertRelanceTracking({
    ownerUserId: req.user!.id,
    type: "mail",
    scope: spelc,
    campagneTag: "test-modele",
    nom: recipient.nom,
    prenom: recipient.prenom,
    contact: testEmail,
    testMode: true,
    sendOk: result.sent > 0,
    messageId: result.messageId,
  });
  res.json({ sent: result.sent, errors: result.errors });
});

router.post("/templates/sms/test", requireRole("admin_spelc", "admin_general"), async (req, res) => {
  const spelc = (req.body?.spelc as string) || req.user!.spelc || "";
  if (!spelc || !assertSpelcAccess(req, res, spelc)) return;
  const { body = "" } = req.body ?? {};
  const testMobile = resolveTestContact(spelc).testMobile;
  if (!testMobile) {
    res.status(400).json({ error: "Aucun mobile de test configuré (ni pour ce Spelc, ni globalement)." });
    return;
  }
  const user = db.prepare("SELECT brevo_api_key FROM users WHERE id = ?").get(req.user!.id) as {
    brevo_api_key: string | null;
  };
  if (!user.brevo_api_key) {
    res.status(400).json({ error: "Clé API Brevo non configurée." });
    return;
  }
  const recipient = firstNonVotantAdherent(spelc);
  if (!recipient) {
    res.status(400).json({ error: "Aucun adhérent non-votant disponible pour prévisualiser le modèle." });
    return;
  }
  const fields = templateFieldsFor(recipient, spelc);
  const result = await sendBrevoSms({
    apiKey: user.brevo_api_key,
    recipients: [normalizeFrenchMobile(testMobile)],
    content: renderTemplate(String(body), fields),
    tag: "test-modele",
  });
  appendRelanceLog({
    timestamp: new Date().toISOString(),
    type: "sms",
    provider: "Brevo",
    scope: spelc,
    campagneTag: "test-modele",
    nom: recipient.nom,
    prenom: recipient.prenom,
    contact: testMobile,
    testMode: true,
    success: result.sent > 0,
  });
  insertRelanceTracking({
    ownerUserId: req.user!.id,
    type: "sms",
    scope: spelc,
    campagneTag: "test-modele",
    nom: recipient.nom,
    prenom: recipient.prenom,
    contact: normalizeFrenchMobile(testMobile),
    testMode: true,
    sendOk: result.sent > 0,
    messageId: result.messageId,
  });
  res.json({ sent: result.sent, errors: result.errors });
});

router.post("/campaigns/email", requireRole("admin_spelc"), async (req, res) => {
  const spelc = req.user!.spelc!;
  const { tag, onlyNonVotants = true, testMode, testLimit } = req.body ?? {};
  const user = db.prepare("SELECT brevo_api_key FROM users WHERE id = ?").get(req.user!.id) as {
    brevo_api_key: string | null;
  };
  if (!user.brevo_api_key) {
    res.status(400).json({ error: "Clé API Brevo non configurée pour ce Spelc." });
    return;
  }
  const template = db.prepare("SELECT subject, body FROM email_templates WHERE spelc = ?").get(spelc) as
    | { subject: string; body: string }
    | undefined;
  if (!template) {
    res.status(400).json({ error: "Aucun modèle de mail configuré." });
    return;
  }
  const testEmail = testMode ? resolveTestContact(spelc).testEmail : null;
  if (testMode && !testEmail) {
    res.status(400).json({ error: "Aucun mail de test configuré (ni pour ce Spelc, ni globalement par l'admin général)." });
    return;
  }

  let recipients = testMode ? matchedAdherents(spelc) : matchedAdherents(spelc).filter((r) => r.mail);
  if (onlyNonVotants) recipients = recipients.filter(needsRelance);
  if (testMode) recipients = recipients.slice(0, clampTestLimit(testLimit));

  const to = recipients.map((r) => ({
    email: testMode ? String(testEmail) : r.mail!,
    name: `${r.prenom} ${r.nom}`,
    nom: r.nom,
    prenom: r.prenom,
    subject: renderTemplate(template.subject, templateFieldsFor(r, spelc)),
    html: wrapEmailHtml(renderTemplate(template.body, templateFieldsFor(r, spelc))),
  }));

  const campagneTag = (tag ?? "relance") + (testMode ? "-test" : "");

  // Brevo n'acceptant pas un contenu par destinataire en un seul appel groupé sans template,
  // on envoie chaque email individuellement avec son contenu personnalisé.
  let sent = 0;
  let errors = 0;
  for (const item of to) {
    const result = await sendBrevoEmails({
      apiKey: user.brevo_api_key,
      to: [{ email: item.email, name: item.name }],
      subject: item.subject,
      htmlContent: item.html,
      tag: tag ?? "relance",
    });
    sent += result.sent;
    errors += result.errors;
    appendRelanceLog({
      timestamp: new Date().toISOString(),
      type: "mail",
      provider: "Brevo",
      scope: spelc,
      campagneTag,
      nom: item.nom,
      prenom: item.prenom,
      contact: item.email,
      testMode: Boolean(testMode),
      success: result.sent > 0,
    });
    insertRelanceTracking({
      ownerUserId: req.user!.id,
      type: "mail",
      scope: spelc,
      campagneTag,
      nom: item.nom,
      prenom: item.prenom,
      contact: item.email,
      testMode: Boolean(testMode),
      sendOk: result.sent > 0,
      messageId: result.messageId,
    });
  }

  db.prepare(
    `INSERT INTO relances_mail (spelc, date, campagne_tag, total_envoye, erreurs_envoi, mails_lus, liens_clique, is_test)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?)`
  ).run(spelc, dayjs().format("YYYY-MM-DD"), campagneTag, sent, errors, testMode ? 1 : 0);

  res.status(201).json({ sent, errors, total: to.length });
});

router.post("/campaigns/sms", requireRole("admin_spelc"), async (req, res) => {
  const spelc = req.user!.spelc!;
  const { tag, onlyNonVotants = true, testMode, smsLimit } = req.body ?? {};
  const user = db.prepare("SELECT brevo_api_key FROM users WHERE id = ?").get(req.user!.id) as {
    brevo_api_key: string | null;
  };
  if (!user.brevo_api_key) {
    res.status(400).json({ error: "Clé API Brevo non configurée pour ce Spelc." });
    return;
  }
  const template = db.prepare("SELECT body FROM sms_templates WHERE spelc = ?").get(spelc) as
    | { body: string }
    | undefined;
  if (!template) {
    res.status(400).json({ error: "Aucun modèle de SMS configuré." });
    return;
  }
  const testMobile = testMode ? resolveTestContact(spelc).testMobile : null;
  if (testMode && !testMobile) {
    res.status(400).json({ error: "Aucun mobile de test configuré (ni pour ce Spelc, ni globalement par l'admin général)." });
    return;
  }

  let recipients = testMode ? matchedAdherents(spelc) : matchedAdherents(spelc).filter((r) => r.mobile);
  if (onlyNonVotants) recipients = recipients.filter(needsRelance);
  recipients = recipients.slice(0, clampSmsLimit(smsLimit));

  const campagneTag = (tag ?? "relance") + (testMode ? "-test" : "");
  let sent = 0;
  let errors = 0;
  for (const r of recipients) {
    const content = renderTemplate(template.body, templateFieldsFor(r, spelc));
    const contact = testMode ? String(testMobile) : r.mobile!;
    const result = await sendBrevoSms({
      apiKey: user.brevo_api_key,
      recipients: [normalizeFrenchMobile(contact)],
      content,
      tag: campagneTag,
    });
    sent += result.sent;
    errors += result.errors;
    appendRelanceLog({
      timestamp: new Date().toISOString(),
      type: "sms",
      provider: "Brevo",
      scope: spelc,
      campagneTag,
      nom: r.nom,
      prenom: r.prenom,
      contact,
      testMode: Boolean(testMode),
      success: result.sent > 0,
    });
    insertRelanceTracking({
      ownerUserId: req.user!.id,
      type: "sms",
      scope: spelc,
      campagneTag,
      nom: r.nom,
      prenom: r.prenom,
      contact: normalizeFrenchMobile(contact),
      testMode: Boolean(testMode),
      sendOk: result.sent > 0,
      messageId: result.messageId,
    });
  }

  db.prepare(
    `INSERT INTO relances_sms (spelc, date, campagne_tag, sms_envoyes, erreurs_envoi, sms_delivres, sms_rejetes, statut_global, is_test)
     VALUES (?, ?, ?, ?, ?, 0, 0, 'En attente', ?)`
  ).run(spelc, dayjs().format("YYYY-MM-DD"), campagneTag, sent, errors, testMode ? 1 : 0);

  res.status(201).json({ sent, errors, total: recipients.length });
});

router.get("/tracking/mail", (req, res) => {
  const spelc = req.query.spelc as string;
  if (!spelc || !assertSpelcAccess(req, res, spelc)) return;
  const rows = db.prepare("SELECT * FROM relances_mail WHERE spelc = ? ORDER BY date").all(spelc);
  res.json({ rows });
});

router.get("/tracking/sms", (req, res) => {
  const spelc = req.query.spelc as string;
  if (!spelc || !assertSpelcAccess(req, res, spelc)) return;
  const rows = db.prepare("SELECT * FROM relances_sms WHERE spelc = ? ORDER BY date").all(spelc);
  res.json({ rows });
});

/**
 * Suivi par personne des relances de ce Spelc : statut d'envoi et clics,
 * mis à jour au fil du temps par le sondage périodique de l'API Brevo (voir
 * services/relanceTracking.ts) — le statut final et les clics n'arrivent
 * jamais au moment de l'envoi lui-même.
 */
router.get("/relance-tracking", (req, res) => {
  const spelc = req.query.spelc as string;
  if (!spelc || !assertSpelcAccess(req, res, spelc)) return;
  const limit = Math.min(Number(req.query.limit) || 500, 2000);
  res.json({ rows: listRelanceTrackingByScope(spelc, limit) });
});

/** Sonde Brevo immédiatement pour les relances en attente de ce Spelc (bouton "Vérifier maintenant"). */
router.post("/relance-tracking/refresh", requireRole("admin_spelc", "admin_general"), async (req, res) => {
  const spelc = (req.body?.spelc as string) || req.user!.spelc || "";
  if (!spelc || !assertSpelcAccess(req, res, spelc)) return;
  const result = await refreshPendingRelanceTracking({ ownerUserId: req.user!.id, scope: spelc });
  res.json(result);
});

/** Rafraîchit les statistiques (lus/cliqués, délivrés/rejetés) depuis l'API Brevo. */
router.post("/tracking/sync", requireRole("admin_spelc"), async (req, res) => {
  const spelc = req.user!.spelc!;
  const { tag, startDate, endDate } = req.body ?? {};
  const user = db.prepare("SELECT brevo_api_key FROM users WHERE id = ?").get(req.user!.id) as {
    brevo_api_key: string | null;
  };
  if (!user.brevo_api_key) {
    res.status(400).json({ error: "Clé API Brevo non configurée." });
    return;
  }
  const start = startDate ?? dayjs().subtract(30, "day").format("YYYY-MM-DD");
  const end = endDate ?? dayjs().format("YYYY-MM-DD");

  const emailStats = await fetchAggregatedEmailStats(user.brevo_api_key, tag ?? "", start, end);
  if (emailStats) {
    db.prepare(
      `UPDATE relances_mail SET mails_lus = ?, liens_clique = ?
       WHERE spelc = ? AND campagne_tag = ? AND id = (
         SELECT id FROM relances_mail WHERE spelc = ? AND campagne_tag = ? ORDER BY date DESC LIMIT 1
       )`
    ).run(emailStats.opens, emailStats.clicks, spelc, tag, spelc, tag);
  }

  const smsStats = await fetchAggregatedSmsStats(user.brevo_api_key, start, end);
  if (smsStats) {
    db.prepare(
      `UPDATE relances_sms SET sms_delivres = ?, sms_rejetes = ?, statut_global = ?
       WHERE spelc = ? AND campagne_tag = ? AND id = (
         SELECT id FROM relances_sms WHERE spelc = ? AND campagne_tag = ? ORDER BY date DESC LIMIT 1
       )`
    ).run(smsStats.delivered, smsStats.softBounces + smsStats.hardBounces, "Synchronisé", spelc, tag, spelc, tag);
  }

  res.json({ emailStats, smsStats });
});

export default router;
