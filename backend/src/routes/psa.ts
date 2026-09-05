import { Router } from "express";
import { db } from "../db/index.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { runPsaSimulation } from "../services/psaSimulation.js";
import { renderTemplate, type TemplateFields } from "../lib/template.js";
import { sendBrevoEmails, sendBrevoSms } from "../services/brevo.js";
import { getTestContactSettings } from "../services/settings.js";
import { appendRelanceLog } from "../lib/relanceLog.js";

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
  };
}

/**
 * Relance simulée des PSA aux dates cochées (mail et/ou SMS). Pour chaque
 * date, seules les personnes n'ayant pas encore voté (national et/ou local)
 * à cette date-là sont ciblées. Appelle réellement l'API Brevo, redirigée
 * vers le mail/mobile de test si le mode test est actif — exactement comme
 * les campagnes des Spelcs — et journalise chaque envoi individuel.
 */
router.post("/relance", async (req, res) => {
  const { runId, mailDates = [], smsDates = [], testMode } = req.body ?? {};
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
      res.status(400).json({ error: "Aucun mail de test configuré. Renseignez-le dans les réglages." });
      return;
    }
  }
  if (smsDates.length > 0) {
    if (!smsTemplate) {
      res.status(400).json({ error: "Aucun modèle de SMS PSA configuré." });
      return;
    }
    if (testMode && !testContact?.testMobile) {
      res.status(400).json({ error: "Aucun mobile de test configuré. Renseignez-le dans les réglages." });
      return;
    }
  }

  let mailSent = 0;
  let mailErrors = 0;
  let smsSent = 0;
  let smsErrors = 0;

  if (mailDates.length > 0) {
    const template = emailTemplate!;
    for (const dateStr of mailDates as string[]) {
      const endOfDay = `${dateStr}T23:59:59.999Z`;
      for (const p of people) {
        const fields = templateFieldsForPsa(p, endOfDay);
        if (!fields.nonVotantNational && !fields.nonVotantLocal) continue;
        if (!testMode && !p.email) continue;
        const email = testMode ? testContact!.testEmail! : p.email!;
        const campagneTag = `psa-${dateStr}` + (testMode ? "-test" : "");
        const result = await sendBrevoEmails({
          apiKey: user.brevo_api_key!,
          to: [{ email, name: `${p.prenom} ${p.nom}` }],
          subject: renderTemplate(template.subject, fields),
          htmlContent: renderTemplate(template.body, fields),
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
      }
    }
  }

  if (smsDates.length > 0) {
    const template = smsTemplate!;
    for (const dateStr of smsDates as string[]) {
      const endOfDay = `${dateStr}T23:59:59.999Z`;
      for (const p of people) {
        const fields = templateFieldsForPsa(p, endOfDay);
        if (!fields.nonVotantNational && !fields.nonVotantLocal) continue;
        if (!testMode && !p.mobile) continue;
        const mobile = testMode ? testContact!.testMobile! : p.mobile!;
        const campagneTag = `psa-${dateStr}` + (testMode ? "-test" : "");
        const result = await sendBrevoSms({
          apiKey: user.brevo_api_key!,
          recipients: [mobile],
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
      }
    }
  }

  res.status(201).json({ mailSent, mailErrors, smsSent, smsErrors });
});

export default router;
