import { db } from "../db/index.js";
import {
  buildEmargementRow,
  parseEmargementsJson,
  type RawEmargementItem,
} from "../parsers/emargements.js";
import { extractDepartement, extractDepartementFromCodePostal, extractDepartementFromRne } from "../lib/departement.js";
import { lookupDepartement } from "./reference.js";
import { classifyDegreAvecEtablissement, type Degre } from "../lib/degre.js";
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

export function getAcademieScrutins(academie: string | null): { type1d: string | null; type2d: string | null } {
  if (!academie) return { type1d: null, type2d: null };
  const row = db
    .prepare("SELECT type_1d, type_2d FROM ref_academie_scrutins WHERE academie = ?")
    .get(academie) as { type_1d: string; type_2d: string } | undefined;
  return { type1d: row?.type_1d ?? null, type2d: row?.type_2d ?? null };
}

/**
 * Vérifie que le premier électeur du fichier correspond bien à l'académie
 * visée par cet import académique, via son code postal — champ "codePostal"
 * (fichier des électeurs) ou à repérer dans le texte libre "affectation"
 * (fichier d'émargement), même résolution département -> académie qu'à
 * l'import réel, voir buildEmargementRow() — garde-fou contre un fichier de
 * la mauvaise académie importé par erreur. Retourne l'académie détectée si
 * elle diffère de celle attendue ; null si elle correspond, ou si elle n'a
 * pas pu être déterminée (aucun code postal reconnu, ou département absent
 * du référentiel) — dans ce cas on laisse passer, faute de pouvoir se
 * prononcer sur un seul enregistrement.
 */
export function detectAcademieMismatch(items: RawEmargementItem[], expectedAcademie: string): string | null {
  if (items.length === 0) return null;
  const first = items[0];
  const departement =
    extractDepartementFromRne(first.rne) ??
    extractDepartementFromCodePostal(first.codePostal) ??
    extractDepartement(first.affectation);
  const detected = departement ? lookupDepartement(departement)?.academie ?? null : null;
  return detected && detected !== expectedAcademie ? detected : null;
}

/**
 * Vérifie que le fichier académique importé correspond bien au degré
 * attendu (1D ou 2D) — garde-fou contre le fichier du mauvais degré importé
 * par erreur (ex. un fichier 2nd degré déposé comme 1er degré, ou
 * l'inverse). Classe chaque électeur par son corps (champ "corps"/"nomCol")
 * puis, en repli, le nom de son établissement ("affectation"/"nomEtab") —
 * "école élémentaire/primaire" -> 1D, "collège"/"lycée" -> 2D — SANS tirage
 * aléatoire (voir classifyDegreAvecEtablissement) : contrairement à
 * detectAcademieMismatch(), qui ne regarde que le premier électeur, ici
 * TOUS les électeurs du fichier sont classés, et seule une majorité
 * cohérente pour l'AUTRE degré déclenche l'erreur — un seul électeur
 * ambigu ou mal renseigné ne doit jamais bloquer un fichier par ailleurs
 * cohérent. Retourne le degré détecté (en toutes lettres) si une majorité
 * des électeurs dont le degré a pu être déterminé pointent vers l'autre
 * degré que celui attendu ; null sinon (fichier cohérent, ou pas assez
 * d'électeurs déterminables pour se prononcer).
 */
export function detectDegreMismatch(items: RawEmargementItem[], expectedDegre: "1D" | "2D"): string | null {
  let same = 0;
  let other = 0;
  for (const item of items) {
    const degre = classifyDegreAvecEtablissement(item.corps, item.affectation);
    if (degre === "INDETERMINE") continue;
    if (degre === expectedDegre) same++;
    else other++;
  }
  if (other <= same) return null;
  return expectedDegre === "1D" ? "2nd degré" : "1er degré";
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
      nom_naissance, nom_naissance_norm,
      date_emargement, corps, affectation, departement, spelc, reference_bulletin, votant, snapshot_date
    ) VALUES (@importId, @scope, @academie, @degre, @scrutinType, @nom, @prenom, @nomNorm, @prenomNorm,
      @nomNaissance, @nomNaissanceNorm,
      @dateEmargement, @corps, @affectation, @departement, @spelc, @referenceBulletin, @votant, @snapshotDate)
  `);

  const degreCounts: Record<string, number> = {};
  let votants = 0;

  // Import national (quotidien) : toujours cumulatif par nature (voir
  // courbeCumulative) — seul le plus récent est jamais lu (currentImportIds
  // ne retient que lui). Les précédents ne servent donc plus à rien une
  // fois le nouveau inséré, mais restaient jusqu'ici indéfiniment (aucun
  // bouton de suppression pour ce scope, contrairement aux imports
  // académiques) : la table emargements grossit sans fin au fil des
  // imports quotidiens, ralentissant chaque import suivant (4 index à
  // maintenir sur une table toujours plus grosse). On les supprime donc
  // avant d'insérer le nouveau (CASCADE supprime leurs émargements avec
  // eux), dans la même transaction pour rester atomique.
  const deletePreviousNational = db.prepare("DELETE FROM imports WHERE scope = 'national'");

  const tx = db.transaction((rows: RawEmargementItem[]) => {
    if (ctx.scope === "national") deletePreviousNational.run();

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
        nomNaissance: row.nomNaissance,
        nomNaissanceNorm: row.nomNaissanceNorm,
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

export interface ResetResult {
  importsDeleted: number;
  emargementsDeleted: number;
  adherentsDeleted: number;
}

/**
 * Réinitialise l'application en supprimant toutes les données importées
 * (fichier national CCMMEP, fichiers académiques 1er/2nd degré, fichiers
 * d'adhérents de chaque Spelc) — voir onglet Paramètres, admin général.
 * Conserve les référentiels (départements/Spelc/académies, scrutins
 * académiques, crédits SMS, chargés séparément) et tout le reste
 * (comptes, modèles de relance, documents...). La suppression des imports
 * entraîne en cascade celle des émargements (ON DELETE CASCADE) ; celle des
 * adhérents entraîne celle des suggestions de rapprochement approximatif.
 */
export function resetImportedData(): ResetResult {
  const importsDeleted = (db.prepare("SELECT COUNT(*) AS c FROM imports").get() as { c: number }).c;
  const emargementsDeleted = (db.prepare("SELECT COUNT(*) AS c FROM emargements").get() as { c: number }).c;
  const adherentsDeleted = (db.prepare("SELECT COUNT(*) AS c FROM adherents").get() as { c: number }).c;
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM imports").run();
    db.prepare("DELETE FROM adherents").run();
  });
  tx();
  return { importsDeleted, emargementsDeleted, adherentsDeleted };
}
