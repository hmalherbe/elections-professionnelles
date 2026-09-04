import { Router } from "express";
import dayjs from "dayjs";
import { db } from "../db/index.js";
import { requireAuth, requireRole, canAccessSpelc } from "../middleware/auth.js";
import { renderTemplate } from "../lib/template.js";
import {
  sendBrevoEmails,
  sendBrevoSms,
  fetchAggregatedEmailStats,
  fetchAggregatedSmsStats,
} from "../services/brevo.js";

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

/** Clé API Brevo : gérée uniquement par l'admin Spelc concerné. */
router.get("/settings", requireRole("admin_spelc"), (req, res) => {
  const row = db.prepare("SELECT brevo_api_key FROM users WHERE id = ?").get(req.user!.id) as
    | { brevo_api_key: string | null }
    | undefined;
  res.json({ configured: Boolean(row?.brevo_api_key), maskedKey: row?.brevo_api_key ? "••••••••" + row.brevo_api_key.slice(-4) : null });
});

router.put("/settings", requireRole("admin_spelc"), (req, res) => {
  const { apiKey } = req.body ?? {};
  if (!apiKey) {
    res.status(400).json({ error: "apiKey requise." });
    return;
  }
  db.prepare("UPDATE users SET brevo_api_key = ? WHERE id = ?").run(String(apiKey), req.user!.id);
  res.json({ ok: true });
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

interface Recipient {
  nom: string;
  prenom: string;
  mail: string | null;
  mobile: string | null;
  votant: number;
}

/** Adhérents du Spelc, croisés par nom/prénom avec les scrutins locaux (1D+2D). */
function matchedAdherents(spelc: string): Recipient[] {
  const academie = spelcAcademie(spelc);
  if (!academie) return [];
  const importIds = db
    .prepare(
      `SELECT i.id FROM imports i
       INNER JOIN (SELECT degre, MAX(imported_at) AS max_at FROM imports WHERE scope='academique' AND academie=? GROUP BY degre) latest
       ON latest.degre = i.degre AND latest.max_at = i.imported_at
       WHERE i.scope='academique' AND i.academie=?`
    )
    .all(academie, academie) as { id: number }[];
  if (importIds.length === 0) return [];
  const placeholders = importIds.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT a.nom, a.prenom, a.mail, a.mobile, MAX(e.votant) AS votant
       FROM adherents a
       LEFT JOIN emargements e ON e.spelc = a.spelc AND e.nom_norm = a.nom_norm AND e.prenom_norm = a.prenom_norm
         AND e.import_id IN (${placeholders})
       WHERE a.spelc = ?
       GROUP BY a.id`
    )
    .all(...importIds.map((r) => r.id), spelc) as Recipient[];
}

router.post("/campaigns/email", requireRole("admin_spelc"), async (req, res) => {
  const spelc = req.user!.spelc!;
  const { scrutin, tag, onlyNonVotants = true } = req.body ?? {};
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
  let recipients = matchedAdherents(spelc).filter((r) => r.mail);
  if (onlyNonVotants) recipients = recipients.filter((r) => !r.votant);

  const to = recipients.map((r) => ({
    email: r.mail!,
    name: `${r.prenom} ${r.nom}`,
    subject: renderTemplate(template.subject, { nom: r.nom, prenom: r.prenom, scrutin: scrutin ?? "", votant: Boolean(r.votant) }),
    html: renderTemplate(template.body, { nom: r.nom, prenom: r.prenom, scrutin: scrutin ?? "", votant: Boolean(r.votant) }),
  }));

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
      tag: tag ?? scrutin ?? "relance",
    });
    sent += result.sent;
    errors += result.errors;
  }

  const campagneTag = tag ?? scrutin ?? "relance";
  db.prepare(
    `INSERT INTO relances_mail (spelc, date, campagne_tag, total_envoye, erreurs_envoi, mails_lus, liens_clique)
     VALUES (?, ?, ?, ?, ?, 0, 0)`
  ).run(spelc, dayjs().format("YYYY-MM-DD"), campagneTag, sent, errors);

  res.status(201).json({ sent, errors, total: to.length });
});

router.post("/campaigns/sms", requireRole("admin_spelc"), async (req, res) => {
  const spelc = req.user!.spelc!;
  const { scrutin, tag, onlyNonVotants = true } = req.body ?? {};
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
  let recipients = matchedAdherents(spelc).filter((r) => r.mobile);
  if (onlyNonVotants) recipients = recipients.filter((r) => !r.votant);

  const campagneTag = tag ?? scrutin ?? "relance";
  let sent = 0;
  let errors = 0;
  for (const r of recipients) {
    const content = renderTemplate(template.body, {
      nom: r.nom,
      prenom: r.prenom,
      scrutin: scrutin ?? "",
      votant: Boolean(r.votant),
    });
    const result = await sendBrevoSms({
      apiKey: user.brevo_api_key,
      recipients: [r.mobile!],
      content,
      tag: campagneTag,
    });
    sent += result.sent;
    errors += result.errors;
  }

  db.prepare(
    `INSERT INTO relances_sms (spelc, date, campagne_tag, sms_envoyes, erreurs_envoi, sms_delivres, sms_rejetes, statut_global)
     VALUES (?, ?, ?, ?, ?, 0, 0, 'En attente')`
  ).run(spelc, dayjs().format("YYYY-MM-DD"), campagneTag, sent, errors);

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
