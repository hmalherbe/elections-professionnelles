import { db } from "../db/index.js";

export type Scope = "national" | "academique";

/** Retourne les ids des imports "actuels" (les plus récents) pour un scope donné. */
export function currentImportIds(scope: Scope, academie: string | null): number[] {
  if (scope === "national") {
    const row = db
      .prepare("SELECT id FROM imports WHERE scope = 'national' ORDER BY imported_at DESC LIMIT 1")
      .get() as { id: number } | undefined;
    return row ? [row.id] : [];
  }
  if (!academie) return [];
  const rows = db
    .prepare(
      `SELECT i.id FROM imports i
       INNER JOIN (
         SELECT degre, MAX(imported_at) AS max_at FROM imports
         WHERE scope = 'academique' AND academie = ? GROUP BY degre
       ) latest ON latest.degre = i.degre AND latest.max_at = i.imported_at
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
}

export interface AcademieNode extends ParticipationRow {
  spelcs: ParticipationRow[];
}

/** TCD participation par académie, en cascade par Spelc (scrutin national CCMMEP). */
export function participationTreeNational(): AcademieNode[] {
  const ids = currentImportIds("national", null);
  if (ids.length === 0) return [];
  const placeholders = idsPlaceholder(ids);

  const academieRows = db
    .prepare(
      `SELECT COALESCE(academie, 'Non déterminé') AS label, COUNT(*) AS inscrits, SUM(votant) AS votants
       FROM emargements WHERE import_id IN (${placeholders})
       GROUP BY label ORDER BY label`
    )
    .all(...ids) as { label: string; inscrits: number; votants: number }[];

  const spelcRows = db
    .prepare(
      `SELECT COALESCE(academie, 'Non déterminé') AS academie, COALESCE(spelc, 'Non déterminé') AS label,
              COUNT(*) AS inscrits, SUM(votant) AS votants
       FROM emargements WHERE import_id IN (${placeholders})
       GROUP BY academie, label ORDER BY academie, label`
    )
    .all(...ids) as { academie: string; label: string; inscrits: number; votants: number }[];

  return academieRows.map((a) => ({
    label: a.label,
    inscrits: a.inscrits,
    votants: a.votants,
    taux: a.inscrits ? a.votants / a.inscrits : 0,
    spelcs: spelcRows
      .filter((s) => s.academie === a.label)
      .map((s) => ({
        label: s.label,
        inscrits: s.inscrits,
        votants: s.votants,
        taux: s.inscrits ? s.votants / s.inscrits : 0,
      })),
  }));
}

export interface ScopeFilter {
  scope: Scope;
  academie?: string | null;
  spelc?: string | null;
}

function whereForScope(filter: ScopeFilter, ids: number[]): { clause: string; params: unknown[] } {
  const parts = [`import_id IN (${idsPlaceholder(ids)})`];
  const params: unknown[] = [...ids];
  if (filter.spelc) {
    parts.push("spelc = ?");
    params.push(filter.spelc);
  }
  return { clause: parts.join(" AND "), params };
}

export function camembert(filter: ScopeFilter): { votants: number; nonVotants: number } {
  const ids = currentImportIds(filter.scope, filter.academie ?? null);
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

/** Courbe des taux de participation cumulés par jour : un point par snapshot_date d'import. */
export function courbeCumulative(filter: ScopeFilter): CourbePoint[] {
  let importRows: { id: number; snapshot_date: string }[];
  if (filter.scope === "national") {
    importRows = db
      .prepare(
        `SELECT i.id, i.snapshot_date FROM imports i
         INNER JOIN (SELECT snapshot_date, MAX(imported_at) AS max_at FROM imports WHERE scope='national' GROUP BY snapshot_date) latest
         ON latest.snapshot_date = i.snapshot_date AND latest.max_at = i.imported_at
         WHERE i.scope = 'national' ORDER BY i.snapshot_date`
      )
      .all() as { id: number; snapshot_date: string }[];
  } else {
    if (!filter.academie) return [];
    importRows = db
      .prepare(
        `SELECT i.id, i.snapshot_date FROM imports i
         INNER JOIN (
           SELECT snapshot_date, degre, MAX(imported_at) AS max_at FROM imports
           WHERE scope='academique' AND academie = ? GROUP BY snapshot_date, degre
         ) latest ON latest.snapshot_date = i.snapshot_date AND latest.degre = i.degre AND latest.max_at = i.imported_at
         WHERE i.scope = 'academique' AND i.academie = ? ORDER BY i.snapshot_date`
      )
      .all(filter.academie, filter.academie) as { id: number; snapshot_date: string }[];
  }

  const byDate = new Map<string, number[]>();
  for (const r of importRows) {
    const arr = byDate.get(r.snapshot_date) ?? [];
    arr.push(r.id);
    byDate.set(r.snapshot_date, arr);
  }

  const points: CourbePoint[] = [];
  for (const [date, ids] of Array.from(byDate.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    const { clause, params } = whereForScope({ ...filter }, ids);
    const row = db
      .prepare(`SELECT COUNT(*) AS total, SUM(votant) AS votants FROM emargements WHERE ${clause}`)
      .get(...params) as { total: number; votants: number };
    points.push({
      date,
      inscrits: row.total ?? 0,
      votants: row.votants ?? 0,
      taux: row.total ? (row.votants ?? 0) / row.total : 0,
    });
  }
  return points;
}

export interface ScrutinsFilter extends ScopeFilter {
  scrutinType?: string | null;
  votant?: "votant" | "non_votant" | null;
  adherent?: "oui" | "non" | null;
}

export interface ScrutinsResult {
  groups: { scrutinType: string; total: number; votants: number }[];
  rows: Record<string, unknown>[];
  totalRows: number;
}

export function scrutinsTab(filter: ScrutinsFilter, limit = 200, offset = 0): ScrutinsResult {
  const ids = currentImportIds(filter.scope, filter.academie ?? null);
  if (ids.length === 0) return { groups: [], rows: [], totalRows: 0 };

  const parts = [`e.import_id IN (${idsPlaceholder(ids)})`];
  const params: unknown[] = [...ids];
  if (filter.spelc) {
    parts.push("e.spelc = ?");
    params.push(filter.spelc);
  }
  if (filter.scrutinType) {
    parts.push("e.scrutin_type = ?");
    params.push(filter.scrutinType);
  }
  if (filter.votant === "votant") parts.push("e.votant = 1");
  if (filter.votant === "non_votant") parts.push("e.votant = 0");

  let joinAdherents = "";
  if (filter.adherent && filter.spelc) {
    joinAdherents = `LEFT JOIN adherents ad ON ad.spelc = e.spelc AND ad.nom_norm = e.nom_norm AND ad.prenom_norm = e.prenom_norm`;
    if (filter.adherent === "oui") parts.push("ad.id IS NOT NULL");
    else parts.push("ad.id IS NULL");
  }

  const where = parts.join(" AND ");

  const groups = db
    .prepare(
      `SELECT COALESCE(e.scrutin_type, 'Non défini') AS scrutinType, COUNT(*) AS total, SUM(e.votant) AS votants
       FROM emargements e ${joinAdherents} WHERE ${where} GROUP BY scrutinType ORDER BY scrutinType`
    )
    .all(...params) as { scrutinType: string; total: number; votants: number }[];

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM emargements e ${joinAdherents} WHERE ${where}`)
    .get(...params) as { c: number };

  const rows = db
    .prepare(
      `SELECT e.nom, e.prenom, e.scrutin_type AS scrutinType, e.votant, e.date_emargement AS dateEmargement,
              e.affectation, e.spelc, e.academie, e.degre
       FROM emargements e ${joinAdherents} WHERE ${where} ORDER BY e.nom, e.prenom LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as Record<string, unknown>[];

  return { groups, rows, totalRows: totalRow.c };
}

export interface EtablissementRow {
  affectation: string;
  inscrits: number;
  votants: number;
  taux: number;
}

export function participationParEtablissement(filter: ScopeFilter): EtablissementRow[] {
  const ids = currentImportIds(filter.scope, filter.academie ?? null);
  if (ids.length === 0) return [];
  const { clause, params } = whereForScope(filter, ids);
  const rows = db
    .prepare(
      `SELECT COALESCE(affectation, 'Non renseigné') AS affectation, COUNT(*) AS inscrits, SUM(votant) AS votants
       FROM emargements WHERE ${clause} GROUP BY affectation ORDER BY inscrits DESC`
    )
    .all(...params) as { affectation: string; inscrits: number; votants: number }[];
  return rows.map((r) => ({ ...r, taux: r.inscrits ? r.votants / r.inscrits : 0 }));
}
