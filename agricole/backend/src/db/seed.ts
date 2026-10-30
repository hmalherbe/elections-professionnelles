import bcrypt from "bcryptjs";
import { db, migrate } from "./index.js";

migrate();

const adminEmail = process.env.SEED_ADMIN_EMAIL || "admin@elections-agricole.fr";
const adminPassword = process.env.SEED_ADMIN_PASSWORD || "ChangeMoi123!";

const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(adminEmail);
if (!existing) {
  db.prepare(`INSERT INTO users (email, password_hash, nom, prenom) VALUES (?, ?, 'Administrateur', 'Général')`).run(
    adminEmail,
    bcrypt.hashSync(adminPassword, 10)
  );
  console.log(`Compte administrateur créé : ${adminEmail} / ${adminPassword}`);
} else {
  console.log("Compte administrateur déjà présent, pas de recréation.");
}
