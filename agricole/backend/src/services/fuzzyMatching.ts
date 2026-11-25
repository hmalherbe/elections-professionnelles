import { db } from "../db/index.js";
import { getSetting, setSetting } from "./settings.js";
import { currentImportId } from "./stats.js";
import { SCRUTINS } from "../lib/scrutins.js";
import { normalizeName } from "../lib/normalize.js";

const DEFAULT_THRESHOLD = 1;
const MAX_THRESHOLD = 3;

/** Nombre de caractères de différence toléré (nom ET prénom), réglable par
 * l'admin — voir onglet Adhérents. Plafonné pour éviter un réglage qui
 * rendrait le rapprochement approximatif non fiable. */
export function getFuzzyMatchThreshold(): number {
  const raw = getSetting("fuzzy_match_threshold");
  const n = raw ? Number(raw) : DEFAULT_THRESHOLD;
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), MAX_THRESHOLD) : DEFAULT_THRESHOLD;
}

export function setFuzzyMatchThreshold(n: number): void {
  setSetting("fuzzy_match_threshold", String(Math.max(0, Math.min(Math.floor(n), MAX_THRESHOLD))));
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

/** Un nom (ou prénom) normalisé, tiret traité comme un espace (ex.
 * "ANNE-CHARLOTTE" / "ANNE CHARLOTTE") — ne sert pas à une comparaison floue
 * mais à élargir la correspondance EXACTE elle-même : une différence d'un
 * seul tiret entre ce qui est déclaré par l'adhérent et le fichier
 * d'émargement ne laisse aucune ambiguïté sur la personne. */
function collapseHyphens(nomNorm: string): string {
  return nomNorm.replace(/-/g, " ").replace(/\s+/g, " ").trim();
}

/** Mots d'un prénom normalisé, espace et tiret traités de façon identique —
 * un mot d'une seule lettre est ignoré (trop permissif en comparaison floue,
 * ex. une initiale). */
function prenomWords(prenomNorm: string): string[] {
  return prenomNorm.split(/[\s-]+/).filter((w) => w.length >= 2);
}

/**
 * Le prénom d'un adhérent et celui d'un électeur désignent-ils la même
 * personne au sens large, au-delà de la simple distance de Levenshtein sur
 * la chaîne entière : tiret/espace sans incidence, ou prénom composé (tous
 * les mots du prénom le plus court se retrouvent, chacun à une distance
 * <= seuil, parmi les mots de l'autre).
 */
export function prenomCompatible(aPrenomNorm: string, ePrenomNorm: string, threshold: number): boolean {
  if (withinDistance(aPrenomNorm, ePrenomNorm, threshold)) return true;
  const aWords = prenomWords(aPrenomNorm);
  const eWords = prenomWords(ePrenomNorm);
  if (aWords.length === 0 || eWords.length === 0) return false;
  const [shorter, longer] = aWords.length <= eWords.length ? [aWords, eWords] : [eWords, aWords];
  return shorter.every((sw) => longer.some((lw) => withinDistance(sw, lw, threshold)));
}

/** Les clés "nom|prénom" d'une identité (variante tiret/espace confondus
 * incluse), pour construire ou interroger un set d'identités. */
export function identityKeys(nomNorm: string, prenomNorm: string): string[] {
  const noms = new Set<string>([nomNorm, collapseHyphens(nomNorm)]);
  const prenoms = new Set<string>([prenomNorm, collapseHyphens(prenomNorm)]);
  const keys: string[] = [];
  for (const nom of noms) for (const prenom of prenoms) keys.push(`${nom}|${prenom}`);
  return keys;
}

/**
 * Équivalent en mémoire d'un test de correspondance exacte, construit une
 * seule fois pour tous les adhérents (voir buildAdherentIdentitySet) plutôt
 * que par une sous-requête SQL corrélée réévaluée à chaque ligne — même
 * logique que côté application éducation nationale (services/fuzzyMatching.ts
 * là-bas), ici sans partition par Spelc puisque le suivi agricole est à
 * périmètre unique.
 */
export function buildAdherentIdentitySet(): Set<string> {
  const set = new Set<string>();
  const adherentRows = db.prepare("SELECT nom_norm, prenom_norm FROM adherents").all() as {
    nom_norm: string;
    prenom_norm: string;
  }[];
  for (const r of adherentRows) for (const k of identityKeys(r.nom_norm, r.prenom_norm)) set.add(k);

  const fuzzyRows = db
    .prepare(`SELECT candidate_nom_norm AS nomNorm, candidate_prenom_norm AS prenomNorm FROM adherent_fuzzy_matches WHERE status = 'valide'`)
    .all() as { nomNorm: string; prenomNorm: string }[];
  for (const r of fuzzyRows) for (const k of identityKeys(r.nomNorm, r.prenomNorm)) set.add(k);

  return set;
}

/** Un électeur (nom, prénom déjà normalisés) a-t-il un adhérent
 * correspondant, d'après le set construit par buildAdherentIdentitySet() ? */
export function electeurMatchesAdherent(adherentSet: Set<string>, nomNorm: string, prenomNorm: string): boolean {
  for (const k of identityKeys(nomNorm, prenomNorm)) if (adherentSet.has(k)) return true;
  return false;
}

interface AdherentForMatching {
  id: number;
  nom: string;
  prenom: string;
  nom_norm: string;
  prenom_norm: string;
}

interface EmargementIdentity {
  nom: string;
  prenom: string;
  nom_norm: string;
  prenom_norm: string;
}

/** Un adhérent a-t-il une correspondance exacte dans l'ensemble d'identités
 * des émargements ? */
function isExactlyMatched(emargIdentitySet: Set<string>, nomNorm: string, prenomNorm: string): boolean {
  return identityKeys(nomNorm, prenomNorm).some((k) => emargIdentitySet.has(k));
}

/**
 * Charge le contexte commun aux fonctions ci-dessous : les émargements
 * courants (des deux scrutins, cumulatifs par nature — voir currentImportId),
 * dédoublonnés par identité, et tous les adhérents.
 */
function loadMatchingContext(): {
  uniqueEmargs: EmargementIdentity[];
  emargIdentitySet: Set<string>;
  adherents: AdherentForMatching[];
} {
  const importIds = SCRUTINS.map((s) => currentImportId(s.code)).filter((id): id is number => id != null);
  if (importIds.length === 0) return { uniqueEmargs: [], emargIdentitySet: new Set(), adherents: [] };

  const placeholders = importIds.map(() => "?").join(",");
  const emargs = db
    .prepare(`SELECT nom, prenom, nom_norm, prenom_norm FROM emargements WHERE import_id IN (${placeholders})`)
    .all(...importIds) as EmargementIdentity[];
  const uniqueEmargs = [...new Map(emargs.map((e) => [`${e.nom_norm}|${e.prenom_norm}`, e])).values()];
  const emargIdentitySet = new Set(uniqueEmargs.flatMap((e) => identityKeys(e.nom_norm, e.prenom_norm)));

  const adherents = db.prepare("SELECT id, nom, prenom, nom_norm, prenom_norm FROM adherents").all() as AdherentForMatching[];

  return { uniqueEmargs, emargIdentitySet, adherents };
}

/** Candidats approximatifs d'un adhérent (nom ET prénom, tous deux à une
 * distance <= seuil), dédoublonnés par identité. */
function findCandidates(a: AdherentForMatching, uniqueEmargs: EmargementIdentity[], threshold: number): EmargementIdentity[] {
  const candidates: EmargementIdentity[] = [];
  for (const e of uniqueEmargs) {
    if (!withinDistance(a.nom_norm, e.nom_norm, threshold)) continue;
    if (!prenomCompatible(a.prenom_norm, e.prenom_norm, threshold)) continue;
    candidates.push(e);
  }
  return [...new Map(candidates.map((c) => [`${c.nom_norm}|${c.prenom_norm}`, c])).values()];
}

/**
 * Recherche, pour les adhérents non déjà retrouvés par correspondance
 * exacte, les candidats approximatifs parmi les émargements des scrutins
 * courants — nom ET prénom, tous les deux à une distance <= seuil courant.
 * N'enregistre une suggestion que s'il y a EXACTEMENT un candidat : par
 * sécurité, une ambiguïté ne propose personne plutôt que de risquer un
 * mauvais rapprochement. Idempotent (index unique).
 */
export function refreshFuzzyCandidates(): { created: number; unmatchedExamined: number } {
  const threshold = getFuzzyMatchThreshold();
  const { uniqueEmargs, emargIdentitySet, adherents } = loadMatchingContext();

  const insert = db.prepare(
    `INSERT OR IGNORE INTO adherent_fuzzy_matches
       (adherent_nom, adherent_prenom, adherent_nom_norm, adherent_prenom_norm,
        candidate_nom, candidate_prenom, candidate_nom_norm, candidate_prenom_norm)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let created = 0;
  let unmatchedExamined = 0;
  const tx = db.transaction(() => {
    for (const a of adherents) {
      if (isExactlyMatched(emargIdentitySet, a.nom_norm, a.prenom_norm)) continue; // déjà trouvé exactement
      unmatchedExamined++;

      const uniqueCandidates = findCandidates(a, uniqueEmargs, threshold);
      if (uniqueCandidates.length !== 1) continue;

      const cand = uniqueCandidates[0];
      const info = insert.run(a.nom, a.prenom, a.nom_norm, a.prenom_norm, cand.nom, cand.prenom, cand.nom_norm, cand.prenom_norm);
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
  /** aucun_candidat/ambigu/a_rafraichir : pas (encore) de suggestion en file
   * — en_attente/valide/rejete : déjà traité, statut de la ligne en file. */
  status: "aucun_candidat" | "ambigu" | "a_rafraichir" | "en_attente" | "valide" | "rejete";
  /** Nom(s) prénom(s) des candidats trouvés (0, 1 ou plusieurs selon le statut). */
  candidats: string[];
}

/**
 * Liste nommément tous les adhérents non retrouvés par correspondance exacte
 * (le détail derrière le compteur "adhérent(s) non retrouvé(s) examiné(s)"
 * affiché après un rafraîchissement des rapprochements) — avec leur statut.
 */
export function listUnmatchedAdherents(): UnmatchedAdherentRow[] {
  const threshold = getFuzzyMatchThreshold();
  const { uniqueEmargs, emargIdentitySet, adherents } = loadMatchingContext();

  const existingRows = db
    .prepare(
      `SELECT adherent_nom_norm AS adherentNomNorm, adherent_prenom_norm AS adherentPrenomNorm,
              status, candidate_nom AS candidateNom, candidate_prenom AS candidatePrenom
       FROM adherent_fuzzy_matches`
    )
    .all() as {
    adherentNomNorm: string;
    adherentPrenomNorm: string;
    status: "en_attente" | "valide" | "rejete";
    candidateNom: string;
    candidatePrenom: string;
  }[];
  const existingByIdentity = new Map<string, typeof existingRows>();
  for (const row of existingRows) {
    const key = `${row.adherentNomNorm}|${row.adherentPrenomNorm}`;
    const arr = existingByIdentity.get(key) ?? [];
    arr.push(row);
    existingByIdentity.set(key, arr);
  }

  const result: UnmatchedAdherentRow[] = [];
  for (const a of adherents) {
    if (isExactlyMatched(emargIdentitySet, a.nom_norm, a.prenom_norm)) continue; // déjà trouvé exactement

    const existing = existingByIdentity.get(`${a.nom_norm}|${a.prenom_norm}`) ?? [];
    if (existing.length > 0) {
      const chosen = existing.find((e) => e.status === "valide") ?? existing.find((e) => e.status === "en_attente") ?? existing[0];
      result.push({
        id: a.id,
        nom: a.nom,
        prenom: a.prenom,
        status: chosen.status,
        candidats: existing.map((e) => `${e.candidateNom} ${e.candidatePrenom}`),
      });
      continue;
    }

    const uniqueCandidates = findCandidates(a, uniqueEmargs, threshold);
    const status = uniqueCandidates.length === 0 ? "aucun_candidat" : uniqueCandidates.length === 1 ? "a_rafraichir" : "ambigu";
    result.push({
      id: a.id,
      nom: a.nom,
      prenom: a.prenom,
      status,
      candidats: uniqueCandidates.map((c) => `${c.nom} ${c.prenom}`),
    });
  }

  return result;
}

/** Liste des électeurs distincts (nom, prénom) des scrutins courants, triée
 * alphabétiquement — peuple la liste déroulante de rapprochement manuel. */
export function listCurrentElecteurs(): { nom: string; prenom: string }[] {
  const { uniqueEmargs } = loadMatchingContext();
  return uniqueEmargs
    .map((e) => ({ nom: e.nom, prenom: e.prenom }))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr") || a.prenom.localeCompare(b.prenom, "fr"));
}

/**
 * Rapprochement manuel explicite d'un adhérent avec un électeur choisi dans
 * la liste complète (pas seulement les candidats proches suggérés).
 * Contrairement aux suggestions automatiques (toujours en_attente tant que
 * non validées), un choix manuel est directement enregistré "valide".
 * Upsert (ON CONFLICT) : si une ligne existe déjà pour ce couple
 * adhérent/candidat, elle est simplement validée plutôt que dupliquée.
 */
export function manuallyMatchAdherent(adherentId: number, candidateNom: string, candidatePrenom: string, reviewedBy: number): boolean {
  const adherent = db.prepare("SELECT nom, prenom, nom_norm, prenom_norm FROM adherents WHERE id = ?").get(adherentId) as
    | { nom: string; prenom: string; nom_norm: string; prenom_norm: string }
    | undefined;
  if (!adherent) return false;

  const nomNorm = normalizeName(candidateNom);
  const prenomNorm = normalizeName(candidatePrenom);
  db.prepare(
    `INSERT INTO adherent_fuzzy_matches
       (adherent_nom, adherent_prenom, adherent_nom_norm, adherent_prenom_norm,
        candidate_nom, candidate_prenom, candidate_nom_norm, candidate_prenom_norm, status, reviewed_by, reviewed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'valide', ?, datetime('now'))
     ON CONFLICT(adherent_nom_norm, adherent_prenom_norm, candidate_nom_norm, candidate_prenom_norm)
     DO UPDATE SET status = 'valide', reviewed_by = excluded.reviewed_by, reviewed_at = datetime('now')`
  ).run(adherent.nom, adherent.prenom, adherent.nom_norm, adherent.prenom_norm, candidateNom, candidatePrenom, nomNorm, prenomNorm, reviewedBy);
  return true;
}

export interface FuzzyMatchRow {
  id: number;
  adherentNom: string;
  adherentPrenom: string;
  candidateNom: string;
  candidatePrenom: string;
  status: "en_attente" | "valide" | "rejete";
  createdAt: string;
  reviewedAt: string | null;
}

export function listFuzzyMatches(status?: "en_attente" | "valide" | "rejete"): FuzzyMatchRow[] {
  const clause = status ? "WHERE status = ?" : "";
  const params: unknown[] = status ? [status] : [];
  return db
    .prepare(
      `SELECT id, adherent_nom AS adherentNom, adherent_prenom AS adherentPrenom,
              candidate_nom AS candidateNom, candidate_prenom AS candidatePrenom,
              status, created_at AS createdAt, reviewed_at AS reviewedAt
       FROM adherent_fuzzy_matches
       ${clause}
       ORDER BY created_at DESC`
    )
    .all(...params) as FuzzyMatchRow[];
}

export function reviewFuzzyMatch(id: number, status: "valide" | "rejete", reviewedBy: number): boolean {
  const info = db
    .prepare(`UPDATE adherent_fuzzy_matches SET status = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`)
    .run(status, reviewedBy, id);
  return info.changes > 0;
}
