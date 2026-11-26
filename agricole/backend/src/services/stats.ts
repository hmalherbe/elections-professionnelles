import { db } from "../db/index.js";
import type { ScrutinCode } from "../lib/scrutins.js";
import { buildAdherentIdentitySet, electeurMatchesAdherent } from "./fuzzyMatching.js";

/**
 * Chaque fichier JSON d'émargements est cumulatif par nature (comme le
 * fichier CCMMEP de l'application éducation nationale) : un seul import,
 * le plus récent, suffit à reconstituer l'état courant d'un scrutin. On
 * départage par id (strictement croissant) plutôt que par imported_at seul,
 * deux imports faits dans la même seconde ayant sinon le même horodatage.
 */
export function currentImportId(scrutin: ScrutinCode): number | null {
  const row = db
    .prepare("SELECT id FROM imports WHERE scrutin = ? ORDER BY imported_at DESC, id DESC LIMIT 1")
    .get(scrutin) as { id: number } | undefined;
  return row?.id ?? null;
}

export function camembert(scrutin: ScrutinCode): { votants: number; nonVotants: number } {
  const importId = currentImportId(scrutin);
  if (importId == null) return { votants: 0, nonVotants: 0 };
  const row = db
    .prepare("SELECT COUNT(*) AS total, SUM(votant) AS votants FROM emargements WHERE import_id = ?")
    .get(importId) as { total: number; votants: number };
  return { votants: row.votants ?? 0, nonVotants: (row.total ?? 0) - (row.votants ?? 0) };
}

export interface CourbePoint {
  date: string;
  inscrits: number;
  votants: number;
  taux: number;
}

export function courbeCumulative(scrutin: ScrutinCode): CourbePoint[] {
  const importId = currentImportId(scrutin);
  if (importId == null) return [];

  const totalRow = db.prepare("SELECT COUNT(*) AS total FROM emargements WHERE import_id = ?").get(importId) as {
    total: number;
  };
  const inscrits = totalRow.total ?? 0;

  const dayRows = db
    .prepare(
      `SELECT substr(date_emargement, 1, 10) AS day, COUNT(*) AS count
       FROM emargements WHERE import_id = ? AND date_emargement IS NOT NULL
       GROUP BY day ORDER BY day`
    )
    .all(importId) as { day: string; count: number }[];

  let cumulativeVotants = 0;
  return dayRows.map((r) => {
    cumulativeVotants += r.count;
    return { date: r.day, inscrits, votants: cumulativeVotants, taux: inscrits ? cumulativeVotants / inscrits : 0 };
  });
}

export interface EtablissementRow {
  etablissement: string;
  inscrits: number;
  votants: number;
  taux: number;
}

export function participationParEtablissement(scrutin: ScrutinCode): EtablissementRow[] {
  const importId = currentImportId(scrutin);
  if (importId == null) return [];
  const rows = db
    .prepare(
      `SELECT COALESCE(etablissement, 'Non renseigné') AS etablissement, COUNT(*) AS inscrits, SUM(votant) AS votants
       FROM emargements WHERE import_id = ? GROUP BY etablissement ORDER BY inscrits DESC`
    )
    .all(importId) as { etablissement: string; inscrits: number; votants: number }[];
  return rows.map((r) => ({ ...r, taux: r.inscrits ? r.votants / r.inscrits : 0 }));
}

export interface ScrutinDetailFilter {
  scrutin: ScrutinCode;
  /** Ne s'applique qu'à la liste d'électeurs par établissement (rows) : un
   * taux de participation calculé sur des lignes déjà filtrées par leur
   * propre statut de vote n'aurait aucun sens (toujours 0 % ou 100 %). */
  votant?: "votant" | "non_votant" | null;
  adherent?: "oui" | "non" | null;
  etablissement?: string | null;
}

export interface ScrutinDetailElecteur {
  nom: string;
  prenom: string;
  votant: number;
  dateEmargement: string | null;
  isAdherent: number;
}

export interface ScrutinDetailGlobal {
  inscrits: number;
  votants: number;
  taux: number;
  adherentsInscrits: number;
  adherentsVotants: number;
  adherentsTaux: number;
}

export interface ScrutinDetailGroup extends ScrutinDetailGlobal {
  etablissement: string;
  rows: ScrutinDetailElecteur[];
}

export interface ScrutinDetailResult {
  global: ScrutinDetailGlobal;
  /** Établissements disponibles sous le filtre adhérent courant (hors le
   * filtre établissement lui-même, pour pouvoir toujours en choisir un
   * autre) — le filtre votant ne les restreint pas non plus : un
   * établissement n'ayant que des votants ou que des non-votants reste
   * toujours proposé. */
  etablissementOptions: string[];
  etablissements: ScrutinDetailGroup[];
  totalRows: number;
}

function summarize(rows: { votant: number; isAdherent: number }[]): ScrutinDetailGlobal {
  const inscrits = rows.length;
  const votants = rows.reduce((s, r) => s + r.votant, 0);
  const adherentRows = rows.filter((r) => r.isAdherent === 1);
  const adherentsInscrits = adherentRows.length;
  const adherentsVotants = adherentRows.reduce((s, r) => s + r.votant, 0);
  return {
    inscrits,
    votants,
    taux: inscrits ? votants / inscrits : 0,
    adherentsInscrits,
    adherentsVotants,
    adherentsTaux: adherentsInscrits ? adherentsVotants / adherentsInscrits : 0,
  };
}

/**
 * Détail du scrutin groupé par établissement (onglet "Scrutin") : taux de
 * participation global et par établissement (électeurs ET, parmi eux, les
 * seuls adhérents — voir buildAdherentIdentitySet), avec la liste nommée des
 * électeurs de chaque établissement, repliable côté frontend. Un seul aller
 * SQL, le rapprochement adhérent et tous les filtres faits en mémoire —
 * même principe que scrutinsByEtablissement côté application éducation
 * nationale.
 */
export function scrutinDetail(filter: ScrutinDetailFilter): ScrutinDetailResult {
  const importId = currentImportId(filter.scrutin);
  if (importId == null) {
    return { global: summarize([]), etablissementOptions: [], etablissements: [], totalRows: 0 };
  }

  const rawRows = db
    .prepare(
      `SELECT nom, prenom, COALESCE(etablissement, 'Non renseigné') AS etablissement, votant,
              date_emargement AS dateEmargement, nom_norm AS nomNorm, prenom_norm AS prenomNorm
       FROM emargements WHERE import_id = ?`
    )
    .all(importId) as {
    nom: string;
    prenom: string;
    etablissement: string;
    votant: number;
    dateEmargement: string | null;
    nomNorm: string;
    prenomNorm: string;
  }[];

  const adherentSet = buildAdherentIdentitySet();
  const rows = rawRows.map((r) => ({
    ...r,
    isAdherent: electeurMatchesAdherent(adherentSet, r.nomNorm, r.prenomNorm) ? 1 : 0,
  }));

  // Filtre adhérent : s'applique aux taux (global et par établissement) ET
  // à la liste d'électeurs. Filtre établissement : pareil, mais exclu de son
  // propre sélecteur d'options (voir etablissementOptions ci-dessous).
  const adherentFiltered = filter.adherent
    ? rows.filter((r) => (filter.adherent === "oui" ? r.isAdherent === 1 : r.isAdherent === 0))
    : rows;

  const etablissementOptions = [...new Set(adherentFiltered.map((r) => r.etablissement))].sort((a, b) =>
    a.localeCompare(b, "fr")
  );

  const aggRows = filter.etablissement ? adherentFiltered.filter((r) => r.etablissement === filter.etablissement) : adherentFiltered;

  const global = summarize(aggRows);

  // Le filtre votant n'intervient qu'ici, pour la liste d'électeurs affichée
  // (jamais pour les taux ci-dessus — voir ScrutinDetailFilter.votant).
  const detailRows =
    filter.votant === "votant"
      ? aggRows.filter((r) => r.votant === 1)
      : filter.votant === "non_votant"
        ? aggRows.filter((r) => r.votant === 0)
        : aggRows;

  const byEtab = new Map<string, typeof aggRows>();
  for (const r of aggRows) {
    const list = byEtab.get(r.etablissement);
    if (list) list.push(r);
    else byEtab.set(r.etablissement, [r]);
  }
  const detailByEtab = new Map<string, typeof detailRows>();
  for (const r of detailRows) {
    const list = detailByEtab.get(r.etablissement);
    if (list) list.push(r);
    else detailByEtab.set(r.etablissement, [r]);
  }

  const etablissements = [...byEtab.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "fr"))
    .map(([etablissement, etabRows]) => ({
      etablissement,
      ...summarize(etabRows),
      rows: (detailByEtab.get(etablissement) ?? [])
        .sort((a, b) => a.nom.localeCompare(b.nom, "fr") || a.prenom.localeCompare(b.prenom, "fr"))
        .map((r) => ({ nom: r.nom, prenom: r.prenom, votant: r.votant, dateEmargement: r.dateEmargement, isAdherent: r.isAdherent })),
    }));

  return { global, etablissementOptions, etablissements, totalRows: detailRows.length };
}
