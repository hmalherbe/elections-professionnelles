/**
 * Affiche le texte brut (JSON.stringify, pour voir les espaces/caractères
 * invisibles exacts) du modèle SMS d'un Spelc — diagnostic pour ajuster les
 * remplacements de raccourcirSmsTemplates.ts si le texte réel diffère de ce
 * qui est attendu.
 *
 * Usage (dans le conteneur backend) :
 *   npx tsx src/scripts/afficherSmsTemplate.ts "Franche-Comté"
 */
import { db, migrate } from "../db/index.js";

migrate();

const spelc = process.argv[2];
if (!spelc) {
  console.error("Usage : npx tsx src/scripts/afficherSmsTemplate.ts \"<nom du Spelc>\"");
  process.exit(1);
}

const row = db.prepare("SELECT body FROM sms_templates WHERE spelc = ?").get(spelc) as
  | { body: string }
  | undefined;

if (!row) {
  console.log(`Aucun modèle SMS trouvé pour "${spelc}".`);
} else {
  console.log(JSON.stringify(row.body));
}
