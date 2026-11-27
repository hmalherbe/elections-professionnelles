/**
 * Supprime toutes les désinscriptions de test (relance_optout) créées par
 * le scénario de test des relances : les adresses fictives @exemple-test.fr
 * (opt-out mail en cascade déclenché par le mobile partagé entre tous les
 * adhérents fictifs — voir recordOptOutBothChannels), le mobile de test
 * partagé, et le mail de test lui-même.
 *
 * Usage (dans le conteneur backend) :
 *   npx tsx src/scripts/nettoyerOptOutTest.ts <mobile-de-test> <mail-de-test>
 */
import { db, migrate } from "../db/index.js";

migrate();

const [mobile, mail] = process.argv.slice(2);
if (!mobile || !mail) {
  console.error("Usage : npx tsx src/scripts/nettoyerOptOutTest.ts <mobile-de-test (ex. 33620053811)> <mail-de-test>");
  process.exit(1);
}

const tx = db.transaction(() => {
  const fakeEmails = db.prepare(`DELETE FROM relance_optout WHERE canal = 'mail' AND contact LIKE '%@exemple-test.fr'`).run();
  const testMobile = db.prepare(`DELETE FROM relance_optout WHERE canal = 'sms' AND contact = ?`).run(mobile);
  const testMail = db.prepare(`DELETE FROM relance_optout WHERE canal = 'mail' AND contact = ?`).run(mail);
  return { fakeEmails: fakeEmails.changes, testMobile: testMobile.changes, testMail: testMail.changes };
});

const result = tx();
console.log(`Adresses fictives (@exemple-test.fr) levées : ${result.fakeEmails}`);
console.log(`Mobile de test (${mobile}) levé : ${result.testMobile}`);
console.log(`Mail de test (${mail}) levé : ${result.testMail}`);
