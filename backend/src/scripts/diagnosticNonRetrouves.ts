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
  nom_naissance_norm: string | null;
}

/** Les quatre combinaisons nom/nom de naissance (adhérent) x nom/nom de
 * naissance (électeur) sont-elles compatibles (exactes, ou toutes deux à une
 * distance <= seuil) ? Même règle que services/fuzzyMatching.ts. */
function nomsCompatibles(
  aNomNorm: string,
  aNomNaissanceNorm: string | null,
  eNomNorm: string,
  eNomNaissanceNorm: string | null,
  cmp: (a: string, b: string) => boolean
): boolean {
  return (
    cmp(aNomNorm, eNomNorm) ||
    (Boolean(eNomNaissanceNorm) && cmp(aNomNorm, eNomNaissanceNorm!)) ||
    (Boolean(aNomNaissanceNorm) && cmp(aNomNaissanceNorm!, eNomNorm)) ||
    (Boolean(aNomNaissanceNorm) && Boolean(eNomNaissanceNorm) && cmp(aNomNaissanceNorm!, eNomNaissanceNorm!))
  );
}

function identityKeys(nomNorm: string, nomNaissanceNorm: string | null, prenomNorm: string): string[] {
  const keys = [`${nomNorm}|${prenomNorm}`];
  if (nomNaissanceNorm && nomNaissanceNorm !== nomNorm) keys.push(`${nomNaissanceNorm}|${prenomNorm}`);
  return keys;
}

let totalNonRetrouves = 0;
let totalDejaEnFile = 0; // en_attente/valide/rejete existants
let totalAmbigu = 0;
let totalCompoundDetectable = 0;
let totalAucuneCorrespondance = 0;
let totalNomTrouvePrenomDifferent = 0; // le nom (ou nom_naissance) existe, mais aucun prénom compatible
let totalNomAbsent = 0; // aucun électeur, même approchant, ne porte ce nom

const detailRows: { spelc: string; nom: string; prenom: string; candidat: string }[] = [];
const nomTrouveRows: { spelc: string; nom: string; prenom: string; candidat: string }[] = [];
const nomAbsentRows: { spelc: string; nom: string; prenom: string }[] = [];
const perSpelc: {
  spelc: string;
  academie: string;
  electeursDisponibles: number;
  adherents: number;
  nonRetrouves: number;
  aucuneCorrespondance: number;
}[] = [];

for (const { spelc, academie } of spelcs) {
  const localIds = currentImportIds("academique", academie);
  const nationalIds = currentImportIds("national", null);
  const allIds = [...localIds, ...nationalIds];

  const adherents = db
    .prepare("SELECT id, nom, prenom, nom_norm, prenom_norm, nom_naissance_norm FROM adherents WHERE spelc = ?")
    .all(spelc) as { id: number; nom: string; prenom: string; nom_norm: string; prenom_norm: string; nom_naissance_norm: string | null }[];
  if (adherents.length === 0) continue;

  // Aucun import (national ni local) disponible pour cette académie : ne
  // JAMAIS sauter ce Spelc en silence — c'est précisément le cas qui
  // explique le plus souvent "aucune correspondance" (voir répartition par
  // Spelc plus bas), pas une vraie absence de la liste électorale.
  const uniqueEmargs: EmargementIdentity[] =
    allIds.length === 0
      ? []
      : (() => {
          const placeholders = allIds.map(() => "?").join(",");
          const emargs = db
            .prepare(
              `SELECT nom, prenom, nom_norm, prenom_norm, nom_naissance_norm FROM emargements WHERE spelc = ? AND import_id IN (${placeholders})`
            )
            .all(spelc, ...allIds) as EmargementIdentity[];
          return [...new Map(emargs.map((e) => [`${e.nom_norm}|${e.prenom_norm}`, e])).values()];
        })();
  const emargIdentitySet = new Set(uniqueEmargs.flatMap((e) => identityKeys(e.nom_norm, e.nom_naissance_norm, e.prenom_norm)));

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

  const spelcStats = {
    spelc,
    academie,
    electeursDisponibles: uniqueEmargs.length,
    adherents: adherents.length,
    nonRetrouves: 0,
    aucuneCorrespondance: 0,
  };
  perSpelc.push(spelcStats);

  for (const a of adherents) {
    if (identityKeys(a.nom_norm, a.nom_naissance_norm, a.prenom_norm).some((k) => emargIdentitySet.has(k))) continue; // trouvé exactement
    totalNonRetrouves++;
    spelcStats.nonRetrouves++;

    if (existingAdherentIds.has(a.id)) {
      totalDejaEnFile++;
      continue;
    }

    // Algorithme existant (Levenshtein sur les 4 combinaisons nom/nom de
    // naissance adhérent x électeur, ET prénom).
    const existingCandidates: EmargementIdentity[] = [];
    for (const e of uniqueEmargs) {
      const nomProche = nomsCompatibles(a.nom_norm, a.nom_naissance_norm, e.nom_norm, e.nom_naissance_norm, (x, y) =>
        withinDistance(x, y, threshold)
      );
      if (!nomProche) continue;
      if (!withinDistance(a.prenom_norm, e.prenom_norm, threshold)) continue;
      existingCandidates.push(e);
    }
    const uniqueExisting = [...new Map(existingCandidates.map((c) => [`${c.nom_norm}|${c.prenom_norm}`, c])).values()];
    if (uniqueExisting.length > 0) {
      totalAmbigu++; // 1 -> a_rafraichir, 2+ -> ambigu ; regroupés ici (déjà couverts par le panneau existant)
      continue;
    }

    // Règle élargie "prénom composé" : nom/nom_naissance (4 combinaisons)
    // exact OU proche, prénom contenu mot à mot dans l'autre.
    const compoundCandidates: EmargementIdentity[] = [];
    for (const e of uniqueEmargs) {
      const nomProche = nomsCompatibles(a.nom_norm, a.nom_naissance_norm, e.nom_norm, e.nom_naissance_norm, (x, y) =>
        withinDistance(x, y, threshold)
      );
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
      spelcStats.aucuneCorrespondance++;

      // Le nom (ou nom de naissance, des deux côtés) existe-t-il quelque part
      // dans la liste, même si aucun prénom compatible n'y est associé ?
      // Distingue "nom présent, prénom trop différent" (ex. nom marital
      // complet différent, ou seuil trop strict) de "absence réelle de la
      // liste".
      const nomCandidates = uniqueEmargs.filter((e) =>
        nomsCompatibles(a.nom_norm, a.nom_naissance_norm, e.nom_norm, e.nom_naissance_norm, (x, y) =>
          withinDistance(x, y, threshold)
        )
      );
      if (nomCandidates.length > 0) {
        totalNomTrouvePrenomDifferent++;
        if (onlySpelc) {
          nomTrouveRows.push({
            spelc,
            nom: a.nom,
            prenom: a.prenom,
            candidat: nomCandidates
              .slice(0, 3)
              .map((c) => `${c.nom} ${c.prenom}`)
              .join(" / "),
          });
        }
      } else {
        totalNomAbsent++;
        if (onlySpelc) nomAbsentRows.push({ spelc, nom: a.nom, prenom: a.prenom });
      }
    }
  }
}

console.log(`Seuil de fuzzy matching courant : ${threshold}\n`);
console.log(`Total adhérents non retrouvés (${onlySpelc ? onlySpelc : "tous Spelcs"}) : ${totalNonRetrouves}`);
console.log(`  dont déjà en file de validation (en_attente/validé/rejeté)     : ${totalDejaEnFile}`);
console.log(`  dont candidat(s) trouvé(s) par l'algorithme actuel (ambigu/à rafraîchir) : ${totalAmbigu}`);
console.log(`  dont prénom composé détectable (règle élargie, pas l'algorithme actuel) : ${totalCompoundDetectable}`);
console.log(`  dont aucune correspondance même avec la règle élargie          : ${totalAucuneCorrespondance}`);
console.log(`    - dont le nom (ou nom de naissance) existe mais aucun prénom compatible : ${totalNomTrouvePrenomDifferent}`);
console.log(`    - dont le nom est absent de la liste électorale, même approchant        : ${totalNomAbsent}`);

// Trié par nombre d'électeurs disponibles croissant : les Spelcs en tête
// (0 ou très peu d'électeurs chargés) expliquent probablement l'essentiel de
// leurs "aucune correspondance" — import national/local manquant ou pas
// encore à jour pour leur académie, pas une vraie absence de la liste.
const withGaps = perSpelc.filter((s) => s.aucuneCorrespondance > 0).sort((a, b) => a.electeursDisponibles - b.electeursDisponibles);
if (withGaps.length > 0) {
  console.log(`\nRépartition par Spelc (uniquement ceux ayant au moins un "aucune correspondance") :`);
  console.log(`  ${"Spelc".padEnd(28)} ${"Académie".padEnd(18)} ${"Électeurs dispo.".padStart(16)} ${"Adhérents".padStart(10)} ${"Aucune corresp.".padStart(16)}`);
  for (const s of withGaps) {
    console.log(
      `  ${s.spelc.padEnd(28)} ${s.academie.padEnd(18)} ${String(s.electeursDisponibles).padStart(16)} ${String(s.adherents).padStart(10)} ${String(s.aucuneCorrespondance).padStart(16)}`
    );
  }
}

if (onlySpelc && detailRows.length > 0) {
  console.log(`\nDétail "prénom composé détectable" pour ${onlySpelc} :`);
  for (const r of detailRows) {
    console.log(`  ${r.nom} ${r.prenom}  ->  ${r.candidat}`);
  }
}

if (onlySpelc && nomTrouveRows.length > 0) {
  console.log(`\nDétail "nom trouvé, prénom différent" pour ${onlySpelc} (jusqu'à 3 candidats par nom) :`);
  for (const r of nomTrouveRows) {
    console.log(`  ${r.nom} ${r.prenom}  ->  ${r.candidat}`);
  }
}

if (onlySpelc && nomAbsentRows.length > 0) {
  console.log(`\nDétail "nom absent de la liste électorale" pour ${onlySpelc} :`);
  for (const r of nomAbsentRows) {
    console.log(`  ${r.nom} ${r.prenom}`);
  }
}
