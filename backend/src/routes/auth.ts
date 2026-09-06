import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "../db/index.js";
import { requireAuth, signToken, type AuthUser } from "../middleware/auth.js";
import { createPasswordResetToken, consumePasswordResetToken, sendPasswordResetEmail } from "../services/passwordReset.js";

interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  role: AuthUser["role"];
  academie: string | null;
  spelc: string | null;
  must_change_password: number;
}

const router = Router();

router.post("/login", (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    res.status(400).json({ error: "Email et mot de passe requis." });
    return;
  }
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(String(email).toLowerCase()) as
    | UserRow
    | undefined;
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    res.status(401).json({ error: "Identifiants incorrects." });
    return;
  }
  const user: AuthUser = {
    id: row.id,
    email: row.email,
    role: row.role,
    academie: row.academie,
    spelc: row.spelc,
    mustChangePassword: Boolean(row.must_change_password),
  };
  res.json({ token: signToken(user), user });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.put("/change-password", requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "Mot de passe actuel et nouveau mot de passe requis." });
    return;
  }
  if (String(newPassword).length < 8) {
    res.status(400).json({ error: "Le nouveau mot de passe doit faire au moins 8 caractères." });
    return;
  }
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user!.id) as UserRow;
  if (!bcrypt.compareSync(currentPassword, row.password_hash)) {
    res.status(401).json({ error: "Mot de passe actuel incorrect." });
    return;
  }
  db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(
    bcrypt.hashSync(String(newPassword), 10),
    row.id
  );
  const user: AuthUser = {
    id: row.id,
    email: row.email,
    role: row.role,
    academie: row.academie,
    spelc: row.spelc,
    mustChangePassword: false,
  };
  res.json({ token: signToken(user), user });
});

const GENERIC_FORGOT_MESSAGE =
  "Si un compte existe avec cet e-mail, un lien de réinitialisation vient de lui être envoyé.";

/**
 * Toujours la même réponse, que l'e-mail corresponde ou non à un compte
 * (et même en cas d'échec d'envoi) : ne jamais révéler si une adresse est
 * enregistrée. Les échecs réels (config manquante, erreur Brevo...) sont
 * seulement journalisés côté serveur.
 */
router.post("/forgot-password", async (req, res) => {
  const { email } = req.body ?? {};
  if (!email) {
    res.status(400).json({ error: "Email requis." });
    return;
  }
  try {
    const row = db.prepare("SELECT id, email FROM users WHERE email = ?").get(String(email).toLowerCase()) as
      | { id: number; email: string }
      | undefined;
    if (row) {
      const rawToken = createPasswordResetToken(row.id);
      const baseUrl = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
      const resetUrl = `${baseUrl}/reset-password?token=${rawToken}`;
      await sendPasswordResetEmail(row.email, resetUrl);
    }
  } catch (err) {
    console.error("Échec de l'envoi de l'e-mail de réinitialisation :", err);
  }
  res.json({ message: GENERIC_FORGOT_MESSAGE });
});

router.post("/reset-password", (req, res) => {
  const { token, newPassword } = req.body ?? {};
  if (!token || !newPassword) {
    res.status(400).json({ error: "Lien de réinitialisation et nouveau mot de passe requis." });
    return;
  }
  if (String(newPassword).length < 8) {
    res.status(400).json({ error: "Le nouveau mot de passe doit faire au moins 8 caractères." });
    return;
  }
  const userId = consumePasswordResetToken(String(token));
  if (!userId) {
    res.status(400).json({ error: "Ce lien de réinitialisation est invalide ou a expiré. Refaites une demande." });
    return;
  }
  db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(
    bcrypt.hashSync(String(newPassword), 10),
    userId
  );
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRow;
  const user: AuthUser = {
    id: row.id,
    email: row.email,
    role: row.role,
    academie: row.academie,
    spelc: row.spelc,
    mustChangePassword: false,
  };
  res.json({ token: signToken(user), user });
});

export default router;
