/**
 * Nettoyage ponctuel : efface les valeurs de nom_naissance stockées par
 * erreur sur des adhérents importés avant la correction du repli positionnel
 * dans /upload (voir backend/src/routes/adherents.ts). Une vraie valeur de
 * nom_naissance contient toujours au moins une lettre une fois normalisée
 * (nom_naissance_norm), donc une ligne dont la normalisation est vide (ex. un
 * numéro de mobile récupéré par erreur) ne peut pas être un nom légitime.
 *
 * Usage (dans le conteneur backend) :
 *   npx tsx src/scripts/cleanupNomNaissance.ts
 */
import { db, migrate } from "../db/index.js";

migrate();

const bad = db
  .prepare(
    `SELECT id, spelc, nom, prenom, nom_naissance
     FROM adherents
     WHERE nom_naissance IS NOT NULL AND TRIM(nom_naissance_norm) = ''`
  )
  .all() as { id: number; spelc: string; nom: string; prenom: string; nom_naissance: string }[];

if (bad.length === 0) {
  console.log("Aucune valeur de nom_naissance corrompue trouvée.");
  process.exit(0);
}

console.log(`${bad.length} ligne(s) corrompue(s) trouvée(s) :`);
for (const row of bad) {
  console.log(`  [${row.spelc}] ${row.nom} ${row.prenom} — nom_naissance="${row.nom_naissance}"`);
}

const update = db.prepare(`UPDATE adherents SET nom_naissance = NULL, nom_naissance_norm = NULL WHERE id = ?`);
const tx = db.transaction((rows: typeof bad) => {
  for (const row of rows) update.run(row.id);
});
tx(bad);

console.log(`${bad.length} ligne(s) corrigée(s).`);
