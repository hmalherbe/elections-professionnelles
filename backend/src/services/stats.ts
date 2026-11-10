import { db } from "../db/index.js";
import {
  adherentContactSelectFragment,
  adherentExistsClause,
  buildAdherentIdentitySets,
  electeurMatchesAdherent,
} from "./fuzzyMatching.js";

export type Scope = "national" | "academique";

/**
 * Retourne les ids des imports "actuels" (les plus récents) pour un scope
 * donné. On départage par id (auto-incrémenté, donc strictement croissant)
 * plutôt que par imported_at seul : deux imports faits dans la même
 * seconde auraient sinon le même horodatage (résolution SQLite à la
 * seconde) et seraient tous deux considérés "les plus récents", ce qui
 * doublerait les émargements comptés.
 */
export function currentImportIds(scope: Scope, academie: string | null): number[] {
  if (scope === "national") {
    const row = db
      .prepare("SELECT id FROM imports WHERE scope = 'national' ORDER BY imported_at DESC, id DESC LIMIT 1")
      .get() as { id: number } | undefined;
    return row ? [row.id] : [];
  }
  if (!academie) return [];
  const rows = db
    .prepare(
      `SELECT i.id FROM imports i
       INNER JOIN (
         SELECT degre, MAX(id) AS max_id FROM imports
         WHERE scope = 'academique' AND academie = ? GROUP BY degre
       ) latest ON latest.degre = i.degre AND latest.max_id = i.id
       WHERE i.scope = 'academique' AND i.academie = ?`
    )
    .all(academie, academie) as { id: number }[];
  return rows.map((r) => r.id);
}

function idsPlaceholder(ids: number[]): string {
  return ids.map(() => "?").join(",");
}

export interface ParticipationRow {
  label: string;
  inscrits: number;
  votants: number;
  taux: number;
  // Même ventilation, restreinte au 1er degré (CCMI) et au 2nd degré (CCMA)
  // via la colonne `degre` (voir lib/degre.ts) — plus robuste au niveau
  // national que `scrutin_type`, dont le libellé réel varie par académie
  // (CCMI/CCMA/CCMD/CCML1D/CCML2D…), alors que le degré, lui, est uniforme.
  inscritsCcmi: number;
  votantsCcmi: number;
  tauxCcmi: number;
  inscritsCcma: number;
  votantsCcma: number;
  tauxCcma: number;
  // Mêmes ventilations CCMI/CCMA, restreintes aux électeurs reconnus comme
  // adhérents d'un Spelc (voir adherentExistsClause).
  adherentsInscritsCcmi: number;
  adherentsVotantsCcmi: number;
  adherentsTauxCcmi: number;
  adherentsInscritsCcma: number;
  adherentsVotantsCcma: number;
  adherentsTauxCcma: number;
}

export interface AcademieNode extends ParticipationRow {
  spelcs: ParticipationRow[];
}

interface DegreAdherentRaw {
  inscritsCcmi: number;
  votantsCcmi: number;
  inscritsCcma: number;
  votantsCcma: number;
  adherentsInscritsCcmi: number;
  adherentsVotantsCcmi: number;
  adherentsInscritsCcma: number;
  adherentsVotantsCcma: number;
}

function emptyDegreAdherentRaw(): DegreAdherentRaw {
  return {
    inscritsCcmi: 0,
    votantsCcmi: 0,
    inscritsCcma: 0,
    votantsCcma: 0,
    adherentsInscritsCcmi: 0,
    adherentsVotantsCcmi: 0,
    adherentsInscritsCcma: 0,
    adherentsVotantsCcma: 0,
  };
}

function toParticipationRow(label: string, inscrits: number, votants: number, raw: DegreAdherentRaw): ParticipationRow {
  const pct = (num: number, den: number) => (den ? num / den : 0);
  return {
    label,
    inscrits,
    votants,
    taux: pct(votants, inscrits),
    inscritsCcmi: raw.inscritsCcmi,
    votantsCcmi: raw.votantsCcmi,
    tauxCcmi: pct(raw.votantsCcmi, raw.inscritsCcmi),
    inscritsCcma: raw.inscritsCcma,
    votantsCcma: raw.votantsCcma,
    tauxCcma: pct(raw.votantsCcma, raw.inscritsCcma),
    adherentsInscritsCcmi: raw.adherentsInscritsCcmi,
    adherentsVotantsCcmi: raw.adherentsVotantsCcmi,
    adherentsTauxCcmi: pct(raw.adherentsVotantsCcmi, raw.adherentsInscritsCcmi),
    adherentsInscritsCcma: raw.adherentsInscritsCcma,
    adherentsVotantsCcma: raw.adherentsVotantsCcma,
    adherentsTauxCcma: pct(raw.adherentsVotantsCcma, raw.adherentsInscritsCcma),
  };
}

interface TreeAcc {
  inscrits: number;
  votants: number;
  raw: DegreAdherentRaw;
}

function newTreeAcc(): TreeAcc {
  return { inscrits: 0, votants: 0, raw: emptyDegreAdherentRaw() };
}

function bumpTreeAcc(acc: TreeAcc, degre: string, votant: number, isAdherent: boolean): void {
  acc.inscrits++;
  acc.votants += votant;
  if (degre === "1D") {
    acc.raw.inscritsCcmi++;
    acc.raw.votantsCcmi += votant;
    if (isAdherent) {
      acc.raw.adherentsInscritsCcmi++;
      acc.raw.adherentsVotantsCcmi += votant;
    }
  } else if (degre === "2D") {
    acc.raw.inscritsCcma++;
    acc.raw.votantsCcma += votant;
    if (isAdherent) {
      acc.raw.adherentsInscritsCcma++;
      acc.raw.adherentsVotantsCcma += votant;
    }
  }
}

/**
 * TCD participation par académie, en cascade par Spelc (scrutin national
 * CCMMEP). Agrégation faite en JS, en une seule passe sur l'import courant
 * (potentiellement des centaines de milliers de lignes) : une sous-requête
 * SQL corrélée par ligne (voir buildAdherentIdentitySets) deviendrait ici
 * bien trop lente, et comme le backend est mono-thread (Node), toute
 * l'application reste bloquée pendant toute sa durée.
 */
export function participationTreeNational(): AcademieNode[] {
  const ids = currentImportIds("national", null);
  if (ids.length === 0) return [];
  const placeholders = idsPlaceholder(ids);

  const rows = db
    .prepare(
      `SELECT COALESCE(academie, 'Non déterminé') AS academie, COALESCE(spelc, 'Non déterminé') AS spelcLabel,
              spelc, nom_norm AS nomNorm, prenom_norm AS prenomNorm, nom_naissance_norm AS nomNaissanceNorm,
              degre, votant
       FROM emargements WHERE import_id IN (${placeholders})`
    )
    .all(...ids) as {
      academie: string;
      spelcLabel: string;
      spelc: string | null;
      nomNorm: string;
      prenomNorm: string;
      nomNaissanceNorm: string | null;
      degre: string;
      votant: number;
    }[];

  const adherentSets = buildAdherentIdentitySets();

  const academieAcc = new Map<string, TreeAcc>();
  const spelcAccByAcademie = new Map<string, Map<string, TreeAcc>>();

  for (const row of rows) {
    const isAdherent = electeurMatchesAdherent(adherentSets, row.spelc, row.nomNorm, row.prenomNorm, row.nomNaissanceNorm);

    const a = academieAcc.get(row.academie) ?? newTreeAcc();
    bumpTreeAcc(a, row.degre, row.votant, isAdherent);
    academieAcc.set(row.academie, a);

    const spelcMap = spelcAccByAcademie.get(row.academie) ?? new Map<string, TreeAcc>();
    const s = spelcMap.get(row.spelcLabel) ?? newTreeAcc();
    bumpTreeAcc(s, row.degre, row.votant, isAdherent);
    spelcMap.set(row.spelcLabel, s);
    spelcAccByAcademie.set(row.academie, spelcMap);
  }

  return [...academieAcc.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([academie, acc]) => ({
      ...toParticipationRow(academie, acc.inscrits, acc.votants, acc.raw),
      spelcs: [...(spelcAccByAcademie.get(academie) ?? new Map<string, TreeAcc>()).entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([label, s]) => toParticipationRow(label, s.inscrits, s.votants, s.raw)),
    }));
}

export interface ScopeFilter {
  scope: Scope;
  academie?: string | null;
  spelc?: string | null;
}

/**
 * Pour un scope académique, l'académie est nécessaire pour retrouver les
 * imports "actuels" (ils sont groupés par académie). Un tableau de bord
 * Spelc ne connaît que le Spelc : on retrouve alors l'académie via le
 * référentiel Spelc -> Académie plutôt que de renvoyer un résultat vide.
 */
function effectiveAcademie(filter: ScopeFilter): string | null {
  if (filter.academie) return filter.academie;
  if (!filter.spelc) return null;
  const row = db.prepare("SELECT academie FROM ref_spelc WHERE spelc = ?").get(filter.spelc) as
    | { academie: string }
    | undefined;
  return row?.academie ?? null;
}

function whereForScope(filter: ScopeFilter, ids: number[]): { clause: string; params: unknown[] } {
  const parts = [`import_id IN (${idsPlaceholder(ids)})`];
  const params: unknown[] = [...ids];
  if (filter.spelc) {
    parts.push("spelc = ?");
    params.push(filter.spelc);
  } else if (filter.academie) {
    // Un Spelc filtre déjà implicitement sur son académie (ils appartiennent
    // tous les deux au même import "académique"). Mais pour le scope
    // "national", tous les académies partagent le même import CCMMEP : sans
    // ce filtre, une académie sans Spelc précisé verrait les chiffres de la
    // France entière plutôt que les siens.
    parts.push("academie = ?");
    params.push(filter.academie);
  }
  return { clause: parts.join(" AND "), params };
}

export function camembert(filter: ScopeFilter): { votants: number; nonVotants: number } {
  const ids = currentImportIds(filter.scope, effectiveAcademie(filter));
  if (ids.length === 0) return { votants: 0, nonVotants: 0 };
  const { clause, params } = whereForScope(filter, ids);
  const row = db
    .prepare(`SELECT COUNT(*) AS total, SUM(votant) AS votants FROM emargements WHERE ${clause}`)
    .get(...params) as { total: number; votants: number };
  return { votants: row.votants ?? 0, nonVotants: (row.total ?? 0) - (row.votants ?? 0) };
}

export interface CourbePoint {
  date: string;
  inscrits: number;
  votants: number;
  taux: number;
}

/**
 * Courbe des taux de participation cumulés par jour, reconstruite à partir
 * des dates d'émargement individuelles contenues dans l'import le plus
 * récent (chaque fichier CCMMEP étant cumulatif par nature, un seul import
 * suffit à reconstituer l'historique complet des jours déjà écoulés).
 */
export function courbeCumulative(filter: ScopeFilter): CourbePoint[] {
  const ids = currentImportIds(filter.scope, effectiveAcademie(filter));
  if (ids.length === 0) return [];
  const { clause, params } = whereForScope(filter, ids);

  const totalRow = db.prepare(`SELECT COUNT(*) AS total FROM emargements WHERE ${clause}`).get(...params) as {
    total: number;
  };
  const inscrits = totalRow.total ?? 0;

  const dayRows = db
    .prepare(
      `SELECT substr(date_emargement, 1, 10) AS day, COUNT(*) AS count
       FROM emargements WHERE ${clause} AND date_emargement IS NOT NULL
       GROUP BY day ORDER BY day`
    )
    .all(...params) as { day: string; count: number }[];

  let cumulativeVotants = 0;
  return dayRows.map((r) => {
    cumulativeVotants += r.count;
    return {
      date: r.day,
      inscrits,
      votants: cumulativeVotants,
      taux: inscrits ? cumulativeVotants / inscrits : 0,
    };
  });
}

export interface ScrutinsFilter extends ScopeFilter {
  scrutinType?: string | null;
  votant?: "votant" | "non_votant" | null;
  adherent?: "oui" | "non" | null;
  /** Nom de l'établissement (valeur de "affectation"), filtre exact. */
  affectation?: string | null;
}

export interface ScrutinsResult {
  groups: { scrutinType: string; total: number; votants: number }[];
  rows: Record<string, unknown>[];
  totalRows: number;
}

export function scrutinsTab(filter: ScrutinsFilter, limit = 200, offset = 0): ScrutinsResult {
  const ids = currentImportIds(filter.scope, effectiveAcademie(filter));
  if (ids.length === 0) return { groups: [], rows: [], totalRows: 0 };

  const parts = [`e.import_id IN (${idsPlaceholder(ids)})`];
  const params: unknown[] = [...ids];
  if (filter.spelc) {
    parts.push("e.spelc = ?");
    params.push(filter.spelc);
  } else if (filter.academie) {
    // Même correctif que whereForScope() : sans lui, une académie sans Spelc
    // précisé verrait les émargements de toute la France en scope national.
    parts.push("e.academie = ?");
    params.push(filter.academie);
  }
  if (filter.scrutinType) {
    parts.push("e.scrutin_type = ?");
    params.push(filter.scrutinType);
  }
  if (filter.votant === "votant") parts.push("e.votant = 1");
  if (filter.votant === "non_votant") parts.push("e.votant = 0");

  // Le rapprochement adhérent n'a de sens qu'une fois filtré sur un Spelc précis
  // (les adhérents sont déclarés par Spelc). On l'exprime en EXISTS (plutôt
  // qu'un JOIN) pour ne jamais risquer de dupliquer une ligne si plusieurs
  // adhérents partagent le même nom/prénom au sein d'un Spelc.
  const adherentExists = adherentExistsClause();
  const showAdherentStatus = Boolean(filter.spelc);
  if (filter.spelc && filter.adherent === "oui") parts.push(adherentExists);
  else if (filter.spelc && filter.adherent === "non") parts.push(`NOT ${adherentExists}`);

  const where = parts.join(" AND ");

  const groups = db
    .prepare(
      `SELECT COALESCE(e.scrutin_type, 'Non défini') AS scrutinType, COUNT(*) AS total, SUM(e.votant) AS votants
       FROM emargements e WHERE ${where} GROUP BY scrutinType ORDER BY scrutinType`
    )
    .all(...params) as { scrutinType: string; total: number; votants: number }[];

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM emargements e WHERE ${where}`)
    .get(...params) as { c: number };

  const rows = db
    .prepare(
      `SELECT e.nom, e.prenom, e.scrutin_type AS scrutinType, e.votant, e.date_emargement AS dateEmargement,
              e.affectation, e.spelc, e.academie, e.degre
              ${showAdherentStatus ? `, CASE WHEN ${adherentExists} THEN 1 ELSE 0 END AS isAdherent` : ""}
       FROM emargements e WHERE ${where} ORDER BY e.nom, e.prenom LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as Record<string, unknown>[];

  return { groups, rows, totalRows: totalRow.c };
}

export interface ScrutinsByEtablissementGroup {
  etablissement: string;
  rows: Record<string, unknown>[];
}

export interface ScrutinsByEtablissementResult {
  groups: { scrutinType: string; total: number; votants: number }[];
  /** Établissements disponibles sous les mêmes filtres, hors le filtre établissement
   * lui-même — pour pouvoir toujours en choisir un autre sans repasser par "Tous". */
  etablissementOptions: string[];
  etablissements: ScrutinsByEtablissementGroup[];
  totalRows: number;
}

/**
 * Même détail que scrutinsTab, mais groupé par établissement (trié par ordre
 * alphabétique), chaque établissement listant ses électeurs également triés
 * par ordre alphabétique — pas de pagination : le périmètre académique reste
 * d'une taille raisonnable à charger en une fois côté serveur.
 */
export function scrutinsByEtablissement(filter: ScrutinsFilter): ScrutinsByEtablissementResult {
  const ids = currentImportIds(filter.scope, effectiveAcademie(filter));
  if (ids.length === 0) return { groups: [], etablissementOptions: [], etablissements: [], totalRows: 0 };

  const baseParts = [`e.import_id IN (${idsPlaceholder(ids)})`];
  const baseParams: unknown[] = [...ids];
  if (filter.spelc) {
    baseParts.push("e.spelc = ?");
    baseParams.push(filter.spelc);
  } else if (filter.academie) {
    baseParts.push("e.academie = ?");
    baseParams.push(filter.academie);
  }
  if (filter.scrutinType) {
    baseParts.push("e.scrutin_type = ?");
    baseParams.push(filter.scrutinType);
  }
  if (filter.votant === "votant") baseParts.push("e.votant = 1");
  if (filter.votant === "non_votant") baseParts.push("e.votant = 0");

  const adherentExists = adherentExistsClause();
  const showAdherentStatus = Boolean(filter.spelc);
  if (filter.spelc && filter.adherent === "oui") baseParts.push(adherentExists);
  else if (filter.spelc && filter.adherent === "non") baseParts.push(`NOT ${adherentExists}`);

  const whereForOptions = baseParts.join(" AND ");
  const etablissementOptions = (
    db
      .prepare(
        `SELECT DISTINCT COALESCE(e.affectation, 'Non renseigné') AS etab
         FROM emargements e WHERE ${whereForOptions} ORDER BY etab`
      )
      .all(...baseParams) as { etab: string }[]
  ).map((r) => r.etab);

  const parts = [...baseParts];
  const params = [...baseParams];
  if (filter.affectation) {
    parts.push("COALESCE(e.affectation, 'Non renseigné') = ?");
    params.push(filter.affectation);
  }
  const where = parts.join(" AND ");

  const groups = db
    .prepare(
      `SELECT COALESCE(e.scrutin_type, 'Non défini') AS scrutinType, COUNT(*) AS total, SUM(e.votant) AS votants
       FROM emargements e WHERE ${where} GROUP BY scrutinType ORDER BY scrutinType`
    )
    .all(...params) as { scrutinType: string; total: number; votants: number }[];

  const allRows = db
    .prepare(
      `SELECT e.nom, e.prenom, COALESCE(e.affectation, 'Non renseigné') AS affectation, e.scrutin_type AS scrutinType,
              e.votant, e.date_emargement AS dateEmargement, e.spelc, e.academie, e.degre
              ${
                showAdherentStatus
                  ? `, CASE WHEN ${adherentExists} THEN 1 ELSE 0 END AS isAdherent, ${adherentContactSelectFragment("e", "adherent")}`
                  : ""
              }
       FROM emargements e WHERE ${where}`
    )
    .all(...params) as (Record<string, unknown> & { nom: string; prenom: string; affectation: string })[];

  const byEtab = new Map<string, typeof allRows>();
  for (const row of allRows) {
    const list = byEtab.get(row.affectation);
    if (list) list.push(row);
    else byEtab.set(row.affectation, [row]);
  }

  const etablissements = [...byEtab.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "fr"))
    .map(([etablissement, rows]) => ({
      etablissement,
      rows: rows.sort((a, b) => {
        const byNom = a.nom.localeCompare(b.nom, "fr");
        return byNom !== 0 ? byNom : a.prenom.localeCompare(b.prenom, "fr");
      }),
    }));

  return { groups, etablissementOptions, etablissements, totalRows: allRows.length };
}

export interface EtablissementRow {
  affectation: string;
  inscrits: number;
  votants: number;
  taux: number;
  /** Parmi les électeurs de cet établissement reconnus comme adhérents (voir
   * adherentExistsClause) : inscrits, votants et taux correspondant — permet
   * de distinguer la participation de l'établissement dans son ensemble de
   * celle des seuls adhérents du (ou des, en scope académique) Spelc. */
  adherentsInscrits: number;
  adherentsVotants: number;
  adherentsTaux: number;
}

export function participationParEtablissement(filter: ScopeFilter): EtablissementRow[] {
  const ids = currentImportIds(filter.scope, effectiveAcademie(filter));
  if (ids.length === 0) return [];
  const { clause, params } = whereForScope(filter, ids);
  const rows = db
    .prepare(
      `SELECT COALESCE(affectation, 'Non renseigné') AS affectation, spelc, nom_norm AS nomNorm, prenom_norm AS prenomNorm,
              nom_naissance_norm AS nomNaissanceNorm, votant
       FROM emargements WHERE ${clause}`
    )
    .all(...params) as {
      affectation: string;
      spelc: string | null;
      nomNorm: string;
      prenomNorm: string;
      nomNaissanceNorm: string | null;
      votant: number;
    }[];

  const adherentSets = buildAdherentIdentitySets();

  interface Acc {
    inscrits: number;
    votants: number;
    adherentsInscrits: number;
    adherentsVotants: number;
  }
  const acc = new Map<string, Acc>();
  for (const row of rows) {
    const a = acc.get(row.affectation) ?? { inscrits: 0, votants: 0, adherentsInscrits: 0, adherentsVotants: 0 };
    a.inscrits++;
    a.votants += row.votant;
    if (electeurMatchesAdherent(adherentSets, row.spelc, row.nomNorm, row.prenomNorm, row.nomNaissanceNorm)) {
      a.adherentsInscrits++;
      a.adherentsVotants += row.votant;
    }
    acc.set(row.affectation, a);
  }

  return [...acc.entries()]
    .sort((a, b) => b[1].inscrits - a[1].inscrits)
    .map(([affectation, a]) => ({
      affectation,
      inscrits: a.inscrits,
      votants: a.votants,
      taux: a.inscrits ? a.votants / a.inscrits : 0,
      adherentsInscrits: a.adherentsInscrits,
      adherentsVotants: a.adherentsVotants,
      adherentsTaux: a.adherentsInscrits ? a.adherentsVotants / a.adherentsInscrits : 0,
    }));
}
