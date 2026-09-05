import { Router } from "express";
import { db } from "../db/index.js";
import { requireAuth, canAccessAcademie } from "../middleware/auth.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import { scrapePortalFiles } from "../services/scraper.js";
import { runImport, defaultSnapshotDate } from "../services/imports.js";

const router = Router();
router.use(requireAuth);

interface ScrapingConfigRow {
  academie: string;
  portal_url: string;
  username: string;
  password_encrypted: string;
  file_url_1: string;
  file_url_2: string | null;
  username_selector: string | null;
  password_selector: string | null;
  submit_selector: string | null;
  updated_at: string;
}

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

router.get("/config", (req, res) => {
  const academie = resolveTargetAcademie(req.user!, req.query.academie);
  if (academie === null) {
    res.status(403).json({ error: "Accès non autorisé." });
    return;
  }
  const row = db.prepare("SELECT * FROM scraping_config WHERE academie = ?").get(academie) as
    | ScrapingConfigRow
    | undefined;
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
  const row = db.prepare("SELECT * FROM scraping_config WHERE academie = ?").get(academie) as
    | ScrapingConfigRow
    | undefined;
  if (!row) {
    res.status(400).json({ error: "Aucune configuration de scraping enregistrée pour ce périmètre." });
    return;
  }
  if (academie !== "" && !row.file_url_2) {
    res.status(400).json({ error: "Une deuxième URL (2nd degré) est requise pour un scraping académique." });
    return;
  }

  try {
    const { file1, file2 } = await scrapePortalFiles({
      portalUrl: row.portal_url,
      username: row.username,
      password: decrypt(row.password_encrypted),
      fileUrl1: row.file_url_1,
      fileUrl2: row.file_url_2,
      usernameSelector: row.username_selector,
      passwordSelector: row.password_selector,
      submitSelector: row.submit_selector,
    });

    const snapshotDate = defaultSnapshotDate();
    if (academie === "") {
      const result = runImport(JSON.parse(file1), {
        scope: "national",
        academie: null,
        degre: null,
        filename: "scraping-ccmmep.json",
        importedBy: req.user!.id,
        snapshotDate,
      });
      res.status(201).json({ national: result });
    } else {
      const result1D = runImport(JSON.parse(file1), {
        scope: "academique",
        academie,
        degre: "1D",
        filename: "scraping-1d.json",
        importedBy: req.user!.id,
        snapshotDate,
      });
      const result2D = runImport(JSON.parse(file2!), {
        scope: "academique",
        academie,
        degre: "2D",
        filename: "scraping-2d.json",
        importedBy: req.user!.id,
        snapshotDate,
      });
      res.status(201).json({ degre1D: result1D, degre2D: result2D });
    }
  } catch (err) {
    res.status(502).json({ error: `Échec du scraping : ${(err as Error).message}` });
  }
});

export default router;
