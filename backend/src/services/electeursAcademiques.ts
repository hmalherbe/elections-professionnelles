import { db } from "../db/index.js";
import { stripAccents } from "../lib/normalize.js";
import { currentImportIds } from "./stats.js";
import { defaultSnapshotDate, getAcademieScrutins } from "./imports.js";

const SIMULATION_FILENAME = "electeurs-academiques-ccmmep.json";

interface NationalRow {
  nom: string;
  prenom: string;
  nom_norm: string;
  prenom_norm: string;
  date_emargement: string | null;
  corps: string | null;
  affectation: string | null;
  departement: string | null;
  spelc: string | null;
  reference_bulletin: string | null;
  votant: number;
  academie: string;
}

/**
 * Règle métier demandée : le nom de l'établissement (champ "affectation")
 * distingue de façon fiable le 2nd degré (collège/lycée) du 1er degré
 * (école) ; faute de règle plus précise pour les autres cas (services
 * académiques, administration...), le degré est tiré au hasard.
 */
function classifyDegreFromEtablissement(affectation: string | null): "1D" | "2D" {
  const normalized = stripAccents(affectation ?? "").toUpperCase();
  if (normalized.includes("COLLEGE") || normalized.includes("LYCEE")) return "2D";
  if (normalized.includes("ECOLE")) return "1D";
  return Math.random() < 0.5 ? "1D" : "2D";
}

export interface ElecteursAcademiquesResult {
  academies: { academie: string; degre1D: number; degre2D: number }[];
  skippedSansAcademie: number;
}

/**
 * Construit, pour chaque académie, un jeu d'électeurs 1er et 2nd degré à
 * partir du fichier national CCMMEP déjà importé — solution provisoire en
 * attendant l'ouverture des vrais portails académiques (décembre) : chaque
 * électeur est replacé dans son académie via le département déjà résolu à
 * l'import national, puis affecté à un degré via le nom de son
 * établissement. Remplace entièrement le jeu précédent à chaque appel.
 */
export function buildElecteursAcademiques(importedBy: number | null): ElecteursAcademiquesResult {
  const [nationalImportId] = currentImportIds("national", null);
  if (!nationalImportId) {
    throw new Error("Aucun import national CCMMEP disponible : importez-le d'abord.");
  }

  const rows = db
    .prepare(
      `SELECT nom, prenom, nom_norm, prenom_norm, date_emargement, corps, affectation,
              departement, spelc, reference_bulletin, votant, academie
       FROM emargements WHERE import_id = ? AND academie IS NOT NULL`
    )
    .all(nationalImportId) as NationalRow[];

  const skippedRow = db
    .prepare(`SELECT COUNT(*) AS c FROM emargements WHERE import_id = ? AND academie IS NULL`)
    .get(nationalImportId) as { c: number };

  const grouped = new Map<string, NationalRow[]>();
  for (const row of rows) {
    const degre = classifyDegreFromEtablissement(row.affectation);
    const key = `${row.academie}|${degre}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  }

  const snapshotDate = defaultSnapshotDate();
  const insertImport = db.prepare(
    `INSERT INTO imports (scope, academie, degre, filename, imported_by, snapshot_date, row_count, is_simulation)
     VALUES ('academique', ?, ?, ?, ?, ?, ?, 1)`
  );
  const insertEmargement = db.prepare(`
    INSERT INTO emargements (
      import_id, scope, academie, degre, scrutin_type, nom, prenom, nom_norm, prenom_norm,
      date_emargement, corps, affectation, departement, spelc, reference_bulletin, votant, snapshot_date
    ) VALUES (@importId, 'academique', @academie, @degre, @scrutinType, @nom, @prenom, @nomNorm, @prenomNorm,
      @dateEmargement, @corps, @affectation, @departement, @spelc, @referenceBulletin, @votant, @snapshotDate)
  `);

  const perAcademie = new Map<string, { degre1D: number; degre2D: number }>();

  const tx = db.transaction(() => {
    deleteElecteursAcademiques();
    for (const [key, items] of grouped) {
      const [academie, degre] = key.split("|") as [string, "1D" | "2D"];
      const scrutins = getAcademieScrutins(academie);
      const scrutinType = degre === "1D" ? scrutins.type1d : scrutins.type2d;
      const importId = insertImport.run(academie, degre, SIMULATION_FILENAME, importedBy, snapshotDate, items.length)
        .lastInsertRowid as number;
      for (const row of items) {
        insertEmargement.run({
          importId,
          academie,
          degre,
          scrutinType,
          nom: row.nom,
          prenom: row.prenom,
          nomNorm: row.nom_norm,
          prenomNorm: row.prenom_norm,
          dateEmargement: row.date_emargement,
          corps: row.corps,
          affectation: row.affectation,
          departement: row.departement,
          spelc: row.spelc,
          referenceBulletin: row.reference_bulletin,
          votant: row.votant,
          snapshotDate,
        });
      }
      const entry = perAcademie.get(academie) ?? { degre1D: 0, degre2D: 0 };
      if (degre === "1D") entry.degre1D += items.length;
      else entry.degre2D += items.length;
      perAcademie.set(academie, entry);
    }
  });
  tx();

  return {
    academies: Array.from(perAcademie.entries())
      .map(([academie, counts]) => ({ academie, ...counts }))
      .sort((a, b) => a.academie.localeCompare(b.academie)),
    skippedSansAcademie: skippedRow.c,
  };
}

export function deleteElecteursAcademiques(): { importsDeleted: number; emargementsDeleted: number } {
  const emargementsRow = db
    .prepare(`SELECT COUNT(*) AS c FROM emargements WHERE import_id IN (SELECT id FROM imports WHERE is_simulation = 1)`)
    .get() as { c: number };
  const result = db.prepare(`DELETE FROM imports WHERE is_simulation = 1`).run();
  return { importsDeleted: result.changes, emargementsDeleted: emargementsRow.c };
}
