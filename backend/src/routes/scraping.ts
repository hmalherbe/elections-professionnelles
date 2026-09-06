import { Router } from "express";
import { db } from "../db/index.js";
import { requireAuth, canAccessAcademie } from "../middleware/auth.js";
import { encrypt } from "../lib/crypto.js";
import { getScrapingConfig, isValidScheduleTimes, parseScheduleTimes, runScrapingAndImport } from "../services/scrapingRun.js";

const router = Router();
router.use(requireAuth);

/**
 * Détermine sur quelle "académie" (clé de scraping_config, '' = national)
 * l'utilisateur agit, et vérifie qu'il y a le droit. L'admin général peut
 * cibler le national ou n'importe quelle académie via ?academie=... ; un
 * admin académique est toujours restreint à la sienne.
 */
function resolveTargetAcademie(user: { role: string; academie: string | null }, queryOrBodyAcademie: unknown): string | null {
  if (user.role === "admin_general") {
    return typeof queryOrBodyAcademie === "string" ? queryOrBodyAcademie : "";
  }
  if (user.role === "admin_academique") {
    return user.academie ?? null;
  }
  return null;
}

/**
 * Identifiants du faux portail de test (service mock-portal), pour
 * pré-remplir le formulaire tant qu'aucune configuration réelle n'a été
 * enregistrée. Lus depuis l'environnement à chaque appel (jamais mis en
 * cache) pour rester toujours cohérents avec le mock-portal réellement
 * démarré.
 */
router.get("/test-credentials", (_req, res) => {
  res.json({
    username: process.env.MOCK_PORTAL_USERNAME || "",
    password: process.env.MOCK_PORTAL_PASSWORD || "",
  });
});

router.get("/config", (req, res) => {
  const academie = resolveTargetAcademie(req.user!, req.query.academie);
  if (academie === null) {
    res.status(403).json({ error: "Accès non autorisé." });
    return;
  }
  const row = getScrapingConfig(academie);
  if (!row) {
    res.json({ configured: false });
    return;
  }
  res.json({
    configured: true,
    portalUrl: row.portal_url,
    username: row.username,
    fileUrl1: row.file_url_1,
    fileUrl2: row.file_url_2,
    usernameSelector: row.username_selector,
    passwordSelector: row.password_selector,
    submitSelector: row.submit_selector,
    scheduleTimes: parseScheduleTimes(row.schedule_times),
    updatedAt: row.updated_at,
  });
});

router.put("/config", (req, res) => {
  const academie = resolveTargetAcademie(req.user!, req.body?.academie);
  if (academie === null) {
    res.status(403).json({ error: "Accès non autorisé." });
    return;
  }
  const {
    portalUrl,
    username,
    password,
    fileUrl1,
    fileUrl2,
    usernameSelector,
    passwordSelector,
    submitSelector,
  } = req.body ?? {};
  if (!portalUrl || !username || !fileUrl1) {
    res.status(400).json({ error: "portalUrl, username et fileUrl1 sont requis." });
    return;
  }
  const existing = db.prepare("SELECT password_encrypted FROM scraping_config WHERE academie = ?").get(academie) as
    | { password_encrypted: string }
    | undefined;
  if (!password && !existing) {
    res.status(400).json({ error: "Mot de passe requis lors de la première configuration." });
    return;
  }
  const passwordEncrypted = password ? encrypt(String(password)) : existing!.password_encrypted;

  db.prepare(
    `INSERT INTO scraping_config
       (academie, portal_url, username, password_encrypted, file_url_1, file_url_2,
        username_selector, password_selector, submit_selector, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(academie) DO UPDATE SET
       portal_url = excluded.portal_url,
       username = excluded.username,
       password_encrypted = excluded.password_encrypted,
       file_url_1 = excluded.file_url_1,
       file_url_2 = excluded.file_url_2,
       username_selector = excluded.username_selector,
       password_selector = excluded.password_selector,
       submit_selector = excluded.submit_selector,
       updated_at = datetime('now')`
  ).run(
    academie,
    String(portalUrl).trim(),
    String(username).trim(),
    passwordEncrypted,
    String(fileUrl1).trim(),
    fileUrl2 ? String(fileUrl2).trim() : null,
    usernameSelector ? String(usernameSelector).trim() : null,
    passwordSelector ? String(passwordSelector).trim() : null,
    submitSelector ? String(submitSelector).trim() : null
  );
  res.json({ ok: true });
});

router.post("/run", async (req, res) => {
  const academie = resolveTargetAcademie(req.user!, req.body?.academie);
  if (academie === null) {
    res.status(403).json({ error: "Accès non autorisé." });
    return;
  }
  if (academie !== "" && !canAccessAcademie(req.user!, academie)) {
    res.status(403).json({ error: "Vous ne pouvez récupérer que les fichiers de votre académie." });
    return;
  }

  try {
    const result = await runScrapingAndImport(academie, req.user!.id);
    res.status(201).json(result);
  } catch (err) {
    res.status(502).json({ error: `Échec du scraping : ${(err as Error).message}` });
  }
});

/**
 * Horaires de déclenchement automatique du scraping (fonctionnalité
 * optionnelle) : jusqu'à 3 horaires "HH:MM" par jour, appliqués aux 1er et
 * 2nd degré ensemble pour une académie (comme le déclenchement manuel), ou
 * au national pour le CCMMEP. Vérifiés côté serveur toutes les minutes (voir
 * services/scrapingScheduler.ts).
 */
router.get("/schedule", (req, res) => {
  const academie = resolveTargetAcademie(req.user!, req.query.academie);
  if (academie === null) {
    res.status(403).json({ error: "Accès non autorisé." });
    return;
  }
  const row = getScrapingConfig(academie);
  res.json({ times: parseScheduleTimes(row?.schedule_times ?? null) });
});

router.put("/schedule", (req, res) => {
  const academie = resolveTargetAcademie(req.user!, req.body?.academie);
  if (academie === null) {
    res.status(403).json({ error: "Accès non autorisé." });
    return;
  }
  const { times } = req.body ?? {};
  if (!isValidScheduleTimes(times)) {
    res.status(400).json({ error: "Horaires invalides : 3 maximum, au format HH:MM." });
    return;
  }
  const row = getScrapingConfig(academie);
  if (!row) {
    res.status(400).json({ error: "Configurez d'abord les identifiants de scraping avant de programmer des horaires." });
    return;
  }
  db.prepare("UPDATE scraping_config SET schedule_times = ?, updated_at = datetime('now') WHERE academie = ?").run(
    JSON.stringify(times),
    academie
  );
  res.json({ ok: true });
});

export default router;
