import { db } from "../db/index.js";
import { getSetting, setSetting } from "./settings.js";
import { currentImportIds } from "./stats.js";
import { normalizeName } from "../lib/normalize.js";

const DEFAULT_THRESHOLD = 1;
const MAX_THRESHOLD = 3;

/** Nombre de caractères de différence toléré (nom ET prénom), réglable par
 * l'admin général — voir onglet Paramètres. Plafonné pour éviter un réglage
 * qui rendrait le rapprochement approximatif non fiable. */
export function getFuzzyMatchThreshold(): number {
  const raw = getSetting("fuzzy_match_threshold");
  const n = raw ? Number(raw) : DEFAULT_THRESHOLD;
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), MAX_THRESHOLD) : DEFAULT_THRESHOLD;
}

export function setFuzzyMatchThreshold(n: number): void {
  setSetting("fuzzy_match_threshold", String(Math.max(0, Math.min(Math.floor(n), MAX_THRESHOLD))));
}

function spelcAcademie(spelc: string): string | null {
  const row = db.prepare("SELECT academie FROM ref_spelc WHERE spelc = ?").get(spelc) as
    | { academie: string }
    | undefined;
  return row?.academie ?? null;
}

/** Distance de Levenshtein, avec sortie anticipée si la différence de
 * longueur dépasse déjà le seuil (évite le calcul complet sur des chaînes
 * trop différentes pour avoir une chance d'être proches). */
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

/** Mots d'un prénom normalisé, espace et tiret traités de façon identique
 * (ex. "Thi-Hoang-Liên" et "Thi Hoang Lien" donnent les mêmes mots) — un
 * mot d'une seule lettre est ignoré (trop permissif en comparaison floue,
 * ex. une initiale). */
function prenomWords(prenomNorm: string): string[] {
  return prenomNorm.split(/[\s-]+/).filter((w) => w.length >= 2);
}

/**
 * Le prénom d'un adhérent et celui d'un électeur désignent-ils la même
 * personne au sens large, au-delà de la simple distance de Levenshtein sur
 * la chaîne entière :
 *   - tiret/espace sans incidence (ex. adhérent "Thi-Hoang-Liên" / électeur
 *     "Thi Hoang Lien" — même mots, juste séparés différemment) ;
 *   - prénom composé : tous les mots du prénom le plus court (en nombre de
 *     mots) se retrouvent, chacun à une distance <= seuil, parmi les mots
 *     de l'autre — ex. adhérent "Mirinah" / électeur "Mamy Mirinah", ou
 *     adhérent "Audrey-Francine" / électeur "Audrey" (le fichier CCMMEP
 *     porte parfois le prénom légal complet, le Spelc le seul prénom
 *     d'usage, et inversement selon la source).
 * Une personne différente partageant un nom proche ET un mot de prénom isolé
 * (ex. "Marie" très courant) reste filtrée par la règle existante : une
 * suggestion n'est créée que si un seul candidat unique est trouvé au total
 * (voir refreshFuzzyCandidates) — une coïncidence ambiguë ne propose rien.
 */
export function prenomCompatible(aPrenomNorm: string, ePrenomNorm: string, threshold: number): boolean {
  if (withinDistance(aPrenomNorm, ePrenomNorm, threshold)) return true;
  const aWords = prenomWords(aPrenomNorm);
  const eWords = prenomWords(ePrenomNorm);
  if (aWords.length === 0 || eWords.length === 0) return false;
  const [shorter, longer] = aWords.length <= eWords.length ? [aWords, eWords] : [eWords, aWords];
  return shorter.every((sw) => longer.some((lw) => withinDistance(sw, lw, threshold)));
}

/**
 * Fragment SQL : les noms de l'alias adhérent "ad" (nom ET, si renseigné,
 * nom de naissance) et de l'alias émargement "e" (nom ET, si renseigné, nom
 * de naissance) se recoupent-ils sur au moins une des quatre combinaisons ?
 * Symétrique : un nom d'usage différent du nom de naissance existe des deux
 * côtés (adhérent déclaré par son Spelc, électeur du fichier CCMMEP), et
 * l'un ou l'autre peut porter la correspondance.
 */
function nomMatchClause(adAlias: string, eAlias: string): string {
  return `(
    ${adAlias}.nom_norm = ${eAlias}.nom_norm
    OR (${eAlias}.nom_naissance_norm IS NOT NULL AND ${adAlias}.nom_norm = ${eAlias}.nom_naissance_norm)
    OR (${adAlias}.nom_naissance_norm IS NOT NULL AND ${adAlias}.nom_naissance_norm = ${eAlias}.nom_norm)
    OR (${adAlias}.nom_naissance_norm IS NOT NULL AND ${eAlias}.nom_naissance_norm IS NOT NULL
        AND ${adAlias}.nom_naissance_norm = ${eAlias}.nom_naissance_norm)
  )`;
}

/**
 * Fragment SQL réutilisable : un électeur (alias "e") a-t-il un adhérent
 * correspondant, exact OU approximatif validé ? Entouré de parenthèses pour
 * rester correct une fois combiné avec NOT par l'appelant.
 */
export function adherentExistsClause(): string {
  return `(
    EXISTS (
      SELECT 1 FROM adherents ad
      WHERE ad.spelc = e.spelc AND ${nomMatchClause("ad", "e")} AND ad.prenom_norm = e.prenom_norm
    )
    OR EXISTS (
      SELECT 1 FROM adherent_fuzzy_matches fm
      INNER JOIN adherents ad2 ON ad2.id = fm.adherent_id
      WHERE fm.status = 'valide' AND ad2.spelc = e.spelc
        AND fm.candidate_nom_norm = e.nom_norm AND fm.candidate_prenom_norm = e.prenom_norm
    )
  )`;
}

/**
 * Condition supplémentaire (à ajouter avec OR) à l'intérieur d'un LEFT JOIN
 * emargements AS <emargAlias> déjà joint sur l'adhérent aliasé "a" — étend
 * le rapprochement exact à tout rapprochement approximatif validé pour cet
 * adhérent précis.
 */
export function fuzzyValidatedJoinExtra(emargAlias: string): string {
  return `OR EXISTS (
    SELECT 1 FROM adherent_fuzzy_matches fm
    WHERE fm.adherent_id = a.id AND fm.status = 'valide'
      AND fm.candidate_nom_norm = ${emargAlias}.nom_norm AND fm.candidate_prenom_norm = ${emargAlias}.prenom_norm
  )`;
}

interface AdherentForMatching {
  id: number;
  nom_norm: string;
  prenom_norm: string;
  nom_naissance_norm: string | null;
}

interface EmargementIdentity {
  nom: string;
  prenom: string;
  nom_norm: string;
  prenom_norm: string;
  nom_naissance_norm: string | null;
}

/** Les deux (ou une seule, si pas de nom de naissance) clés "nom|prénom"
 * d'une identité, pour construire ou interroger un set d'identités en
 * tenant compte du nom de naissance de part et d'autre. */
function identityKeys(nomNorm: string, nomNaissanceNorm: string | null, prenomNorm: string): string[] {
  const keys = [`${nomNorm}|${prenomNorm}`];
  if (nomNaissanceNorm && nomNaissanceNorm !== nomNorm) keys.push(`${nomNaissanceNorm}|${prenomNorm}`);
  return keys;
}

/** Un adhérent (nom ET, si renseigné, nom de naissance) a-t-il une
 * correspondance exacte dans l'ensemble d'identités des émargements
 * (lui-même construit avec le nom de naissance des électeurs, voir
 * loadMatchingContext) ? */
function isExactlyMatched(
  emargIdentitySet: Set<string>,
  nomNorm: string,
  nomNaissanceNorm: string | null,
  prenomNorm: string
): boolean {
  return identityKeys(nomNorm, nomNaissanceNorm, prenomNorm).some((k) => emargIdentitySet.has(k));
}

/**
 * Charge le contexte commun aux fonctions ci-dessous : les émargements
 * courants (national + local de l'académie du Spelc), dédoublonnés par
 * identité, et les adhérents du Spelc — rien de spécifique au calcul des
 * candidats approximatifs lui-même.
 */
function loadMatchingContext(spelc: string): {
  uniqueEmargs: EmargementIdentity[];
  emargIdentitySet: Set<string>;
  adherents: (AdherentForMatching & { nom: string; prenom: string; nom_naissance: string | null })[];
} {
  const academie = spelcAcademie(spelc);
  if (!academie) return { uniqueEmargs: [], emargIdentitySet: new Set(), adherents: [] };

  const localIds = currentImportIds("academique", academie);
  const nationalIds = currentImportIds("national", null);
  const allIds = [...localIds, ...nationalIds];
  if (allIds.length === 0) return { uniqueEmargs: [], emargIdentitySet: new Set(), adherents: [] };

  const placeholders = allIds.map(() => "?").join(",");
  const emargs = db
    .prepare(
      `SELECT nom, prenom, nom_norm, prenom_norm, nom_naissance_norm FROM emargements WHERE spelc = ? AND import_id IN (${placeholders})`
    )
    .all(spelc, ...allIds) as EmargementIdentity[];
  const uniqueEmargs = [...new Map(emargs.map((e) => [`${e.nom_norm}|${e.prenom_norm}`, e])).values()];
  const emargIdentitySet = new Set(uniqueEmargs.flatMap((e) => identityKeys(e.nom_norm, e.nom_naissance_norm, e.prenom_norm)));

  const adherents = db
    .prepare("SELECT id, nom, prenom, nom_naissance, nom_norm, prenom_norm, nom_naissance_norm FROM adherents WHERE spelc = ?")
    .all(spelc) as (AdherentForMatching & { nom: string; prenom: string; nom_naissance: string | null })[];

  return { uniqueEmargs, emargIdentitySet, adherents };
}

/** Candidats approximatifs d'un adhérent (nom OU nom de naissance de
 * l'adhérent, comparé au nom OU nom de naissance de l'électeur — les quatre
 * combinaisons — ET prénom, tous deux à une distance <= seuil), dédoublonnés
 * par identité — une même personne peut apparaître dans le scrutin national
 * ET le scrutin local. */
function findCandidates(
  a: AdherentForMatching,
  uniqueEmargs: EmargementIdentity[],
  threshold: number
): EmargementIdentity[] {
  const candidates: EmargementIdentity[] = [];
  for (const e of uniqueEmargs) {
    const nomProche =
      withinDistance(a.nom_norm, e.nom_norm, threshold) ||
      (Boolean(e.nom_naissance_norm) && withinDistance(a.nom_norm, e.nom_naissance_norm!, threshold)) ||
      (Boolean(a.nom_naissance_norm) && withinDistance(a.nom_naissance_norm!, e.nom_norm, threshold)) ||
      (Boolean(a.nom_naissance_norm) &&
        Boolean(e.nom_naissance_norm) &&
        withinDistance(a.nom_naissance_norm!, e.nom_naissance_norm!, threshold));
    if (!nomProche) continue;
    if (!prenomCompatible(a.prenom_norm, e.prenom_norm, threshold)) continue;
    candidates.push(e);
  }
  return [...new Map(candidates.map((c) => [`${c.nom_norm}|${c.prenom_norm}`, c])).values()];
}

/**
 * Recherche, pour les adhérents de ce Spelc non déjà retrouvés par
 * correspondance exacte, les candidats approximatifs parmi les émargements
 * des scrutins courants (national + local) — nom OU nom de naissance, ET
 * prénom, tous les deux à une distance <= seuil courant. N'enregistre une
 * suggestion que s'il y a EXACTEMENT un candidat : par sécurité, une
 * ambiguïté (plusieurs identités différentes également proches) ne propose
 * personne plutôt que de risquer un mauvais rapprochement (voir
 * ADR implicite validé avec le client). Idempotent : une suggestion déjà
 * proposée, quel que soit son statut, n'est jamais recréée (index unique).
 */
export function refreshFuzzyCandidates(spelc: string): { created: number; unmatchedExamined: number } {
  const threshold = getFuzzyMatchThreshold();
  const { uniqueEmargs, emargIdentitySet, adherents } = loadMatchingContext(spelc);

  const insert = db.prepare(
    `INSERT OR IGNORE INTO adherent_fuzzy_matches
       (adherent_id, candidate_nom, candidate_prenom, candidate_nom_norm, candidate_prenom_norm)
     VALUES (?, ?, ?, ?, ?)`
  );

  let created = 0;
  let unmatchedExamined = 0;
  const tx = db.transaction(() => {
    for (const a of adherents) {
      if (isExactlyMatched(emargIdentitySet, a.nom_norm, a.nom_naissance_norm, a.prenom_norm)) continue; // déjà trouvé exactement
      unmatchedExamined++;

      const uniqueCandidates = findCandidates(a, uniqueEmargs, threshold);
      if (uniqueCandidates.length !== 1) continue;

      const cand = uniqueCandidates[0];
      const info = insert.run(a.id, cand.nom, cand.prenom, cand.nom_norm, cand.prenom_norm);
      if (info.changes > 0) created++;
    }
  });
  tx();
  return { created, unmatchedExamined };
}

export interface UnmatchedAdherentRow {
  id: number;
  nom: string;
  prenom: string;
  nomNaissance: string | null;
  /** aucun_candidat/ambigu/a_rafraichir : pas (encore) de suggestion en file
   * — en_attente/valide/rejete : déjà traité, statut de la ligne en file. */
  status: "aucun_candidat" | "ambigu" | "a_rafraichir" | "en_attente" | "valide" | "rejete";
  /** Nom(s) prénom(s) des candidats trouvés (0, 1 ou plusieurs selon le statut). */
  candidats: string[];
}

/**
 * Liste nommément, pour ce Spelc, tous les adhérents non retrouvés par
 * correspondance exacte (le détail derrière le compteur "adhérent(s) non
 * retrouvé(s) examiné(s)" affiché après un rafraîchissement des
 * rapprochements) — avec leur statut : déjà en file de validation (quel
 * que soit son état), ambigu (plusieurs candidats, jamais proposé), ou sans
 * aucun candidat proche.
 */
export function listUnmatchedAdherents(spelc: string): UnmatchedAdherentRow[] {
  const threshold = getFuzzyMatchThreshold();
  const { uniqueEmargs, emargIdentitySet, adherents } = loadMatchingContext(spelc);

  const existingRows = db
    .prepare(
      `SELECT fm.adherent_id AS adherentId, fm.status, fm.candidate_nom AS candidateNom, fm.candidate_prenom AS candidatePrenom
       FROM adherent_fuzzy_matches fm
       INNER JOIN adherents a ON a.id = fm.adherent_id
       WHERE a.spelc = ?`
    )
    .all(spelc) as { adherentId: number; status: "en_attente" | "valide" | "rejete"; candidateNom: string; candidatePrenom: string }[];
  const existingByAdherent = new Map<number, typeof existingRows>();
  for (const row of existingRows) {
    const arr = existingByAdherent.get(row.adherentId) ?? [];
    arr.push(row);
    existingByAdherent.set(row.adherentId, arr);
  }

  const result: UnmatchedAdherentRow[] = [];
  for (const a of adherents) {
    if (isExactlyMatched(emargIdentitySet, a.nom_norm, a.nom_naissance_norm, a.prenom_norm)) continue; // déjà trouvé exactement

    const existing = existingByAdherent.get(a.id) ?? [];
    if (existing.length > 0) {
      // Priorité au statut le plus avancé si plusieurs lignes existent.
      const chosen = existing.find((e) => e.status === "valide") ?? existing.find((e) => e.status === "en_attente") ?? existing[0];
      result.push({
        id: a.id,
        nom: a.nom,
        prenom: a.prenom,
        nomNaissance: a.nom_naissance,
        status: chosen.status,
        candidats: existing.map((e) => `${e.candidateNom} ${e.candidatePrenom}`),
      });
      continue;
    }

    const uniqueCandidates = findCandidates(a, uniqueEmargs, threshold);
    const status =
      uniqueCandidates.length === 0 ? "aucun_candidat" : uniqueCandidates.length === 1 ? "a_rafraichir" : "ambigu";
    result.push({
      id: a.id,
      nom: a.nom,
      prenom: a.prenom,
      nomNaissance: a.nom_naissance,
      status,
      candidats: uniqueCandidates.map((c) => `${c.nom} ${c.prenom}`),
    });
  }

  return result;
}

/**
 * Liste des électeurs distincts (nom, prénom) des scrutins courants
 * (national + local) de ce Spelc, triée alphabétiquement — sert à peupler
 * la liste déroulante de rapprochement manuel (UnmatchedAdherentsPanel),
 * pour associer un adhérent non retrouvé à n'importe quel électeur et pas
 * seulement aux candidats proches détectés automatiquement.
 */
export function listCurrentElecteurs(spelc: string): { nom: string; prenom: string }[] {
  const { uniqueEmargs } = loadMatchingContext(spelc);
  return uniqueEmargs
    .map((e) => ({ nom: e.nom, prenom: e.prenom }))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr") || a.prenom.localeCompare(b.prenom, "fr"));
}

/** Spelc d'un adhérent, pour vérifier les droits d'accès avant un rapprochement manuel. */
export function adherentSpelc(adherentId: number): string | null {
  const row = db.prepare("SELECT spelc FROM adherents WHERE id = ?").get(adherentId) as { spelc: string } | undefined;
  return row?.spelc ?? null;
}

/**
 * Rapprochement manuel explicite d'un adhérent avec un électeur choisi dans
 * la liste complète (pas seulement les candidats proches suggérés) — admin
 * Spelc ou admin général, depuis UnmatchedAdherentsPanel. Contrairement aux
 * suggestions automatiques (toujours en_attente tant que non validées), un
 * choix manuel est directement enregistré "valide" : c'est l'admin
 * lui-même qui vient de faire l'identification, pas un rapprochement
 * approximatif à vérifier. Upsert (ON CONFLICT) : si une ligne existe déjà
 * pour ce couple adhérent/candidat (ex. rejetée puis reconsidérée), elle
 * est simplement validée plutôt que dupliquée.
 */
export function manuallyMatchAdherent(
  adherentId: number,
  candidateNom: string,
  candidatePrenom: string,
  reviewedBy: number
): void {
  const nomNorm = normalizeName(candidateNom);
  const prenomNorm = normalizeName(candidatePrenom);
  db.prepare(
    `INSERT INTO adherent_fuzzy_matches
       (adherent_id, candidate_nom, candidate_prenom, candidate_nom_norm, candidate_prenom_norm, status, reviewed_by, reviewed_at)
     VALUES (?, ?, ?, ?, ?, 'valide', ?, datetime('now'))
     ON CONFLICT(adherent_id, candidate_nom_norm, candidate_prenom_norm)
     DO UPDATE SET status = 'valide', reviewed_by = excluded.reviewed_by, reviewed_at = datetime('now')`
  ).run(adherentId, candidateNom, candidatePrenom, nomNorm, prenomNorm, reviewedBy);
}

export interface FuzzyMatchRow {
  id: number;
  adherentId: number;
  adherentNom: string;
  adherentPrenom: string;
  adherentNomNaissance: string | null;
  candidateNom: string;
  candidatePrenom: string;
  status: "en_attente" | "valide" | "rejete";
  createdAt: string;
  reviewedAt: string | null;
}

export function listFuzzyMatches(spelc: string, status?: "en_attente" | "valide" | "rejete"): FuzzyMatchRow[] {
  const clause = status ? "AND fm.status = ?" : "";
  const params: unknown[] = status ? [spelc, status] : [spelc];
  return db
    .prepare(
      `SELECT fm.id, fm.adherent_id AS adherentId, a.nom AS adherentNom, a.prenom AS adherentPrenom,
              a.nom_naissance AS adherentNomNaissance, fm.candidate_nom AS candidateNom,
              fm.candidate_prenom AS candidatePrenom, fm.status, fm.created_at AS createdAt,
              fm.reviewed_at AS reviewedAt
       FROM adherent_fuzzy_matches fm
       INNER JOIN adherents a ON a.id = fm.adherent_id
       WHERE a.spelc = ? ${clause}
       ORDER BY fm.created_at DESC`
    )
    .all(...params) as FuzzyMatchRow[];
}

/** Spelc propriétaire d'une suggestion, pour vérifier les droits d'accès avant de la modifier. */
export function fuzzyMatchSpelc(id: number): string | null {
  const row = db
    .prepare(
      `SELECT a.spelc FROM adherent_fuzzy_matches fm INNER JOIN adherents a ON a.id = fm.adherent_id WHERE fm.id = ?`
    )
    .get(id) as { spelc: string } | undefined;
  return row?.spelc ?? null;
}

export function reviewFuzzyMatch(id: number, status: "valide" | "rejete", reviewedBy: number): boolean {
  const info = db
    .prepare(`UPDATE adherent_fuzzy_matches SET status = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`)
    .run(status, reviewedBy, id);
  return info.changes > 0;
}
