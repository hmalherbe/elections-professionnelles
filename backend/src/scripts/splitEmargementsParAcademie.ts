/**
 * Découpe un fichier national d'émargements CCMMEP (format { totalCount,
 * items }) en deux fichiers JSON par académie (1er et 2nd degré), nommés
 * <Academie>-<TypeScrutin>.json (ex. Nice-CCMI.json pour le 1er degré,
 * Nice-CCMA.json pour le 2nd degré) — même logique que la fonctionnalité
 * "Charger les électeurs des académies" de l'onglet Électeurs académiques :
 *   1. Académie déterminée via le code postal de "affectation", résolu en
 *      département puis en académie (référentiel Départements/Spelcs/
 *      Académies) — voir buildEmargementRow() à l'import réel.
 *   2. Degré déterminé via le nom de l'établissement : "COLLEGE"/"LYCEE" ->
 *      2nd degré, "ECOLE" -> 1er degré, sinon tirage aléatoire faute de
 *      règle plus précise (classifyDegreFromEtablissement(), même fonction
 *      que buildElecteursAcademiques()).
 *   3. Type de scrutin (CCMI/CCMA/CCMD/CCML1D/CCML2D...) résolu par académie
 *      et degré via le référentiel Scrutins académiques.
 *
 * Usage :
 *   npx tsx src/scripts/splitEmargementsParAcademie.ts <emargements.json> <referentiel_departements.xlsx> <referentiel_scrutins.xlsx> <dossier_sortie>
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { RawEmargementItem } from "../parsers/emargements.js";

const [, , jsonPath, deptXlsxPath, scrutinsXlsxPath, outDir] = process.argv;
if (!jsonPath || !deptXlsxPath || !scrutinsXlsxPath || !outDir) {
  console.error(
    "Usage: tsx splitEmargementsParAcademie.ts <emargements.json> <referentiel_departements.xlsx> <referentiel_scrutins.xlsx> <dossier_sortie>"
  );
  process.exit(1);
}

// Base temporaire dédiée : ce script ne doit jamais toucher la base réelle
// (prod/sandbox), seulement s'en servir pour réutiliser lookupDepartement()
// et getAcademieScrutins().
process.env.DATABASE_PATH = path.join(os.tmpdir(), `split-emargements-${Date.now()}.sqlite`);

const { migrate } = await import("../db/index.js");
const { loadDepartementsWorkbook, loadAcademieScrutinsWorkbook, lookupDepartement } = await import(
  "../services/reference.js"
);
const { getAcademieScrutins } = await import("../services/imports.js");
const { extractDepartement, extractDepartementFromRne } = await import("../lib/departement.js");
const { parseEmargementsJson } = await import("../parsers/emargements.js");
const { classifyDegreFromEtablissement } = await import("../services/electeursAcademiques.js");

migrate();
const { departements, spelcs } = await loadDepartementsWorkbook(fs.readFileSync(deptXlsxPath));
console.log(`Référentiel départements chargé : ${departements} département(s), ${spelcs} Spelc(s).`);
const { count: scrutinsCount } = await loadAcademieScrutinsWorkbook(fs.readFileSync(scrutinsXlsxPath));
console.log(`Référentiel scrutins chargé : ${scrutinsCount} académie(s).`);

const raw = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
const items = parseEmargementsJson(raw);
console.log(`${items.length} émargement(s) à répartir.`);

const byFile = new Map<string, RawEmargementItem[]>();
const unmatchedByDept = new Map<string, number>();
const sansTypeScrutin = new Map<string, number>();
let unmatchedTotal = 0;

for (const item of items) {
  const departement =
    extractDepartementFromRne((item as RawEmargementItem & { rne?: string }).rne) ?? extractDepartement(item.affectation);
  const academie = departement ? lookupDepartement(departement)?.academie ?? null : null;
  if (!academie) {
    unmatchedTotal++;
    const key = departement ?? "(aucun code postal reconnu)";
    unmatchedByDept.set(key, (unmatchedByDept.get(key) ?? 0) + 1);
    continue;
  }

  const degre = classifyDegreFromEtablissement(item.affectation, `${item.nom}|${item.prenom}`);
  const scrutins = getAcademieScrutins(academie);
  const scrutinType = degre === "1D" ? scrutins.type1d : scrutins.type2d;
  if (!scrutinType) {
    sansTypeScrutin.set(academie, (sansTypeScrutin.get(academie) ?? 0) + 1);
    continue;
  }

  const fileKey = `${academie}-${scrutinType}`;
  const arr = byFile.get(fileKey) ?? [];
  arr.push(item);
  byFile.set(fileKey, arr);
}

fs.mkdirSync(outDir, { recursive: true });
const written: { fileKey: string; count: number; file: string }[] = [];
for (const [fileKey, fileItems] of [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const filePath = path.join(outDir, `${fileKey}.json`);
  fs.writeFileSync(filePath, JSON.stringify({ totalCount: fileItems.length, items: fileItems }, null, 2), "utf-8");
  written.push({ fileKey, count: fileItems.length, file: filePath });
}

console.log("\nFichiers académiques écrits (1er et 2nd degré) :");
for (const w of written) console.log(`  ${w.fileKey.padEnd(22)} ${String(w.count).padStart(6)} émargement(s)  -> ${w.file}`);
const totalWritten = written.reduce((s, w) => s + w.count, 0);
console.log(`\nTotal réparti : ${totalWritten} / ${items.length}`);

if (unmatchedTotal > 0) {
  console.log(`\n${unmatchedTotal} émargement(s) NON réparti(s) (département absent du référentiel) :`);
  for (const [dept, count] of [...unmatchedByDept.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  département ${dept.padEnd(28)} ${count} émargement(s)`);
  }
}

if (sansTypeScrutin.size > 0) {
  console.log(`\nÉmargements exclus faute de type de scrutin défini pour l'académie (référentiel scrutins incomplet) :`);
  for (const [academie, count] of [...sansTypeScrutin.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${academie.padEnd(28)} ${count} émargement(s)`);
  }
}

fs.rmSync(process.env.DATABASE_PATH, { force: true });
fs.rmSync(process.env.DATABASE_PATH + "-wal", { force: true });
fs.rmSync(process.env.DATABASE_PATH + "-shm", { force: true });
