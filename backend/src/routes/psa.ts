import { Router } from "express";
import { db } from "../db/index.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { runPsaSimulation } from "../services/psaSimulation.js";
import { renderTemplate, type TemplateFields } from "../lib/template.js";
import { wrapEmailHtml, ensureSiteLink } from "../lib/emailLayout.js";
import { sendBrevoEmails, sendBrevoSms } from "../services/brevo.js";
import { getTestContactSettings, getPsaBranding, setPsaLogo, setPsaSocialLinks } from "../services/settings.js";
import { buildLogoHtml, buildSocialLinksHtml, type SocialLinks } from "../lib/socialLinks.js";
import { appendRelanceLog } from "../lib/relanceLog.js";
import { insertRelanceTracking } from "../services/relanceTracking.js";
import { normalizeFrenchMobile } from "../lib/phone.js";

/** Plafond d'envoi SMS pour ne pas consommer plus de crédits Brevo que prévu. */
const MAX_SMS_SEND_LIMIT = 500;
const DEFAULT_SMS_SEND_LIMIT = 20;

function clampSmsLimit(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_SMS_SEND_LIMIT;
  return Math.min(Math.floor(n), MAX_SMS_SEND_LIMIT);
}

const router = Router();
router.use(requireAuth, requireRole("admin_general"));

router.post("/simulate", (req, res) => {
  const { description } = req.body ?? {};
  const result = runPsaSimulation(req.user!.id, description);
  res.status(201).json(result);
});

router.get("/runs", (_req, res) => {
  const rows = db.prepare("SELECT * FROM psa_simulation_runs ORDER BY run_at DESC").all();
  res.json({ runs: rows });
});

router.get("/runs/:runId/results", (req, res) => {
  const runId = Number(req.params.runId);
  const rows = db
    .prepare(
      `SELECT p.nom, p.prenom, p.email, e.scrutin, e.scrutin_type, e.date_emargement
       FROM psa_emargements e JOIN psa p ON p.id = e.psa_id
       WHERE e.run_id = ? ORDER BY p.nom, p.prenom, e.scrutin`
    )
    .all(runId);

  const totalPsa = (db.prepare("SELECT COUNT(*) AS c FROM psa").get() as { c: number }).c;
  const national = rows.filter((r: any) => r.scrutin === "CCMMEP");
  const local = rows.filter((r: any) => r.scrutin === "LOCAL");
  const votedNational = national.filter((r: any) => r.date_emargement).length;
  const votedLocal = local.filter((r: any) => r.date_emargement).length;

  // Courbe cumulée par jour (national + local confondus, comme les autres courbes de l'appli)
  const byDay = new Map<string, number>();
  for (const r of rows as any[]) {
    if (!r.date_emargement) continue;
    const day = String(r.date_emargement).slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  const courbe = Array.from(byDay.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }));

  res.json({
    rows,
    summary: {
      totalPsa,
      votedNational,
      votedLocal,
      tauxNational: totalPsa ? votedNational / totalPsa : 0,
      tauxLocal: totalPsa ? votedLocal / totalPsa : 0,
    },
    courbe,
  });
});

router.get("/templates/email", (_req, res) => {
  const row = db.prepare("SELECT subject, body FROM psa_email_template WHERE id = 1").get() as
    | { subject: string; body: string }
    | undefined;
  res.json(row ?? { subject: "", body: "" });
});

router.put("/templates/email", (req, res) => {
  const { subject = "", body = "" } = req.body ?? {};
  db.prepare(
    `INSERT INTO psa_email_template (id, subject, body, updated_at) VALUES (1, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET subject = excluded.subject, body = excluded.body, updated_at = datetime('now')`
  ).run(String(subject), String(body));
  res.json({ ok: true });
});

router.get("/templates/sms", (_req, res) => {
  const row = db.prepare("SELECT body FROM psa_sms_template WHERE id = 1").get() as
    | { body: string }
    | undefined;
  res.json(row ?? { body: "" });
});

router.put("/templates/sms", (req, res) => {
  const { body = "" } = req.body ?? {};
  db.prepare(
    `INSERT INTO psa_sms_template (id, body, updated_at) VALUES (1, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET body = excluded.body, updated_at = datetime('now')`
  ).run(String(body));
  res.json({ ok: true });
});

/** Logo et réseaux sociaux insérés dans les modèles de relance PSA (global, admin général). */
router.get("/branding", (_req, res) => {
  res.json(getPsaBranding());
});

router.put("/branding", (req, res) => {
  const { logoDataUri, socialLinks } = req.body ?? {};
  if (typeof logoDataUri === "string") setPsaLogo(logoDataUri);
  if (socialLinks && typeof socialLinks === "object") setPsaSocialLinks(socialLinks as SocialLinks);
  res.json({ ok: true });
});

interface PsaVoteInfo {
  psaId: number;
  nom: string;
  prenom: string;
  email: string | null;
  mobile: string | null;
  typeScrutin: string | null;
  nationalDate: string | null;
  localDate: string | null;
}

function getPsaVoteInfo(runId: number): PsaVoteInfo[] {
  return db
    .prepare(
      `SELECT p.id AS psaId, p.nom, p.prenom, p.email, p.mobile, p.type_scrutin AS typeScrutin,
              MAX(CASE WHEN e.scrutin = 'CCMMEP' THEN e.date_emargement END) AS nationalDate,
              MAX(CASE WHEN e.scrutin = 'LOCAL' THEN e.date_emargement END) AS localDate
       FROM psa p
       LEFT JOIN psa_emargements e ON e.psa_id = p.id AND e.run_id = ?
       GROUP BY p.id`
    )
    .all(runId) as PsaVoteInfo[];
}

/** Statut au soir de la date de relance (les émargements postérieurs ne comptent pas encore). */
function templateFieldsForPsa(p: PsaVoteInfo, endOfDay: string): TemplateFields & { nonVotantNational: boolean; nonVotantLocal: boolean } {
  const nonVotantNational = !p.nationalDate || p.nationalDate > endOfDay;
  const nonVotantLocal = !p.localDate || p.localDate > endOfDay;
  const scrutinLocal = p.typeScrutin ?? "";
  const branding = getPsaBranding();
  return {
    nom: p.nom,
    prenom: p.prenom,
    scrutin_local: scrutinLocal,
    CCMMEP_non_votant: nonVotantNational,
    scrutin_local_non_votant: nonVotantLocal,
    scrutin: scrutinLocal,
    votant: !nonVotantLocal,
    nonVotantNational,
    nonVotantLocal,
    logo: buildLogoHtml(branding.logoDataUri),
    reseaux_sociaux: buildSocialLinksHtml(branding.socialLinks),
  };
}

/** Premier PSA encore non-votant (national ou local) dans la dernière simulation, pour prévisualiser un modèle. */
function firstNonVotantPsa(): PsaVoteInfo | null {
  const run = db.prepare("SELECT id FROM psa_simulation_runs ORDER BY run_at DESC, id DESC LIMIT 1").get() as
    | { id: number }
    | undefined;
  if (!run) return null;
  const now = new Date().toISOString();
  const people = getPsaVoteInfo(run.id);
  return people.find((p) => templateFieldsForPsa(p, now).nonVotantNational || templateFieldsForPsa(p, now).nonVotantLocal) ?? null;
}

/**
 * Envoie un mail/SMS de test unique, en utilisant le contenu actuellement
 * saisi (pas forcément encore enregistré) et les champs dynamiques du
 * premier PSA non-votant de la dernière simulation — pour prévisualiser le
 * rendu réel sans attendre d'enregistrer puis de lancer une vraie relance.
 */
router.post("/templates/email/test", async (req, res) => {
  const { subject = "", body = "" } = req.body ?? {};
  const testContact = getTestContactSettings();
  if (!testContact.testEmail) {
    res.status(400).json({ error: "Renseigner votre mail." });
    return;
  }
  const user = db.prepare("SELECT brevo_api_key FROM users WHERE id = ?").get(req.user!.id) as {
    brevo_api_key: string | null;
  };
  if (!user.brevo_api_key) {
    res.status(400).json({ error: "Clé API Brevo non configurée pour l'admin général." });
    return;
  }
  const psa = firstNonVotantPsa();
  if (!psa) {
    res.status(400).json({ error: "Aucune simulation PSA disponible pour prévisualiser le modèle." });
    return;
  }
  const fields = templateFieldsForPsa(psa, new Date().toISOString());
  const result = await sendBrevoEmails({
    apiKey: user.brevo_api_key,
    to: [{ email: testContact.testEmail, name: `${psa.prenom} ${psa.nom}` }],
    subject: renderTemplate(String(subject), fields),
    htmlContent: wrapEmailHtml(renderTemplate(ensureSiteLink(String(body)), fields)),
    tag: "psa-test-modele",
  });
  appendRelanceLog({
    timestamp: new Date().toISOString(),
    type: "mail",
    provider: "Brevo",
    scope: "PSA",
    campagneTag: "psa-test-modele",
    nom: psa.nom,
    prenom: psa.prenom,
    contact: testContact.testEmail,
    testMode: true,
    success: result.sent > 0,
  });
  insertRelanceTracking({
    ownerUserId: req.user!.id,
    type: "mail",
    scope: "PSA",
    campagneTag: "psa-test-modele",
    nom: psa.nom,
    prenom: psa.prenom,
    contact: testContact.testEmail,
    testMode: true,
    sendOk: result.sent > 0,
    messageId: result.messageId,
  });
  res.json({ sent: result.sent, errors: result.errors });
});

router.post("/templates/sms/test", async (req, res) => {
  const { body = "" } = req.body ?? {};
  const testContact = getTestContactSettings();
  if (!testContact.testMobile) {
    res.status(400).json({ error: "Renseigner le numéro de mobile." });
    return;
  }
  const user = db.prepare("SELECT brevo_api_key FROM users WHERE id = ?").get(req.user!.id) as {
    brevo_api_key: string | null;
  };
  if (!user.brevo_api_key) {
    res.status(400).json({ error: "Clé API Brevo non configurée pour l'admin général." });
    return;
  }
  const psa = firstNonVotantPsa();
  if (!psa) {
    res.status(400).json({ error: "Aucune simulation PSA disponible pour prévisualiser le modèle." });
    return;
  }
  const fields = templateFieldsForPsa(psa, new Date().toISOString());
  const result = await sendBrevoSms({
    apiKey: user.brevo_api_key,
    recipients: [normalizeFrenchMobile(testContact.testMobile)],
    content: renderTemplate(String(body), fields),
    tag: "psa-test-modele",
  });
  appendRelanceLog({
    timestamp: new Date().toISOString(),
    type: "sms",
    provider: "Brevo",
    scope: "PSA",
    campagneTag: "psa-test-modele",
    nom: psa.nom,
    prenom: psa.prenom,
    contact: testContact.testMobile,
    testMode: true,
    success: result.sent > 0,
  });
  insertRelanceTracking({
    ownerUserId: req.user!.id,
    type: "sms",
    scope: "PSA",
    campagneTag: "psa-test-modele",
    nom: psa.nom,
    prenom: psa.prenom,
    contact: normalizeFrenchMobile(testContact.testMobile),
    testMode: true,
    sendOk: result.sent > 0,
    messageId: result.messageId,
  });
  res.json({ sent: result.sent, errors: result.errors });
});

/**
 * Relance simulée des PSA aux dates cochées (mail et/ou SMS). Pour chaque
 * date, seules les personnes n'ayant pas encore voté (national et/ou local)
 * à cette date-là sont ciblées. Appelle réellement l'API Brevo, redirigée
 * vers le mail/mobile de test si le mode test est actif — exactement comme
 * les campagnes des Spelcs — et journalise chaque envoi individuel.
 */
router.post("/relance", async (req, res) => {
  const { runId, mailDates = [], smsDates = [], testMode, smsLimit } = req.body ?? {};
  if (!runId) {
    res.status(400).json({ error: "runId requis." });
    return;
  }
  const run = db.prepare("SELECT id FROM psa_simulation_runs WHERE id = ?").get(runId);
  if (!run) {
    res.status(404).json({ error: "Simulation introuvable." });
    return;
  }

  const user = db.prepare("SELECT brevo_api_key FROM users WHERE id = ?").get(req.user!.id) as {
    brevo_api_key: string | null;
  };
  const testContact = testMode ? getTestContactSettings() : null;
  const people = getPsaVoteInfo(Number(runId));

  // Toutes les préconditions sont vérifiées AVANT le moindre envoi, pour ne
  // jamais renvoyer une erreur après avoir déjà réellement envoyé une partie
  // des mails/SMS (ce qui laisserait le client croire à un échec total).
  const emailTemplate = db.prepare("SELECT subject, body FROM psa_email_template WHERE id = 1").get() as
    | { subject: string; body: string }
    | undefined;
  const smsTemplate = db.prepare("SELECT body FROM psa_sms_template WHERE id = 1").get() as
    | { body: string }
    | undefined;

  if (mailDates.length > 0 || smsDates.length > 0) {
    if (!user.brevo_api_key) {
      res.status(400).json({ error: "Clé API Brevo non configurée pour l'admin général." });
      return;
    }
  }
  if (mailDates.length > 0) {
    if (!emailTemplate) {
      res.status(400).json({ error: "Aucun modèle de mail PSA configuré." });
      return;
    }
    if (testMode && !testContact?.testEmail) {
      res.status(400).json({ error: "Renseigner votre mail." });
      return;
    }
  }
  if (smsDates.length > 0) {
    if (!smsTemplate) {
      res.status(400).json({ error: "Aucun modèle de SMS PSA configuré." });
      return;
    }
    if (testMode && !testContact?.testMobile) {
      res.status(400).json({ error: "Renseigner le numéro de mobile." });
      return;
    }
  }

  let mailSent = 0;
  let mailErrors = 0;
  let smsSent = 0;
  let smsErrors = 0;

  if (mailDates.length > 0) {
    const template = emailTemplate!;
    // Une personne toujours non-votante sur plusieurs dates cochées ne doit
    // être relancée par mail qu'une seule fois (à la première date où elle
    // est encore non-votante), pas une fois par date.
    const seenMail = new Set<number>();
    const sortedMailDates = [...(mailDates as string[])].sort();
    for (const dateStr of sortedMailDates) {
      const endOfDay = `${dateStr}T23:59:59.999Z`;
      for (const p of people) {
        if (seenMail.has(p.psaId)) continue;
        const fields = templateFieldsForPsa(p, endOfDay);
        if (!fields.nonVotantNational && !fields.nonVotantLocal) continue;
        if (!testMode && !p.email) continue;
        seenMail.add(p.psaId);
        const email = testMode ? testContact!.testEmail! : p.email!;
        const campagneTag = `psa-${dateStr}` + (testMode ? "-test" : "");
        const result = await sendBrevoEmails({
          apiKey: user.brevo_api_key!,
          to: [{ email, name: `${p.prenom} ${p.nom}` }],
          subject: renderTemplate(template.subject, fields),
          htmlContent: wrapEmailHtml(renderTemplate(ensureSiteLink(template.body), fields)),
          tag: campagneTag,
        });
        mailSent += result.sent;
        mailErrors += result.errors;
        appendRelanceLog({
          timestamp: new Date().toISOString(),
          type: "mail",
          provider: "Brevo",
          scope: "PSA",
          campagneTag,
          nom: p.nom,
          prenom: p.prenom,
          contact: email,
          testMode: Boolean(testMode),
          success: result.sent > 0,
        });
        insertRelanceTracking({
          ownerUserId: req.user!.id,
          type: "mail",
          scope: "PSA",
          campagneTag,
          nom: p.nom,
          prenom: p.prenom,
          contact: email,
          testMode: Boolean(testMode),
          sendOk: result.sent > 0,
          messageId: result.messageId,
        });
      }
    }
  }

  if (smsDates.length > 0) {
    const template = smsTemplate!;
    // Même règle que pour le mail : une seule relance SMS par personne,
    // à la première date où elle est encore non-votante — évitent aussi de
    // gaspiller la limite de crédits sur des doublons de la même personne.
    const seenSms = new Set<number>();
    const candidates: { dateStr: string; p: PsaVoteInfo }[] = [];
    const sortedSmsDates = [...(smsDates as string[])].sort();
    for (const dateStr of sortedSmsDates) {
      const endOfDay = `${dateStr}T23:59:59.999Z`;
      for (const p of people) {
        if (seenSms.has(p.psaId)) continue;
        const fields = templateFieldsForPsa(p, endOfDay);
        if (!fields.nonVotantNational && !fields.nonVotantLocal) continue;
        if (!testMode && !p.mobile) continue;
        seenSms.add(p.psaId);
        candidates.push({ dateStr, p });
      }
    }
    // Plafonnée pour ne pas consommer plus de crédits SMS que prévu.
    for (const { dateStr, p } of candidates.slice(0, clampSmsLimit(smsLimit))) {
      const endOfDay = `${dateStr}T23:59:59.999Z`;
      const fields = templateFieldsForPsa(p, endOfDay);
      const mobile = testMode ? testContact!.testMobile! : p.mobile!;
      const campagneTag = `psa-${dateStr}` + (testMode ? "-test" : "");
      const result = await sendBrevoSms({
        apiKey: user.brevo_api_key!,
        recipients: [normalizeFrenchMobile(mobile)],
        content: renderTemplate(template.body, fields),
        tag: campagneTag,
      });
      smsSent += result.sent;
      smsErrors += result.errors;
      appendRelanceLog({
        timestamp: new Date().toISOString(),
        type: "sms",
        provider: "Brevo",
        scope: "PSA",
        campagneTag,
        nom: p.nom,
        prenom: p.prenom,
        contact: mobile,
        testMode: Boolean(testMode),
        success: result.sent > 0,
      });
      insertRelanceTracking({
        ownerUserId: req.user!.id,
        type: "sms",
        scope: "PSA",
        campagneTag,
        nom: p.nom,
        prenom: p.prenom,
        contact: normalizeFrenchMobile(mobile),
        testMode: Boolean(testMode),
        sendOk: result.sent > 0,
        messageId: result.messageId,
      });
    }
  }

  res.status(201).json({ mailSent, mailErrors, smsSent, smsErrors });
});

export default router;
