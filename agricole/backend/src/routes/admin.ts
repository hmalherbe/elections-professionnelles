import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "../db/index.js";
import { requireAuth, requireFullAdmin, type UserRole } from "../middleware/auth.js";
import { isBrevoApiKeyConfigured, maskedBrevoApiKey, saveBrevoApiKey } from "../services/brevo.js";
import { getOrgSettings, updateOrgSettings } from "../services/orgSettings.js";
import { resetImportedData } from "../services/imports.js";

const router = Router();

router.use(requireAuth);

function isUserRole(value: unknown): value is UserRole {
  return value === "admin_complet" || value === "admin_restreint";
}

/**
 * Comptes administrateurs : réservé à l'administration complète (voir
 * requireFullAdmin) — un compte restreint ne doit même pas savoir combien
 * d'autres comptes existent, ni pouvoir en créer ou en supprimer.
 */
router.get("/users", requireFullAdmin, (_req, res) => {
  const rows = db
    .prepare("SELECT id, email, nom, prenom, role, must_change_password, created_at FROM users ORDER BY created_at DESC")
    .all();
  res.json({ users: rows });
});

router.post("/users", requireFullAdmin, (req, res) => {
  const { email, password, nom, prenom, role } = req.body ?? {};
  if (!email || !password) {
    res.status(400).json({ error: "Email et mot de passe sont requis." });
    return;
  }
  if (role !== undefined && !isUserRole(role)) {
    res.status(400).json({ error: "Rôle invalide (attendu : admin_complet ou admin_restreint)." });
    return;
  }
  try {
    const info = db
      .prepare("INSERT INTO users (email, password_hash, nom, prenom, role) VALUES (?, ?, ?, ?, ?)")
      .run(
        String(email).toLowerCase().trim(),
        bcrypt.hashSync(String(password), 10),
        nom ?? null,
        prenom ?? null,
        role ?? "admin_complet"
      );
    res.status(201).json({ id: info.lastInsertRowid });
  } catch {
    res.status(409).json({ error: "Un compte existe déjà avec cet email." });
  }
});

/** Un administrateur ne peut pas supprimer son propre compte, pour ne jamais se retrouver sans accès. */
router.delete("/users/:id", requireFullAdmin, (req, res) => {
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
  const { socialLinks, testEmail } = req.body ?? {};
  updateOrgSettings({
    socialLinks: socialLinks && typeof socialLinks === "object" ? socialLinks : undefined,
    testEmail: typeof testEmail === "string" ? testEmail : undefined,
  });
  res.json({ ok: true });
});

/**
 * Réinitialise l'application : supprime toutes les émargements (2 scrutins)
 * et tous les adhérents — voir onglet Paramètres, services/imports.ts#resetImportedData().
 * Réservé à l'administration complète (action destructrice, même niveau
 * que l'onglet Imports).
 */
router.post("/reset-imported-data", requireFullAdmin, (_req, res) => {
  res.json(resetImportedData());
});

export default router;
