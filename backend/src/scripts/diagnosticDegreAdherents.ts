/**
 * Diagnostic en lecture seule (aucune écriture en base) : pour l'import
 * national courant, répartit les électeurs reconnus comme adhérents (même
 * règle que adherentExistsClause(), voir services/fuzzyMatching.ts) par
 * degré (1D/2D/INDETERMINE) — sert à vérifier pourquoi les colonnes "Taux
 * adhérents CCMI/CCMA" de la Vue nationale (onglet admin général) peuvent
 * rester vides alors que les colonnes "Taux CCMI/CCMA" (tous électeurs) et
 * la colonne "Taux de participation (adhérents)" de l'onglet "Participation
 * par établissement" (qui ne dépend pas du degré) sont, elles, renseignées :
 * si la quasi-totalité des adhérents rapprochés a un degré INDETERMINE au
 * niveau de l'import national (classifyDegre(corps) seul, sans le repli sur
 * l'établissement utilisé par les scripts de répartition académique), les
 * deux colonnes concernées sont vides par construction, pas par bug de
 * rapprochement.
 *
 * Usage (dans le conteneur backend) :
 *   npx tsx src/scripts/diagnosticDegreAdherents.ts [spelc]
 * Sans argument : tous les Spelcs ayant des adhérents. Avec un nom de
 * Spelc : détail nominatif (corps + établissement) des cas INDETERMINE pour
 * ce seul Spelc.
 */
import { db, migrate } from "../db/index.js";
import { currentImportIds } from "../services/stats.js";
import { adherentExistsClause } from "../services/fuzzyMatching.js";

migrate();

const onlySpelc = process.argv[2] || null;

const [nationalImportId] = currentImportIds("national", null);
if (!nationalImportId) {
  console.error("Aucun import national CCMMEP disponible.");
  process.exit(1);
}

const spelcs = (
  db.prepare(`SELECT DISTINCT spelc FROM adherents ${onlySpelc ? "WHERE spelc = ?" : ""} ORDER BY spelc`).all(
    ...(onlySpelc ? [onlySpelc] : [])
  ) as { spelc: string }[]
).map((r) => r.spelc);

if (onlySpelc && spelcs.length === 0) {
  console.error(`Aucun adhérent pour le Spelc "${onlySpelc}".`);
  process.exit(1);
}

const adherentExists = adherentExistsClause();

interface Row {
  nom: string;
  prenom: string;
  corps: string | null;
  affectation: string | null;
  degre: string;
  spelc: string;
}

let total1D = 0;
let total2D = 0;
let totalIndetermine = 0;
const indetermineRows: Row[] = [];

for (const spelc of spelcs) {
  const rows = db
    .prepare(
      `SELECT DISTINCT e.nom, e.prenom, e.corps, e.affectation, e.degre, e.spelc
       FROM emargements e
       WHERE e.import_id = ? AND e.spelc = ? AND ${adherentExists}`
    )
    .all(nationalImportId, spelc) as Row[];

  const d1 = rows.filter((r) => r.degre === "1D").length;
  const d2 = rows.filter((r) => r.degre === "2D").length;
  const dInd = rows.filter((r) => r.degre === "INDETERMINE").length;
  total1D += d1;
  total2D += d2;
  totalIndetermine += dInd;
  if (onlySpelc) indetermineRows.push(...rows.filter((r) => r.degre === "INDETERMINE"));

  console.log(`${spelc.padEnd(28)} adhérents rapprochés (national) : ${rows.length.toString().padStart(4)}  1D=${d1}  2D=${d2}  INDETERMINE=${dInd}`);

  // Pour comparaison : répartition par degré de TOUS les électeurs de ce
  // Spelc (pas seulement les adhérents rapprochés) — distingue "la
  // vocabulaire de corps ne classe quasiment jamais en 1D pour ce Spelc"
  // (vrai pour tout le monde, pas spécifique aux adhérents) de "le 1D
  // existe bien dans les électeurs, mais aucun adhérent n'y est rapproché"
  // (problème de rapprochement, pas de vocabulaire).
  if (onlySpelc) {
    const allElecteurs = db
      .prepare(`SELECT degre, corps FROM emargements WHERE import_id = ? AND spelc = ?`)
      .all(nationalImportId, spelc) as { degre: string; corps: string | null }[];
    const e1 = allElecteurs.filter((r) => r.degre === "1D").length;
    const e2 = allElecteurs.filter((r) => r.degre === "2D").length;
    const eInd = allElecteurs.filter((r) => r.degre === "INDETERMINE").length;
    console.log(`${"".padEnd(28)} TOUS les électeurs de ce Spelc (national) : ${allElecteurs.length.toString().padStart(4)}  1D=${e1}  2D=${e2}  INDETERMINE=${eInd}`);

    const corpsIndetermine = [...new Set(allElecteurs.filter((r) => r.degre === "INDETERMINE").map((r) => r.corps ?? "(vide)"))].sort();
    console.log(`\nCorps distincts classés INDETERMINE parmi TOUS les électeurs de ${spelc} (${corpsIndetermine.length} valeur(s) distincte(s)) :`);
    for (const c of corpsIndetermine) console.log(`  "${c}"`);
  }
}

console.log(`\nTotal (adhérents rapprochés) : 1D=${total1D}  2D=${total2D}  INDETERMINE=${totalIndetermine}`);

if (onlySpelc && indetermineRows.length > 0) {
  console.log(`\nDétail des adhérents rapprochés classés INDETERMINE pour ${onlySpelc} (corps + établissement, tels que reçus à l'import national) :`);
  for (const r of indetermineRows) {
    console.log(`  ${r.nom} ${r.prenom}  corps="${r.corps ?? ""}"  établissement="${r.affectation ?? ""}"`);
  }
}
