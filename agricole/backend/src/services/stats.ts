import { db } from "../db/index.js";
import type { ScrutinCode } from "../lib/scrutins.js";

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
