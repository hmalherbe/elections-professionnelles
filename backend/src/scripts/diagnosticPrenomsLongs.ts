/**
 * Liste les adhérents dont le prénom dépasse un seuil de longueur — utile
 * pour savoir si le modèle SMS risque de dépasser 160 caractères (1 segment
 * GSM-7, 4,5 crédits Brevo) pour certains destinataires (voir modèle SMS :
 * marge de 19 caractères au-delà de "CATHERINE", soit un prénom de 28
 * caractères maximum avant de basculer à 2 segments/9 crédits).
 *
 * Usage (dans le conteneur backend) :
 *   npx tsx src/scripts/diagnosticPrenomsLongs.ts [seuil]   # défaut : 28
 */
import { db, migrate } from "../db/index.js";

migrate();

const seuil = Number(process.argv[2] ?? 28);

interface Row {
  spelc: string;
  prenom: string;
  nom: string;
  longueur: number;
}

const rows = db
  .prepare(
    `SELECT spelc, prenom, nom, length(prenom) AS longueur
     FROM adherents
     WHERE length(prenom) > ?
     ORDER BY longueur DESC, spelc`
  )
  .all(seuil) as Row[];

if (rows.length === 0) {
  console.log(`Aucun adhérent avec un prénom de plus de ${seuil} caractères.`);
} else {
  console.log(`${rows.length} adhérent(s) avec un prénom de plus de ${seuil} caractères :\n`);
  for (const r of rows) {
    console.log(`${r.spelc} : "${r.prenom}" ${r.nom} (${r.longueur} caractères)`);
  }
}
