import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "../db/index.js";
import { requireAuth, signToken, type AuthUser } from "../middleware/auth.js";

interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  role: AuthUser["role"];
  academie: string | null;
  spelc: string | null;
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
  };
  res.json({ token: signToken(user), user });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
