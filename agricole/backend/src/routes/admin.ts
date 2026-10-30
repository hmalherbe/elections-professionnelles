import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { isBrevoApiKeyConfigured, maskedBrevoApiKey, saveBrevoApiKey } from "../services/brevo.js";
import { getOrgSettings, updateOrgSettings } from "../services/orgSettings.js";

const router = Router();

router.use(requireAuth);

/**
 * Comptes administrateurs : plusieurs comptes peuvent coexister, tous avec
 * les mêmes droits (pas de rôle/périmètre à choisir, contrairement à
 * l'application éducation nationale).
 */
router.get("/users", (_req, res) => {
  const rows = db
    .prepare("SELECT id, email, nom, prenom, must_change_password, created_at FROM users ORDER BY created_at DESC")
    .all();
  res.json({ users: rows });
});

router.post("/users", (req, res) => {
  const { email, password, nom, prenom } = req.body ?? {};
  if (!email || !password) {
    res.status(400).json({ error: "Email et mot de passe sont requis." });
    return;
  }
  try {
    const info = db
      .prepare("INSERT INTO users (email, password_hash, nom, prenom) VALUES (?, ?, ?, ?)")
      .run(String(email).toLowerCase().trim(), bcrypt.hashSync(String(password), 10), nom ?? null, prenom ?? null);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch {
    res.status(409).json({ error: "Un compte existe déjà avec cet email." });
  }
});

/** Un administrateur ne peut pas supprimer son propre compte, pour ne jamais se retrouver sans accès. */
router.delete("/users/:id", (req, res) => {
  if (Number(req.params.id) === req.user!.id) {
    res.status(400).json({ error: "Impossible de supprimer son propre compte." });
    return;
  }
  db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

router.get("/brevo-settings", (_req, res) => {
  res.json({ configured: isBrevoApiKeyConfigured(), maskedKey: maskedBrevoApiKey() });
});

router.put("/brevo-settings", (req, res) => {
  const { apiKey } = req.body ?? {};
  if (!apiKey || typeof apiKey !== "string") {
    res.status(400).json({ error: "Clé API Brevo requise." });
    return;
  }
  saveBrevoApiKey(apiKey.trim());
  res.json({ ok: true });
});

router.get("/org-settings", (_req, res) => {
  res.json(getOrgSettings());
});

router.put("/org-settings", (req, res) => {
  const { logoDataUri, socialLinks, testEmail } = req.body ?? {};
  updateOrgSettings({
    logoDataUri: typeof logoDataUri === "string" ? logoDataUri : undefined,
    socialLinks: socialLinks && typeof socialLinks === "object" ? socialLinks : undefined,
    testEmail: typeof testEmail === "string" ? testEmail : undefined,
  });
  res.json({ ok: true });
});

export default router;
