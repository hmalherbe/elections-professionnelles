/**
 * Diagnostic : compte et échantillonne le contenu de relance_optout, pour
 * distinguer des désinscriptions anciennes/réelles déjà présentes d'un
 * effet inattendu d'un test en cours.
 *
 * Usage (dans le conteneur backend) :
 *   npx tsx src/scripts/diagnosticOptOuts.ts
 */
import { db, migrate } from "../db/index.js";

migrate();

const total = (db.prepare("SELECT COUNT(*) AS c FROM relance_optout").get() as { c: number }).c;
console.log(`Total : ${total} désinscription(s).\n`);

const byCanal = db.prepare("SELECT canal, COUNT(*) AS c FROM relance_optout GROUP BY canal").all() as {
  canal: string;
  c: number;
}[];
for (const r of byCanal) console.log(`  ${r.canal} : ${r.c}`);

const byDate = db
  .prepare("SELECT date(created_at) AS jour, COUNT(*) AS c FROM relance_optout GROUP BY jour ORDER BY jour")
  .all() as { jour: string; c: number }[];
console.log("\nPar date de création :");
for (const r of byDate) console.log(`  ${r.jour} : ${r.c}`);

console.log("\n10 plus récentes :");
const recent = db.prepare("SELECT canal, contact, created_at FROM relance_optout ORDER BY created_at DESC LIMIT 10").all() as {
  canal: string;
  contact: string;
  created_at: string;
}[];
for (const r of recent) console.log(`  ${r.created_at} — ${r.canal} — ${r.contact}`);
