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
  /** "scrutin1" (le CCM) ou "scrutin2" (la CCM) : ne liste que les électeurs
   * inscrits sur la liste électorale de CE scrutin (l'autre colonne reste
   * affichée, "Non inscrit" ou renseignée selon le cas) ; donne aussi son
   * sens à `votant` ci-dessous. */
  typeScrutin?: ScrutinCode | null;
  /** Ne s'applique qu'à la liste d'électeurs par établissement (rows),
   * jamais aux taux ni aux options d'établissement, et seulement combiné à
   * `typeScrutin` (sans lui, "votant" n'a pas de scrutin de référence et
   * est ignoré) — voir matchesDetailFilters. Absent de la liste électorale
   * de ce scrutin -> ne correspond ni à "votant" ni à "non_votant". */
  votant?: "votant" | "non_votant" | null;
  adherent?: "oui" | "non" | null;
  etablissement?: string | null;
}

/** Statut d'émargement d'un électeur pour l'un des 2 scrutins — absent
 * (null) si cette personne n'est pas sur la liste électorale de CE scrutin
 * (les 2 listes, importées séparément, ne sont pas garanties identiques). */
export interface ScrutinEmargement {
  votant: number;
  dateEmargement: string | null;
}

export interface ScrutinDetailElecteur {
  nom: string;
  prenom: string;
  scrutin1: ScrutinEmargement | null;
  scrutin2: ScrutinEmargement | null;
  isAdherent: number;
}

export interface ScrutinStats {
  inscrits: number;
  votants: number;
  taux: number;
  adherentsInscrits: number;
  adherentsVotants: number;
  adherentsTaux: number;
}

export interface ScrutinDetailGlobal {
  scrutin1: ScrutinStats;
  scrutin2: ScrutinStats;
}

export interface ScrutinDetailGroup {
  etablissement: string;
  scrutin1: ScrutinStats;
  scrutin2: ScrutinStats;
  rows: ScrutinDetailElecteur[];
}

export interface ScrutinDetailResult {
  global: ScrutinDetailGlobal;
  /** Établissements disponibles sous le filtre adhérent courant (hors le
   * filtre établissement lui-même, pour pouvoir toujours en choisir un
   * autre) — les filtres votant ne les restreignent pas non plus : un
   * établissement n'ayant que des votants ou que des non-votants reste
   * toujours proposé. */
  etablissementOptions: string[];
  etablissements: ScrutinDetailGroup[];
  totalRows: number;
}

interface MergedElecteur {
  nom: string;
  prenom: string;
  etablissement: string;
  nomNorm: string;
  prenomNorm: string;
  isAdherent: number;
  scrutin1: ScrutinEmargement | null;
  scrutin2: ScrutinEmargement | null;
}

function summarizeScrutin(rows: MergedElecteur[], key: "scrutin1" | "scrutin2"): ScrutinStats {
  const present = rows.filter((r): r is MergedElecteur & Record<typeof key, ScrutinEmargement> => r[key] != null);
  const inscrits = present.length;
  const votants = present.reduce((s, r) => s + r[key].votant, 0);
  const adherentPresent = present.filter((r) => r.isAdherent === 1);
  const adherentsInscrits = adherentPresent.length;
  const adherentsVotants = adherentPresent.reduce((s, r) => s + r[key].votant, 0);
  return {
    inscrits,
    votants,
    taux: inscrits ? votants / inscrits : 0,
    adherentsInscrits,
    adherentsVotants,
    adherentsTaux: adherentsInscrits ? adherentsVotants / adherentsInscrits : 0,
  };
}

/** Un électeur correspond-il aux filtres typeScrutin/votant ? Absent de la
 * liste électorale du scrutin désigné par typeScrutin ne correspond à
 * aucun des 2 choix ("votant" ni "non_votant") : une relance ne cible que
 * des personnes effectivement inscrites à ce scrutin-là. `votant` n'a de
 * sens que combiné à `typeScrutin` (lequel des 2 scrutins ?) : sans lui, il
 * est ignoré plutôt que de filtrer sur un scrutin arbitraire. */
function matchesDetailFilters(r: MergedElecteur, filter: ScrutinDetailFilter): boolean {
  if (filter.typeScrutin === "scrutin1" && r.scrutin1 == null) return false;
  if (filter.typeScrutin === "scrutin2" && r.scrutin2 == null) return false;
  if (filter.votant && filter.typeScrutin) {
    const emargement = filter.typeScrutin === "scrutin1" ? r.scrutin1 : r.scrutin2;
    if (filter.votant === "votant" && emargement?.votant !== 1) return false;
    if (filter.votant === "non_votant" && emargement?.votant !== 0) return false;
  }
  return true;
}

/**
 * Détail des 2 scrutins agricoles groupé par établissement (onglet
 * "Scrutin"), fusionnés par identité (nom/prénom normalisés) puisque leurs
 * listes électorales sont importées séparément : chaque électeur porte son
 * statut d'émargement pour "le CCM" (scrutin1) ET "la CCM" (scrutin2) côte à
 * côte, plus le statut adhérent (voir buildAdherentIdentitySet). Taux de
 * participation (global et par établissement) calculés séparément pour
 * chaque scrutin, sur les seules personnes présentes dans SA liste
 * électorale respective.
 */
export function scrutinDetail(filter: ScrutinDetailFilter): ScrutinDetailResult {
  function loadRows(scrutin: ScrutinCode) {
    const importId = currentImportId(scrutin);
    if (importId == null) return [];
    return db
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
  }

  const byIdentity = new Map<string, MergedElecteur>();
  function merge(scrutinRows: ReturnType<typeof loadRows>, key: "scrutin1" | "scrutin2") {
    for (const r of scrutinRows) {
      const identityKey = `${r.nomNorm}|${r.prenomNorm}`;
      const emargement: ScrutinEmargement = { votant: r.votant, dateEmargement: r.dateEmargement };
      const existing = byIdentity.get(identityKey);
      if (existing) {
        existing[key] = emargement;
      } else {
        byIdentity.set(identityKey, {
          nom: r.nom,
          prenom: r.prenom,
          etablissement: r.etablissement,
          nomNorm: r.nomNorm,
          prenomNorm: r.prenomNorm,
          isAdherent: 0,
          scrutin1: null,
          scrutin2: null,
          [key]: emargement,
        });
      }
    }
  }
  merge(loadRows("scrutin1"), "scrutin1");
  merge(loadRows("scrutin2"), "scrutin2");

  const adherentSet = buildAdherentIdentitySet();
  for (const r of byIdentity.values()) {
    r.isAdherent = electeurMatchesAdherent(adherentSet, r.nomNorm, r.prenomNorm) ? 1 : 0;
  }
  const merged = [...byIdentity.values()];

  // Filtre adhérent : s'applique aux taux (global et par établissement) ET
  // à la liste d'électeurs. Filtre établissement : pareil, mais exclu de son
  // propre sélecteur d'options (voir etablissementOptions ci-dessous).
  const adherentFiltered = filter.adherent
    ? merged.filter((r) => (filter.adherent === "oui" ? r.isAdherent === 1 : r.isAdherent === 0))
    : merged;

  const etablissementOptions = [...new Set(adherentFiltered.map((r) => r.etablissement))].sort((a, b) =>
    a.localeCompare(b, "fr")
  );

  const aggRows = filter.etablissement ? adherentFiltered.filter((r) => r.etablissement === filter.etablissement) : adherentFiltered;

  const global: ScrutinDetailGlobal = {
    scrutin1: summarizeScrutin(aggRows, "scrutin1"),
    scrutin2: summarizeScrutin(aggRows, "scrutin2"),
  };

  // Les filtres votant1/votant2/typeScrutin n'interviennent qu'ici, pour la
  // liste d'électeurs affichée (jamais pour les taux ci-dessus).
  const detailRows = aggRows.filter((r) => matchesDetailFilters(r, filter));

  const byEtab = new Map<string, MergedElecteur[]>();
  for (const r of aggRows) {
    const list = byEtab.get(r.etablissement);
    if (list) list.push(r);
    else byEtab.set(r.etablissement, [r]);
  }
  const detailByEtab = new Map<string, MergedElecteur[]>();
  for (const r of detailRows) {
    const list = detailByEtab.get(r.etablissement);
    if (list) list.push(r);
    else detailByEtab.set(r.etablissement, [r]);
  }

  const etablissements = [...byEtab.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "fr"))
    .map(([etablissement, etabRows]) => ({
      etablissement,
      scrutin1: summarizeScrutin(etabRows, "scrutin1"),
      scrutin2: summarizeScrutin(etabRows, "scrutin2"),
      rows: (detailByEtab.get(etablissement) ?? [])
        .sort((a, b) => a.nom.localeCompare(b.nom, "fr") || a.prenom.localeCompare(b.prenom, "fr"))
        .map((r) => ({ nom: r.nom, prenom: r.prenom, scrutin1: r.scrutin1, scrutin2: r.scrutin2, isAdherent: r.isAdherent })),
    }));

  return { global, etablissementOptions, etablissements, totalRows: detailRows.length };
}
