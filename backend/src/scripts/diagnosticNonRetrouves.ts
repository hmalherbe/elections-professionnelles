/**
 * Diagnostic en lecture seule (aucune écriture en base, aucune suggestion
 * créée) : pour chaque Spelc, détaille pourquoi ses adhérents "non
 * retrouvés" (voir panneau "Détail des adhérents non retrouvés") ne le
 * sont pas, en distinguant deux causes possibles pour ceux actuellement
 * classés "aucun candidat" par l'algorithme existant (distance de
 * Levenshtein sur nom/nom de naissance ET prénom, voir
 * services/fuzzyMatching.ts) :
 *
 *   - "prenom_compose_detectable" : un adhérent dont le nom (ou nom de
 *     naissance) est exact ou proche ET dont le prénom est entièrement
 *     contenu, mot par mot, dans un prénom composé de l'électeur (ou
 *     inversement) — ex. adhérent "Mirinah" / électeur "Mamy Mirinah".
 *     La distance de Levenshtein ne le détecte pas (trop de caractères
 *     d'écart), mais ce n'est pas un faux négatif aléatoire : c'est un
 *     prénom manquant/tronqué, un autre type d'écart.
 *   - "aucune_correspondance" : aucun électeur, même sous cette règle
 *     élargie, ne porte un nom (ou nom de naissance) et un prénom
 *     compatibles — la personne n'est simplement pas sur la liste des
 *     électeurs sous aucune variante de nom retrouvable.
 *
 * Usage (dans le conteneur backend) :
 *   npx tsx src/scripts/diagnosticNonRetrouves.ts [spelc]
 * Sans argument : tous les Spelcs. Avec un nom de Spelc : détail nominatif
 * pour ce seul Spelc (sinon seulement les totaux, pour rester lisible).
 */
import { db, migrate } from "../db/index.js";
import { currentImportIds } from "../services/stats.js";
import { getFuzzyMatchThreshold } from "../services/fuzzyMatching.js";

migrate();

const onlySpelc = process.argv[2] || null;

function withinDistance(a: string, b: string, threshold: number): boolean {
  if (Math.abs(a.length - b.length) > threshold) return false;
  const m = a.length;
  const n = b.length;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n] <= threshold;
}

function words(s: string): string[] {
  return s.split(/[\s-]+/).filter(Boolean);
}

/** Un prénom est "composé détectable" par rapport à l'autre si l'un des deux
 * (le plus court en nombre de mots) est entièrement contenu, mot par mot,
 * dans l'autre — ex. ["MIRINAH"] ⊆ ["MAMY","MIRINAH"]. Ignore le cas à
 * nombre de mots égal (laissé à la distance de Levenshtein habituelle). */
function isCompoundPrenomMatch(a: string, b: string): boolean {
  const wa = words(a);
  const wb = words(b);
  if (wa.length === wb.length || wa.length === 0 || wb.length === 0) return false;
  const [shorter, longer] = wa.length < wb.length ? [wa, wb] : [wb, wa];
  return shorter.every((w) => longer.includes(w));
}

const threshold = getFuzzyMatchThreshold();

const spelcs = db
  .prepare(
    `SELECT spelc, academie FROM ref_spelc WHERE academie IS NOT NULL ${onlySpelc ? "AND spelc = ?" : ""} ORDER BY spelc`
  )
  .all(...(onlySpelc ? [onlySpelc] : [])) as { spelc: string; academie: string }[];

if (onlySpelc && spelcs.length === 0) {
  console.error(`Spelc "${onlySpelc}" introuvable (ou sans académie associée).`);
  process.exit(1);
}

interface EmargementIdentity {
  nom: string;
  prenom: string;
  nom_norm: string;
  prenom_norm: string;
}

let totalNonRetrouves = 0;
let totalDejaEnFile = 0; // en_attente/valide/rejete existants
let totalAmbigu = 0;
let totalCompoundDetectable = 0;
let totalAucuneCorrespondance = 0;

const detailRows: { spelc: string; nom: string; prenom: string; candidat: string }[] = [];

for (const { spelc, academie } of spelcs) {
  const localIds = currentImportIds("academique", academie);
  const nationalIds = currentImportIds("national", null);
  const allIds = [...localIds, ...nationalIds];
  if (allIds.length === 0) continue;

  const placeholders = allIds.map(() => "?").join(",");
  const emargs = db
    .prepare(`SELECT nom, prenom, nom_norm, prenom_norm FROM emargements WHERE spelc = ? AND import_id IN (${placeholders})`)
    .all(spelc, ...allIds) as EmargementIdentity[];
  const uniqueEmargs = [...new Map(emargs.map((e) => [`${e.nom_norm}|${e.prenom_norm}`, e])).values()];
  const emargIdentitySet = new Set(uniqueEmargs.map((e) => `${e.nom_norm}|${e.prenom_norm}`));

  const adherents = db
    .prepare("SELECT id, nom, prenom, nom_norm, prenom_norm, nom_naissance_norm FROM adherents WHERE spelc = ?")
    .all(spelc) as { id: number; nom: string; prenom: string; nom_norm: string; prenom_norm: string; nom_naissance_norm: string | null }[];

  const existingAdherentIds = new Set(
    (
      db
        .prepare(
          `SELECT DISTINCT fm.adherent_id AS id FROM adherent_fuzzy_matches fm
           INNER JOIN adherents a ON a.id = fm.adherent_id WHERE a.spelc = ?`
        )
        .all(spelc) as { id: number }[]
    ).map((r) => r.id)
  );

  for (const a of adherents) {
    if (emargIdentitySet.has(`${a.nom_norm}|${a.prenom_norm}`)) continue; // trouvé exactement
    totalNonRetrouves++;

    if (existingAdherentIds.has(a.id)) {
      totalDejaEnFile++;
      continue;
    }

    // Algorithme existant (Levenshtein nom/nom_naissance ET prénom).
    const existingCandidates: EmargementIdentity[] = [];
    for (const e of uniqueEmargs) {
      const nomProche =
        withinDistance(a.nom_norm, e.nom_norm, threshold) ||
        (Boolean(a.nom_naissance_norm) && withinDistance(a.nom_naissance_norm!, e.nom_norm, threshold));
      if (!nomProche) continue;
      if (!withinDistance(a.prenom_norm, e.prenom_norm, threshold)) continue;
      existingCandidates.push(e);
    }
    const uniqueExisting = [...new Map(existingCandidates.map((c) => [`${c.nom_norm}|${c.prenom_norm}`, c])).values()];
    if (uniqueExisting.length > 0) {
      totalAmbigu++; // 1 -> a_rafraichir, 2+ -> ambigu ; regroupés ici (déjà couverts par le panneau existant)
      continue;
    }

    // Règle élargie "prénom composé" : nom/nom_naissance exact OU proche, prénom
    // contenu mot à mot dans l'autre.
    const compoundCandidates: EmargementIdentity[] = [];
    for (const e of uniqueEmargs) {
      const nomProche =
        withinDistance(a.nom_norm, e.nom_norm, threshold) ||
        (Boolean(a.nom_naissance_norm) && withinDistance(a.nom_naissance_norm!, e.nom_norm, threshold));
      if (!nomProche) continue;
      if (!isCompoundPrenomMatch(a.prenom_norm, e.prenom_norm)) continue;
      compoundCandidates.push(e);
    }
    const uniqueCompound = [...new Map(compoundCandidates.map((c) => [`${c.nom_norm}|${c.prenom_norm}`, c])).values()];

    if (uniqueCompound.length >= 1) {
      totalCompoundDetectable++;
      if (onlySpelc) {
        detailRows.push({
          spelc,
          nom: a.nom,
          prenom: a.prenom,
          candidat: uniqueCompound.map((c) => `${c.nom} ${c.prenom}`).join(" / "),
        });
      }
    } else {
      totalAucuneCorrespondance++;
    }
  }
}

console.log(`Seuil de fuzzy matching courant : ${threshold}\n`);
console.log(`Total adhérents non retrouvés (tous Spelcs${onlySpelc ? ` — ${onlySpelc}` : ""}) : ${totalNonRetrouves}`);
console.log(`  dont déjà en file de validation (en_attente/validé/rejeté)     : ${totalDejaEnFile}`);
console.log(`  dont candidat(s) trouvé(s) par l'algorithme actuel (ambigu/à rafraîchir) : ${totalAmbigu}`);
console.log(`  dont prénom composé détectable (règle élargie, pas l'algorithme actuel) : ${totalCompoundDetectable}`);
console.log(`  dont aucune correspondance même avec la règle élargie          : ${totalAucuneCorrespondance}`);

if (onlySpelc && detailRows.length > 0) {
  console.log(`\nDétail "prénom composé détectable" pour ${onlySpelc} :`);
  for (const r of detailRows) {
    console.log(`  ${r.nom} ${r.prenom}  ->  ${r.candidat}`);
  }
}
