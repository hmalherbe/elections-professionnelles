import dayjs from "dayjs";
import { db } from "../db/index.js";
import { buildEmargementRow, parseEmargementsJson, type RawEmargementItem } from "../parsers/emargements.js";
import type { ScrutinCode } from "../lib/scrutins.js";

export interface ImportResult {
  importId: number;
  rowCount: number;
  votants: number;
}

interface ImportContext {
  scrutin: ScrutinCode;
  filename: string;
  importedBy: number;
  snapshotDate: string; // YYYY-MM-DD
}

export function runImport(raw: unknown, ctx: ImportContext): ImportResult {
  const items = parseEmargementsJson(raw);

  const insertImport = db.prepare(
    `INSERT INTO imports (scrutin, filename, imported_by, snapshot_date, row_count) VALUES (?, ?, ?, ?, ?)`
  );
  const insertEmargement = db.prepare(`
    INSERT INTO emargements (
      import_id, scrutin, nom, prenom, nom_norm, prenom_norm,
      date_emargement, corps, etablissement, reference_bulletin, votant, snapshot_date
    ) VALUES (@importId, @scrutin, @nom, @prenom, @nomNorm, @prenomNorm,
      @dateEmargement, @corps, @etablissement, @referenceBulletin, @votant, @snapshotDate)
  `);

  let votants = 0;
  const tx = db.transaction((rows: RawEmargementItem[]) => {
    const importId = insertImport.run(ctx.scrutin, ctx.filename, ctx.importedBy, ctx.snapshotDate, rows.length)
      .lastInsertRowid as number;

    for (const item of rows) {
      const row = buildEmargementRow(item, ctx.scrutin);
      if (row.votant) votants++;
      insertEmargement.run({
        importId,
        scrutin: row.scrutin,
        nom: row.nom,
        prenom: row.prenom,
        nomNorm: row.nomNorm,
        prenomNorm: row.prenomNorm,
        dateEmargement: row.dateEmargement,
        corps: row.corps,
        etablissement: row.etablissement,
        referenceBulletin: row.referenceBulletin,
        votant: row.votant,
        snapshotDate: ctx.snapshotDate,
      });
    }
    return importId;
  });

  const importId = tx(items);
  return { importId, rowCount: items.length, votants };
}

export function defaultSnapshotDate(): string {
  return dayjs().format("YYYY-MM-DD");
}

export interface ResetResult {
  importsDeleted: number;
  emargementsDeleted: number;
  adherentsDeleted: number;
}

/**
 * Réinitialise l'application en supprimant toutes les données importées
 * (émargements des 2 scrutins, fichier des adhérents) — voir onglet
 * Paramètres, réservé à l'administration complète. Conserve tout le reste
 * (comptes, modèle de relance, réglages Brevo...). La suppression des
 * imports entraîne en cascade celle des émargements (ON DELETE CASCADE,
 * voir db/index.ts) ; celle des adhérents n'entraîne pas celle des
 * suggestions de rapprochement (table ancrée sur l'identité adhérent, pas
 * sur un id), donc supprimée ici explicitement pour garder le même effet
 * "tout remettre à zéro".
 */
export function resetImportedData(): ResetResult {
  const importsDeleted = (db.prepare("SELECT COUNT(*) AS c FROM imports").get() as { c: number }).c;
  const emargementsDeleted = (db.prepare("SELECT COUNT(*) AS c FROM emargements").get() as { c: number }).c;
  const adherentsDeleted = (db.prepare("SELECT COUNT(*) AS c FROM adherents").get() as { c: number }).c;
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM imports").run();
    db.prepare("DELETE FROM adherent_fuzzy_matches").run();
    db.prepare("DELETE FROM adherents").run();
  });
  tx();
  return { importsDeleted, emargementsDeleted, adherentsDeleted };
}
