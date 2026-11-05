/**
 * Découpe un fichier national d'émargements CCMMEP (format { totalCount,
 * items }) en un fichier JSON par académie, à partir du code postal du champ
 * "affectation" de chaque électeur, résolu en département puis en académie
 * via le référentiel Départements/Spelcs/Académies (même logique que
 * buildEmargementRow() à l'import réel — voir parsers/emargements.ts).
 *
 * Usage :
 *   npx tsx src/scripts/splitEmargementsParAcademie.ts <emargements.json> <referentiel.xlsx> <dossier_sortie>
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { RawEmargementItem } from "../parsers/emargements.js";

const [, , jsonPath, xlsxPath, outDir] = process.argv;
if (!jsonPath || !xlsxPath || !outDir) {
  console.error("Usage: tsx splitEmargementsParAcademie.ts <emargements.json> <referentiel.xlsx> <dossier_sortie>");
  process.exit(1);
}

// Base temporaire dédiée : ce script ne doit jamais toucher la base réelle
// (prod/sandbox), seulement s'en servir pour réutiliser lookupDepartement().
process.env.DATABASE_PATH = path.join(os.tmpdir(), `split-emargements-${Date.now()}.sqlite`);

const { migrate } = await import("../db/index.js");
const { loadDepartementsWorkbook, lookupDepartement } = await import("../services/reference.js");
const { extractDepartement, extractDepartementFromRne } = await import("../lib/departement.js");
const { parseEmargementsJson } = await import("../parsers/emargements.js");

migrate();
const xlsxBuffer = fs.readFileSync(xlsxPath);
const { departements, spelcs } = await loadDepartementsWorkbook(xlsxBuffer);
console.log(`Référentiel chargé : ${departements} département(s), ${spelcs} Spelc(s).`);

const raw = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
const items = parseEmargementsJson(raw);
console.log(`${items.length} émargement(s) à répartir.`);

const byAcademie = new Map<string, RawEmargementItem[]>();
const unmatchedByDept = new Map<string, number>();
let unmatchedTotal = 0;

for (const item of items) {
  const departement = extractDepartementFromRne((item as RawEmargementItem & { rne?: string }).rne) ?? extractDepartement(item.affectation);
  const academie = departement ? lookupDepartement(departement)?.academie ?? null : null;
  if (!academie) {
    unmatchedTotal++;
    const key = departement ?? "(aucun code postal reconnu)";
    unmatchedByDept.set(key, (unmatchedByDept.get(key) ?? 0) + 1);
    continue;
  }
  const arr = byAcademie.get(academie) ?? [];
  arr.push(item);
  byAcademie.set(academie, arr);
}

fs.mkdirSync(outDir, { recursive: true });
const written: { academie: string; count: number; file: string }[] = [];
for (const [academie, academieItems] of [...byAcademie.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const filename = `${academie}.json`;
  const filePath = path.join(outDir, filename);
  fs.writeFileSync(filePath, JSON.stringify({ totalCount: academieItems.length, items: academieItems }, null, 2), "utf-8");
  written.push({ academie, count: academieItems.length, file: filePath });
}

console.log("\nFichiers académiques écrits :");
for (const w of written) console.log(`  ${w.academie.padEnd(20)} ${String(w.count).padStart(6)} émargement(s)  -> ${w.file}`);
console.log(`\nTotal réparti : ${items.length - unmatchedTotal} / ${items.length}`);

if (unmatchedTotal > 0) {
  console.log(`\n${unmatchedTotal} émargement(s) NON réparti(s) (département absent du référentiel) :`);
  for (const [dept, count] of [...unmatchedByDept.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  département ${dept.padEnd(28)} ${count} émargement(s)`);
  }
}

fs.rmSync(process.env.DATABASE_PATH, { force: true });
fs.rmSync(process.env.DATABASE_PATH + "-wal", { force: true });
fs.rmSync(process.env.DATABASE_PATH + "-shm", { force: true });
