/**
 * Diagnostic pour l'étape 3 du scénario de test des relances : vérifie,
 * pour un contact donné (mail ou mobile), s'il est enregistré comme
 * désinscrit (table relance_optout) — après avoir cliqué sur le lien de
 * désinscription d'un mail/SMS de test, ce contact ET son autre canal
 * (mail<->mobile, via l'adhérent correspondant) doivent apparaître ici.
 *
 * Usage (dans le conteneur backend) :
 *   npx tsx src/scripts/verifierOptOut.ts <contact>
 */
import { db, migrate } from "../db/index.js";

migrate();

const contact = process.argv[2];
if (!contact) {
  console.error("Usage : npx tsx src/scripts/verifierOptOut.ts <contact>");
  process.exit(1);
}

const rows = db.prepare("SELECT canal, contact, created_at FROM relance_optout WHERE contact = ?").all(contact) as {
  canal: string;
  contact: string;
  created_at: string;
}[];

if (rows.length === 0) {
  console.log(`Aucune désinscription enregistrée pour "${contact}".`);
} else {
  for (const r of rows) {
    console.log(`Désinscrit (${r.canal}) : ${r.contact} — depuis le ${r.created_at}`);
  }
}

// Montre aussi l'autre canal (mail<->mobile) via l'adhérent correspondant,
// pour confirmer que la désinscription croisée (recordOptOutBothChannels)
// a bien fonctionné.
const linked = db
  .prepare("SELECT mail, mobile FROM adherents WHERE LOWER(TRIM(mail)) = ? OR mobile = ?")
  .all(contact, contact) as { mail: string | null; mobile: string | null }[];
for (const l of linked) {
  console.log(`Adhérent lié : mail=${l.mail ?? "—"} mobile=${l.mobile ?? "—"}`);
}
