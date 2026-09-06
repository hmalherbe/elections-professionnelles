import { db } from "../db/index.js";
import {
  buildEmargementRow,
  parseEmargementsJson,
  type RawEmargementItem,
} from "../parsers/emargements.js";
import type { Degre } from "../lib/degre.js";
import dayjs from "dayjs";

export interface ImportResult {
  importId: number;
  rowCount: number;
  votants: number;
  degreCounts: Record<string, number>;
}

interface ImportContext {
  scope: "national" | "academique";
  academie: string | null;
  degre: Degre | null; // pour un import académique
  filename: string;
  /** null pour un import déclenché automatiquement (planificateur de scraping), sans utilisateur associé. */
  importedBy: number | null;
  snapshotDate: string; // YYYY-MM-DD
}

function getAcademieScrutins(academie: string | null): { type1d: string | null; type2d: string | null } {
  if (!academie) return { type1d: null, type2d: null };
  const row = db
    .prepare("SELECT type_1d, type_2d FROM ref_academie_scrutins WHERE academie = ?")
    .get(academie) as { type_1d: string; type_2d: string } | undefined;
  return { type1d: row?.type_1d ?? null, type2d: row?.type_2d ?? null };
}

export function runImport(raw: unknown, ctx: ImportContext): ImportResult {
  const items = parseEmargementsJson(raw);

  const insertImport = db.prepare(
    `INSERT INTO imports (scope, academie, degre, filename, imported_by, snapshot_date, row_count)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insertEmargement = db.prepare(`
    INSERT INTO emargements (
      import_id, scope, academie, degre, scrutin_type, nom, prenom, nom_norm, prenom_norm,
      date_emargement, corps, affectation, departement, spelc, reference_bulletin, votant, snapshot_date
    ) VALUES (@importId, @scope, @academie, @degre, @scrutinType, @nom, @prenom, @nomNorm, @prenomNorm,
      @dateEmargement, @corps, @affectation, @departement, @spelc, @referenceBulletin, @votant, @snapshotDate)
  `);

  const degreCounts: Record<string, number> = {};
  let votants = 0;

  const tx = db.transaction((rows: RawEmargementItem[]) => {
    const importId = insertImport.run(
      ctx.scope,
      ctx.academie,
      ctx.degre,
      ctx.filename,
      ctx.importedBy,
      ctx.snapshotDate,
      rows.length
    ).lastInsertRowid as number;

    let scrutinsForAcademie = { type1d: null as string | null, type2d: null as string | null };
    if (ctx.scope === "academique") {
      scrutinsForAcademie = getAcademieScrutins(ctx.academie);
    }

    for (const item of rows) {
      const row = buildEmargementRow(item, {
        forcedDegre: ctx.degre ?? undefined,
        forcedAcademie: ctx.academie ?? undefined,
        scrutinTypeFixed: ctx.scope === "national" ? "CCMMEP" : undefined,
        scrutinTypeFor1D: scrutinsForAcademie.type1d ?? undefined,
        scrutinTypeFor2D: scrutinsForAcademie.type2d ?? undefined,
      });

      degreCounts[row.degre] = (degreCounts[row.degre] ?? 0) + 1;
      if (row.votant) votants++;

      insertEmargement.run({
        importId,
        scope: ctx.scope,
        academie: row.academie,
        degre: row.degre,
        scrutinType: row.scrutinType,
        nom: row.nom,
        prenom: row.prenom,
        nomNorm: row.nomNorm,
        prenomNorm: row.prenomNorm,
        dateEmargement: row.dateEmargement,
        corps: row.corps,
        affectation: row.affectation,
        departement: row.departement,
        spelc: row.spelc,
        referenceBulletin: row.referenceBulletin,
        votant: row.votant,
        snapshotDate: ctx.snapshotDate,
      });
    }

    return importId;
  });

  const importId = tx(items);

  return { importId, rowCount: items.length, votants, degreCounts };
}

/**
 * Une même personne ne peut légitimement appartenir qu'à un seul scrutin
 * local (CCMI ou CCMA/CCMD selon le degré) — le degré (donc le scrutin) est
 * assigné par fichier importé, pas dérivé de la personne elle-même (voir
 * buildEmargementRow). Si les fichiers 1er et 2nd degré d'une académie se
 * chevauchent (mêmes fichiers scrapés/téléversés par erreur pour les deux
 * degrés, export source mal filtré...), la même personne se retrouve avec
 * deux lignes contradictoires. Détecté après import pour alerter l'admin
 * plutôt que de laisser le doublon silencieux dans les tableaux de bord.
 */
export function findCrossDegreDuplicates(academie: string): { nom: string; prenom: string }[] {
  const ids = db
    .prepare(
      `SELECT i.id FROM imports i
       INNER JOIN (
         SELECT degre, MAX(id) AS max_id FROM imports
         WHERE scope = 'academique' AND academie = ? GROUP BY degre
       ) latest ON latest.degre = i.degre AND latest.max_id = i.id
       WHERE i.scope = 'academique' AND i.academie = ?`
    )
    .all(academie, academie) as { id: number }[];
  if (ids.length < 2) return [];
  const placeholders = ids.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT nom, prenom FROM emargements
       WHERE import_id IN (${placeholders})
       GROUP BY nom_norm, prenom_norm
       HAVING COUNT(DISTINCT degre) > 1`
    )
    .all(...ids.map((r) => r.id)) as { nom: string; prenom: string }[];
}

export function defaultSnapshotDate(): string {
  return dayjs().format("YYYY-MM-DD");
}
