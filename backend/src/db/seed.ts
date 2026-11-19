import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, migrate } from "./index.js";
import { loadDepartementsWorkbook, loadAcademieScrutinsWorkbook } from "../services/reference.js";

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

/**
 * Ce script tourne à CHAQUE démarrage du conteneur (voir Dockerfile.backend
 * : `node dist/db/seed.js && node dist/index.js`), pas seulement à la toute
 * première installation. loadDepartementsWorkbook()/loadAcademieScrutinsWorkbook()
 * remplacent intégralement ref_departements/ref_spelc/ref_academie_scrutins
 * (DELETE puis réinsertion) : les charger sans condition écraserait, à
 * chaque redéploiement, le référentiel réel (configuré ou mis à jour depuis
 * via l'onglet Référentiels) par le fichier figé du dépôt — déjà la cause
 * de plusieurs cas de "Spelc introuvable"/"0 Spelc chargés" observés après
 * un déploiement. On ne charge donc ces fichiers que si la base est encore
 * vierge (première installation).
 */
async function main(): Promise<void> {
  const deptCount = (db.prepare("SELECT COUNT(*) AS c FROM ref_departements").get() as { c: number }).c;
  if (deptCount === 0) {
    const deptFile = path.join(seedDir, "departements-spelcs-academies.xlsx");
    if (fs.existsSync(deptFile)) {
      const result = await loadDepartementsWorkbook(fs.readFileSync(deptFile));
      console.log(`Référentiel départements/Spelc chargé (première installation) : ${result.departements} départements, ${result.spelcs} Spelcs.`);
    }
  } else {
    console.log("Référentiel départements/Spelc déjà présent, pas de rechargement.");
  }

  const scrutinsCount = (db.prepare("SELECT COUNT(*) AS c FROM ref_academie_scrutins").get() as { c: number }).c;
  if (scrutinsCount === 0) {
    const scrutinsFile = path.join(seedDir, "academie-scrutins.xlsx");
    if (fs.existsSync(scrutinsFile)) {
      const result = await loadAcademieScrutinsWorkbook(fs.readFileSync(scrutinsFile));
      console.log(`Référentiel scrutins académiques chargé (première installation) : ${result.count} académies.`);
    }
  } else {
    console.log("Référentiel scrutins académiques déjà présent, pas de rechargement.");
  }

  console.log("Seed terminé.");
}

main();
