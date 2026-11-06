/**
 * Nettoyage ponctuel : efface les valeurs de nom_naissance et de mobile
 * stockées par erreur sur des adhérents importés avant la correction des
 * replis positionnels/de validation dans /upload et /import-all (voir
 * backend/src/routes/adherents.ts).
 *
 *   - nom_naissance : une vraie valeur contient toujours au moins une lettre
 *     une fois normalisée (nom_naissance_norm), donc une ligne dont la
 *     normalisation est vide (ex. un numéro de mobile récupéré par erreur)
 *     ne peut pas être un nom légitime.
 *   - mobile : une vraie valeur ne contient jamais "@" ; un numéro qui en
 *     contient un est en réalité une adresse mail récupérée par erreur
 *     (colonne "Mobile" absente, repli positionnel tombant sur une colonne
 *     mail dupliquée).
 *
 * Usage (dans le conteneur backend) :
 *   npx tsx src/scripts/cleanupNomNaissance.ts
 */
import { db, migrate } from "../db/index.js";

migrate();

const badNomNaissance = db
  .prepare(
    `SELECT id, spelc, nom, prenom, nom_naissance
     FROM adherents
     WHERE nom_naissance IS NOT NULL AND TRIM(nom_naissance_norm) = ''`
  )
  .all() as { id: number; spelc: string; nom: string; prenom: string; nom_naissance: string }[];

const badMobile = db
  .prepare(
    `SELECT id, spelc, nom, prenom, mobile
     FROM adherents
     WHERE mobile IS NOT NULL AND mobile LIKE '%@%'`
  )
  .all() as { id: number; spelc: string; nom: string; prenom: string; mobile: string }[];

if (badNomNaissance.length === 0 && badMobile.length === 0) {
  console.log("Aucune valeur corrompue trouvée (nom_naissance ou mobile).");
  process.exit(0);
}

if (badNomNaissance.length > 0) {
  console.log(`${badNomNaissance.length} nom_naissance corrompu(s) trouvé(s) :`);
  for (const row of badNomNaissance) {
    console.log(`  [${row.spelc}] ${row.nom} ${row.prenom} — nom_naissance="${row.nom_naissance}"`);
  }
  const update = db.prepare(`UPDATE adherents SET nom_naissance = NULL, nom_naissance_norm = NULL WHERE id = ?`);
  const tx = db.transaction((rows: typeof badNomNaissance) => {
    for (const row of rows) update.run(row.id);
  });
  tx(badNomNaissance);
  console.log(`${badNomNaissance.length} nom_naissance corrigé(s).`);
}

if (badMobile.length > 0) {
  console.log(`${badMobile.length} mobile corrompu(s) trouvé(s) :`);
  for (const row of badMobile) {
    console.log(`  [${row.spelc}] ${row.nom} ${row.prenom} — mobile="${row.mobile}"`);
  }
  const update = db.prepare(`UPDATE adherents SET mobile = NULL WHERE id = ?`);
  const tx = db.transaction((rows: typeof badMobile) => {
    for (const row of rows) update.run(row.id);
  });
  tx(badMobile);
  console.log(`${badMobile.length} mobile corrigé(s).`);
}
