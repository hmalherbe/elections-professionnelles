/**
 * Découpe le fichier national des électeurs CCMMEP — format réel 2026
 * ({ totalCount, items[] } avec matricule/nomFamille/nomUsage/prenom/
 * nomCol/nomEtab/codePostal/statut/civilite, différent du format simulé
 * 2022 utilisé par splitEmargementsParAcademie.ts) — en deux fichiers JSON
 * par académie (1er et 2nd degré), au format RawEmargementItem directement
 * réimportable via POST /api/imports/academique (voir parsers/emargements.ts) :
 *   1. Académie déterminée via le code postal (champ dédié, déjà propre —
 *      pas besoin de le chercher dans un texte libre ici) résolu en
 *      département (departementFromPostalCode) puis en académie
 *      (référentiel Départements/Spelcs/Académies).
 *   2. Degré déterminé via classifyDegreForElecteur() : le corps (nomCol)
 *      d'abord, l'établissement (nomEtab) en repli pour les corps ambigus
 *      (ex. "maître délégué", utilisé indifféremment dans les deux degrés).
 *   3. Type de scrutin (CCMI/CCMA/CCMD/CCML1D/CCML2D...) résolu par
 *      académie et degré via le référentiel Scrutins académiques.
 * Chaque électeur produit un RawEmargementItem { nom: nomUsage, prenom,
 * nomNaissance: nomFamille (si différent de nomUsage), corps: nomCol,
 * affectation: "<nomEtab> <codePostal>", dateEmargement: null,
 * referenceBulletin: null } — pas de date d'émargement : ce fichier est la
 * liste des électeurs éligibles, pas un relevé de qui a déjà voté. Le nom
 * de naissance est conservé car 36% des électeurs du fichier national ont
 * un nomFamille différent de leur nomUsage (ex. nom marital) — nécessaire
 * au rapprochement si l'adhérent est déclaré par son Spelc sous l'autre nom
 * (voir services/fuzzyMatching.ts, qui compare les deux noms des deux côtés).
 *
 * Usage :
 *   npx tsx src/scripts/splitElecteursParAcademie.ts <electeurs.json> <referentiel_departements.xlsx> <referentiel_scrutins.xlsx> <dossier_sortie>
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const [, , jsonPath, deptXlsxPath, scrutinsXlsxPath, outDir] = process.argv;
if (!jsonPath || !deptXlsxPath || !scrutinsXlsxPath || !outDir) {
  console.error(
    "Usage: tsx splitElecteursParAcademie.ts <electeurs.json> <referentiel_departements.xlsx> <referentiel_scrutins.xlsx> <dossier_sortie>"
  );
  process.exit(1);
}

// Base temporaire dédiée : ce script ne doit jamais toucher la base réelle
// (prod/sandbox), seulement s'en servir pour réutiliser lookupDepartement()
// et getAcademieScrutins().
process.env.DATABASE_PATH = path.join(os.tmpdir(), `split-electeurs-${Date.now()}.sqlite`);

const { migrate } = await import("../db/index.js");
const { loadDepartementsWorkbook, loadAcademieScrutinsWorkbook, lookupDepartement } = await import(
  "../services/reference.js"
);
const { getAcademieScrutins } = await import("../services/imports.js");
const { departementFromPostalCode } = await import("../lib/departement.js");
const { classifyDegreForElecteur } = await import("../services/electeursAcademiques.js");

interface ElecteurItem {
  nomFamille?: string | null;
  nomUsage: string;
  prenom: string;
  nomCol: string | null;
  nomEtab: string | null;
  codePostal: string | null;
}

migrate();
const { departements, spelcs } = await loadDepartementsWorkbook(fs.readFileSync(deptXlsxPath));
console.log(`Référentiel départements chargé : ${departements} département(s), ${spelcs} Spelc(s).`);
const { count: scrutinsCount } = await loadAcademieScrutinsWorkbook(fs.readFileSync(scrutinsXlsxPath));
console.log(`Référentiel scrutins chargé : ${scrutinsCount} académie(s).`);

const raw = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
const items: ElecteurItem[] = Array.isArray(raw) ? raw : raw.items;
console.log(`${items.length} électeur(s) à répartir.`);

const byFile = new Map<string, Record<string, unknown>[]>();
const unmatchedByDept = new Map<string, number>();
const sansTypeScrutin = new Map<string, number>();
let unmatchedTotal = 0;
let avecNomNaissance = 0;

for (const item of items) {
  const departement = item.codePostal ? departementFromPostalCode(item.codePostal) : null;
  const academie = departement ? lookupDepartement(departement)?.academie ?? null : null;
  if (!academie) {
    unmatchedTotal++;
    const key = departement ?? "(code postal absent)";
    unmatchedByDept.set(key, (unmatchedByDept.get(key) ?? 0) + 1);
    continue;
  }

  const degre = classifyDegreForElecteur(item.nomCol, item.nomEtab);
  const scrutins = getAcademieScrutins(academie);
  const scrutinType = degre === "1D" ? scrutins.type1d : scrutins.type2d;
  if (!scrutinType) {
    sansTypeScrutin.set(academie, (sansTypeScrutin.get(academie) ?? 0) + 1);
    continue;
  }

  const fileKey = `${academie}-${scrutinType}`;
  const arr = byFile.get(fileKey) ?? [];
  const nomNaissance = item.nomFamille && item.nomFamille !== item.nomUsage ? item.nomFamille : null;
  if (nomNaissance) avecNomNaissance++;
  arr.push({
    nom: item.nomUsage,
    prenom: item.prenom,
    nomNaissance,
    dateEmargement: null,
    corps: item.nomCol ?? null,
    affectation: item.nomEtab && item.codePostal ? `${item.nomEtab} ${item.codePostal}` : null,
    referenceBulletin: null,
  });
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
for (const w of written) console.log(`  ${w.fileKey.padEnd(22)} ${String(w.count).padStart(6)} électeur(s)  -> ${w.file}`);
const totalWritten = written.reduce((s, w) => s + w.count, 0);
console.log(`\nTotal réparti : ${totalWritten} / ${items.length}`);
console.log(`  dont avec un nom de naissance distinct du nom d'usage : ${avecNomNaissance}`);

if (unmatchedTotal > 0) {
  console.log(`\n${unmatchedTotal} électeur(s) NON réparti(s) (département absent du référentiel ou code postal manquant) :`);
  for (const [dept, count] of [...unmatchedByDept.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  département ${dept.padEnd(28)} ${count} électeur(s)`);
  }
}

if (sansTypeScrutin.size > 0) {
  console.log(`\nÉlecteurs exclus faute de type de scrutin défini pour l'académie (référentiel scrutins incomplet) :`);
  for (const [academie, count] of [...sansTypeScrutin.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${academie.padEnd(28)} ${count} électeur(s)`);
  }
}

fs.rmSync(process.env.DATABASE_PATH, { force: true });
fs.rmSync(process.env.DATABASE_PATH + "-wal", { force: true });
fs.rmSync(process.env.DATABASE_PATH + "-shm", { force: true });
