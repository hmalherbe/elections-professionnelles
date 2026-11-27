/**
 * Limite le nombre d'adhérents ciblés par SMS pour un Spelc de test : ne
 * garde le mobile (partagé, pointant vers le vrai téléphone de test) que
 * sur les N premiers adhérents (par id), vide celui de tous les autres
 * (NULL) — l'envoi réel de SMS filtre sur `r.mobile` truthy (voir
 * routes/brevo.ts), donc un mobile vide = non ciblé. Ne touche jamais au
 * mail (l'envoi mail groupé peut continuer à viser tous les adhérents du
 * Spelc, leurs adresses fictives ne délivrant nulle part).
 *
 * Usage (dans le conteneur backend) :
 *   npx tsx src/scripts/limiterCibleSmsTest.ts "<spelc>" <nombre à garder>
 */
import { db, migrate } from "../db/index.js";

migrate();

const [spelc, nStr] = process.argv.slice(2);
const n = Number(nStr);
if (!spelc || !Number.isFinite(n) || n < 0) {
  console.error('Usage : npx tsx src/scripts/limiterCibleSmsTest.ts "<spelc>" <nombre à garder>');
  process.exit(1);
}

const avecMobile = db
  .prepare("SELECT id, nom, prenom, mobile FROM adherents WHERE spelc = ? AND mobile IS NOT NULL ORDER BY id")
  .all(spelc) as { id: number; nom: string; prenom: string; mobile: string }[];

const garder = avecMobile.slice(0, n);
const vider = avecMobile.slice(n);

const tx = db.transaction(() => {
  const clear = db.prepare("UPDATE adherents SET mobile = NULL WHERE id = ?");
  for (const a of vider) clear.run(a.id);
});
tx();

console.log(`Spelc "${spelc}" : ${avecMobile.length} adhérent(s) avaient un mobile.`);
console.log(`\n${garder.length} conservé(s) (ciblé(s) par SMS) :`);
for (const a of garder) console.log(`  - ${a.nom} ${a.prenom} (mobile=${a.mobile})`);
console.log(`\n${vider.length} vidé(s) (plus ciblé(s) par SMS, mail inchangé).`);
