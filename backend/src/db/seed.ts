import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, migrate } from "./index.js";
import { loadDepartementsWorkbook, loadAcademieScrutinsWorkbook, loadPsaWorkbook } from "../services/reference.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seedDir = path.resolve(__dirname, "../../../seed-data");

migrate();

const adminEmail = process.env.SEED_ADMIN_EMAIL || "admin@elections-pro.fr";
const adminPassword = process.env.SEED_ADMIN_PASSWORD || "ChangeMoi123!";

const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(adminEmail);
if (!existing) {
  db.prepare(
    `INSERT INTO users (email, password_hash, role, academie, spelc) VALUES (?, ?, 'admin_general', NULL, NULL)`
  ).run(adminEmail, bcrypt.hashSync(adminPassword, 10));
  console.log(`Compte admin général créé : ${adminEmail} / ${adminPassword}`);
} else {
  console.log("Compte admin général déjà présent, pas de recréation.");
}

async function main(): Promise<void> {
  const deptFile = path.join(seedDir, "departements-spelcs-academies.xlsx");
  if (fs.existsSync(deptFile)) {
    const result = await loadDepartementsWorkbook(fs.readFileSync(deptFile));
    console.log(`Référentiel départements/Spelc chargé : ${result.departements} départements, ${result.spelcs} Spelcs.`);
  }

  const scrutinsFile = path.join(seedDir, "academie-scrutins.xlsx");
  if (fs.existsSync(scrutinsFile)) {
    const result = await loadAcademieScrutinsWorkbook(fs.readFileSync(scrutinsFile));
    console.log(`Référentiel scrutins académiques chargé : ${result.count} académies.`);
  }

  const psaFile = path.join(seedDir, "psa.xlsx");
  if (fs.existsSync(psaFile)) {
    const result = await loadPsaWorkbook(fs.readFileSync(psaFile));
    console.log(`Liste des PSA chargée : ${result.count} présidents.`);
  }

  console.log("Seed terminé.");
}

main();
