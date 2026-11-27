/**
 * Supprime les lignes relance_tracking du jour pour des contacts donnés —
 * nécessaire pour ré-exercer une relance le même jour calendaire sans se
 * heurter à la protection anti-double-envoi (hasAlreadySent, voir
 * services/relanceTracking.ts), qui bloquerait sinon TOUT contact déjà
 * relancé aujourd'hui, qu'il ait voté depuis ou non — ce qui empêcherait
 * de distinguer les deux causes d'exclusion lors d'un nouveau test.
 *
 * Usage (dans le conteneur backend) :
 *   npx tsx src/scripts/effacerEnvoiDuJourTest.ts <type mail|sms> <contact> [<contact> ...]
 */
import { db, migrate } from "../db/index.js";

migrate();

const [type, ...contacts] = process.argv.slice(2);
if (!type || (type !== "mail" && type !== "sms") || contacts.length === 0) {
  console.error("Usage : npx tsx src/scripts/effacerEnvoiDuJourTest.ts <mail|sms> <contact> [...]");
  process.exit(1);
}

const del = db.prepare("DELETE FROM relance_tracking WHERE type = ? AND contact = ? AND date(created_at) = date('now')");
for (const contact of contacts) {
  const info = del.run(type, contact);
  console.log(`${contact} : ${info.changes} ligne(s) supprimée(s).`);
}
