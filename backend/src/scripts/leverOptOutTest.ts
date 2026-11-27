/**
 * Supprime une entrée de désinscription (relance_optout) pour un contact
 * donné — utile pour le scénario de test : lever la désinscription de
 * l'étape 3 avant l'envoi groupé de l'étape 4 (sinon tous les adhérents
 * fictifs, qui partagent le même mobile de test, seraient exclus).
 *
 * Usage (dans le conteneur backend) :
 *   npx tsx src/scripts/leverOptOutTest.ts <canal mail|sms> <contact>
 */
import { db, migrate } from "../db/index.js";

migrate();

const [canal, contact] = process.argv.slice(2);
if (!canal || !contact || (canal !== "mail" && canal !== "sms")) {
  console.error("Usage : npx tsx src/scripts/leverOptOutTest.ts <mail|sms> <contact>");
  process.exit(1);
}

const info = db.prepare("DELETE FROM relance_optout WHERE canal = ? AND contact = ?").run(canal, contact);
console.log(info.changes > 0 ? `Désinscription levée (${canal}) pour "${contact}".` : `Aucune désinscription trouvée (${canal}) pour "${contact}".`);
