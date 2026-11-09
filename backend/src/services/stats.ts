import { db } from "../db/index.js";
import { adherentExistsClause } from "./fuzzyMatching.js";

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

/** Fragment SQL (agrégats conditionnels) pour la ventilation CCMI/CCMA,
 * électeurs et adhérents — voir ParticipationRow. */
function degreAdherentSelectFragment(adherentExists: string): string {
  return `
    SUM(CASE WHEN degre = '1D' THEN 1 ELSE 0 END) AS inscritsCcmi,
    SUM(CASE WHEN degre = '1D' THEN votant ELSE 0 END) AS votantsCcmi,
    SUM(CASE WHEN degre = '2D' THEN 1 ELSE 0 END) AS inscritsCcma,
    SUM(CASE WHEN degre = '2D' THEN votant ELSE 0 END) AS votantsCcma,
    SUM(CASE WHEN ${adherentExists} AND degre = '1D' THEN 1 ELSE 0 END) AS adherentsInscritsCcmi,
    SUM(CASE WHEN ${adherentExists} AND degre = '1D' THEN votant ELSE 0 END) AS adherentsVotantsCcmi,
    SUM(CASE WHEN ${adherentExists} AND degre = '2D' THEN 1 ELSE 0 END) AS adherentsInscritsCcma,
    SUM(CASE WHEN ${adherentExists} AND degre = '2D' THEN votant ELSE 0 END) AS adherentsVotantsCcma
  `;
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

/** TCD participation par académie, en cascade par Spelc (scrutin national CCMMEP). */
export function participationTreeNational(): AcademieNode[] {
  const ids = currentImportIds("national", null);
  if (ids.length === 0) return [];
  const placeholders = idsPlaceholder(ids);
  const adherentExists = adherentExistsClause();
  const extra = degreAdherentSelectFragment(adherentExists);

  const academieRows = db
    .prepare(
      `SELECT COALESCE(academie, 'Non déterminé') AS label, COUNT(*) AS inscrits, SUM(votant) AS votants, ${extra}
       FROM emargements e WHERE e.import_id IN (${placeholders})
       GROUP BY label ORDER BY label`
    )
    .all(...ids) as ({ label: string; inscrits: number; votants: number } & DegreAdherentRaw)[];

  const spelcRows = db
    .prepare(
      `SELECT COALESCE(academie, 'Non déterminé') AS academie, COALESCE(spelc, 'Non déterminé') AS label,
              COUNT(*) AS inscrits, SUM(votant) AS votants, ${extra}
       FROM emargements e WHERE e.import_id IN (${placeholders})
       GROUP BY academie, label ORDER BY academie, label`
    )
    .all(...ids) as ({ academie: string; label: string; inscrits: number; votants: number } & DegreAdherentRaw)[];

  return academieRows.map((a) => ({
    ...toParticipationRow(a.label, a.inscrits, a.votants, a),
    spelcs: spelcRows.filter((s) => s.academie === a.label).map((s) => toParticipationRow(s.label, s.inscrits, s.votants, s)),
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
              ${showAdherentStatus ? `, CASE WHEN ${adherentExists} THEN 1 ELSE 0 END AS isAdherent` : ""}
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
  const adherentExists = adherentExistsClause();
  const rows = db
    .prepare(
      `SELECT COALESCE(affectation, 'Non renseigné') AS affectation, COUNT(*) AS inscrits, SUM(votant) AS votants,
              SUM(CASE WHEN ${adherentExists} THEN 1 ELSE 0 END) AS adherentsInscrits,
              SUM(CASE WHEN ${adherentExists} THEN votant ELSE 0 END) AS adherentsVotants
       FROM emargements e WHERE ${clause} GROUP BY affectation ORDER BY inscrits DESC`
    )
    .all(...params) as {
      affectation: string;
      inscrits: number;
      votants: number;
      adherentsInscrits: number;
      adherentsVotants: number;
    }[];
  return rows.map((r) => ({
    ...r,
    taux: r.inscrits ? r.votants / r.inscrits : 0,
    adherentsTaux: r.adherentsInscrits ? r.adherentsVotants / r.adherentsInscrits : 0,
  }));
}
