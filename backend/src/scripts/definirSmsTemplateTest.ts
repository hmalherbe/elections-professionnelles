/**
 * Définit (ou remplace) le modèle SMS d'UN SEUL Spelc, directement en base
 * — équivalent de la route PUT /brevo/templates/sms, mais sans passer par
 * l'appli (le champ est verrouillé en lecture seule côté compte Spelc
 * depuis le commit 5de5657, le modèle SMS se définissant désormais via
 * "appliquer à tous les Spelc" côté admin général, qui écraserait aussi
 * les autres Spelcs). Utile pour le scénario de test (voir
 * genererScenarioTest.ts) : ne touche que le Spelc fictif ciblé.
 *
 * Usage (dans le conteneur backend) :
 *   npx tsx src/scripts/definirSmsTemplateTest.ts "<spelc>" "<corps du modèle>"
 */
import { db, migrate } from "../db/index.js";

migrate();

const [spelc, body] = process.argv.slice(2);
if (!spelc || body === undefined) {
  console.error('Usage : npx tsx src/scripts/definirSmsTemplateTest.ts "<spelc>" "<corps du modèle>"');
  process.exit(1);
}

db.prepare(
  `INSERT INTO sms_templates (spelc, body, updated_at) VALUES (?, ?, datetime('now'))
   ON CONFLICT(spelc) DO UPDATE SET body = excluded.body, updated_at = datetime('now')`
).run(spelc, body);

console.log(`Modèle SMS mis à jour pour "${spelc}" :`);
console.log(body);
