import { Router } from "express";
import multer from "multer";
import * as unzipper from "unzipper";
import { db } from "../db/index.js";
import { requireAuth, requireRole, canAccessAcademie } from "../middleware/auth.js";
import {
  runImport,
  defaultSnapshotDate,
  findCrossDegreDuplicates,
  detectAcademieMismatch,
  detectDegreMismatch,
} from "../services/imports.js";
import { parseEmargementsJson } from "../parsers/emargements.js";
import { buildElecteursAcademiques, deleteElecteursAcademiques } from "../services/electeursAcademiques.js";
import { loadWorkbook, rowsAsObjects } from "../lib/xlsx.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });

router.use(requireAuth);

/** Import national quotidien du fichier CCMMEP (admin général uniquement). */
router.post("/ccmmep", requireRole("admin_general"), upload.single("file"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Fichier JSON requis." });
    return;
  }
  try {
    const raw = JSON.parse(req.file.buffer.toString("utf-8"));
    const snapshotDate = (req.body?.snapshotDate as string) || defaultSnapshotDate();
    const result = runImport(raw, {
      scope: "national",
      academie: null,
      degre: null,
      filename: req.file.originalname,
      importedBy: req.user!.id,
      snapshotDate,
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

/** Import académique quotidien (1D ou 2D), par un admin académique ou l'admin général. */
router.post(
  "/academique",
  requireRole("admin_academique", "admin_general"),
  upload.single("file"),
  (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "Fichier JSON requis." });
      return;
    }
    const degre = req.body?.degre as string;
    const academie = (req.body?.academie as string) || req.user!.academie || "";
    if (degre !== "1D" && degre !== "2D") {
      res.status(400).json({ error: "Le champ degre doit valoir '1D' ou '2D'." });
      return;
    }
    if (!academie) {
      res.status(400).json({ error: "Académie requise." });
      return;
    }
    if (!canAccessAcademie(req.user!, academie)) {
      res.status(403).json({ error: "Vous ne pouvez importer que pour votre académie." });
      return;
    }
    try {
      const raw = JSON.parse(req.file.buffer.toString("utf-8"));
      const items = parseEmargementsJson(raw);
      const detectedAcademie = detectAcademieMismatch(items, academie);
      if (detectedAcademie) {
        res.status(400).json({
          error: `Ce fichier semble correspondre à l'académie de ${detectedAcademie} (d'après le code postal du premier électeur), pas à ${academie}. Vérifiez le fichier importé.`,
        });
        return;
      }
      const detectedDegre = detectDegreMismatch(items, degre as "1D" | "2D");
      if (detectedDegre) {
        res.status(400).json({
          error: `Ce fichier semble correspondre au ${detectedDegre} (d'après le corps et l'établissement des électeurs), pas au ${
            degre === "1D" ? "1er degré" : "2nd degré"
          } attendu. Vérifiez le fichier importé.`,
        });
        return;
      }
      const snapshotDate = (req.body?.snapshotDate as string) || defaultSnapshotDate();
      const result = runImport(raw, {
        scope: "academique",
        academie,
        degre: degre as "1D" | "2D",
        filename: req.file.originalname,
        importedBy: req.user!.id,
        snapshotDate,
      });
      const crossDegreDuplicates = findCrossDegreDuplicates(academie);
      res.status(201).json({ ...result, ...(crossDegreDuplicates.length > 0 ? { crossDegreDuplicates } : {}) });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  }
);

interface AcademieZipFileResult {
  filename: string;
  academie: string;
  degre: "1D" | "2D";
  rowCount: number;
  votants: number;
}

interface AcademieZipFileError {
  filename: string;
  error: string;
}

/**
 * Import académique en masse (admin général uniquement) : un seul fichier
 * zip contenant un fichier Excel d'émargement par (académie, degré), nommé
 * "<Académie>__<Degré>.xlsx" — double underscore choisi pour ne jamais
 * tronquer un nom d'académie contenant un espace, un trait d'union ou une
 * apostrophe (ex. "Côte d'Azur", "Orléans-Tours"), aucune académie n'ayant
 * "__" dans son nom. Chaque feuille est convertie en lignes dont les
 * en-têtes reprennent EXACTEMENT les noms de champs du format JSON
 * "électeurs" (nomUsage/nomFamille/prenom/nomCol/nomEtab/codePostal/
 * dateEmargement/referenceBulletin) déjà reconnu par parseEmargementsJson
 * (voir parsers/emargements.ts) — aucune conversion de champ nécessaire, le
 * même pipeline que l'import académique fichier par fichier (runImport,
 * scope "academique", academie/degre forcés d'après le nom de fichier) est
 * réutilisé tel quel, un appel par fichier du zip. Un fichier en erreur
 * (nom inattendu, académie/degré invalide, contenu illisible) n'interrompt
 * pas l'import des autres : chaque échec est collecté dans `errors` plutôt
 * que de faire échouer tout le lot.
 */
router.post("/academique-zip", requireRole("admin_general"), upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Fichier zip requis." });
    return;
  }

  let directory: unzipper.CentralDirectory;
  try {
    directory = await unzipper.Open.buffer(req.file.buffer);
  } catch {
    res.status(400).json({ error: "Fichier zip invalide ou corrompu." });
    return;
  }

  const academiesConnues = new Set(
    (db.prepare("SELECT academie FROM ref_academie_scrutins").all() as { academie: string }[]).map((r) => r.academie)
  );
  const snapshotDate = (req.body?.snapshotDate as string) || defaultSnapshotDate();

  const results: AcademieZipFileResult[] = [];
  const errors: AcademieZipFileError[] = [];

  for (const entry of directory.files) {
    if (entry.type !== "File" || !entry.path.toLowerCase().endsWith(".xlsx")) continue;

    const base = entry.path.replace(/^.*\//, "").replace(/\.xlsx$/i, "");
    const sepIndex = base.lastIndexOf("__");
    if (sepIndex === -1) {
      errors.push({ filename: entry.path, error: 'Nom de fichier inattendu (attendu : "<Académie>__<Degré>.xlsx").' });
      continue;
    }
    const academie = base.slice(0, sepIndex);
    const degre = base.slice(sepIndex + 2);
    if (degre !== "1D" && degre !== "2D") {
      errors.push({ filename: entry.path, error: `Degré "${degre}" invalide (attendu "1D" ou "2D").` });
      continue;
    }
    if (!academiesConnues.has(academie)) {
      errors.push({ filename: entry.path, error: `Académie "${academie}" inconnue du référentiel.` });
      continue;
    }

    try {
      const buffer = await entry.buffer();
      const workbook = await loadWorkbook(buffer);
      const sheet = workbook.worksheets[0];
      if (!sheet) {
        errors.push({ filename: entry.path, error: "Fichier Excel sans feuille." });
        continue;
      }
      const raw = { items: rowsAsObjects(sheet) };
      const items = parseEmargementsJson(raw);

      const detectedAcademie = detectAcademieMismatch(items, academie);
      if (detectedAcademie) {
        errors.push({
          filename: entry.path,
          error: `Ce fichier semble correspondre à l'académie de ${detectedAcademie} (d'après le code postal du premier électeur), pas à ${academie}.`,
        });
        continue;
      }
      const detectedDegre = detectDegreMismatch(items, degre);
      if (detectedDegre) {
        errors.push({
          filename: entry.path,
          error: `Ce fichier semble correspondre au ${detectedDegre}, pas au ${
            degre === "1D" ? "1er degré" : "2nd degré"
          } attendu.`,
        });
        continue;
      }

      const result = runImport(raw, {
        scope: "academique",
        academie,
        degre,
        filename: entry.path,
        importedBy: req.user!.id,
        snapshotDate,
      });
      results.push({ filename: entry.path, academie, degre, rowCount: result.rowCount, votants: result.votants });
    } catch (err) {
      errors.push({ filename: entry.path, error: (err as Error).message });
    }
  }

  if (results.length === 0) {
    res.status(400).json({
      error:
        errors.length > 0
          ? `Aucun fichier importé. ${errors.map((e) => `${e.filename} : ${e.error}`).join(" ; ")}`
          : "Aucun fichier .xlsx trouvé dans le zip.",
      filesImported: 0,
      filesFailed: errors.length,
      totalRowCount: 0,
      totalVotants: 0,
      results,
      errors,
    });
    return;
  }

  res.status(201).json({
    filesImported: results.length,
    filesFailed: errors.length,
    totalRowCount: results.reduce((sum, r) => sum + r.rowCount, 0),
    totalVotants: results.reduce((sum, r) => sum + r.votants, 0),
    results,
    errors,
  });
});

/**
 * Solution provisoire en attendant l'ouverture des vrais portails
 * académiques (décembre) : reconstruit les électeurs académiques (1D/2D,
 * toutes académies) à partir du fichier national CCMMEP déjà importé.
 * Remplace entièrement le jeu précédent.
 */
router.post("/electeurs-academiques", requireRole("admin_general"), (req, res) => {
  try {
    const result = buildElecteursAcademiques(req.user!.id);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.delete("/electeurs-academiques", requireRole("admin_general"), (_req, res) => {
  const result = deleteElecteursAcademiques();
  res.json(result);
});

interface ImportOwnerRow {
  scope: "national" | "academique";
  academie: string | null;
}

/**
 * Supprime un import et, par cascade, tous ses émargements. Un admin
 * académique ne peut supprimer que ses propres imports académiques ; le
 * scrutin national CCMMEP reste réservé à l'admin général.
 */
router.delete("/:id", requireRole("admin_academique", "admin_general"), (req, res) => {
  const importRow = db
    .prepare("SELECT scope, academie FROM imports WHERE id = ?")
    .get(req.params.id) as ImportOwnerRow | undefined;
  if (!importRow) {
    res.status(404).json({ error: "Import introuvable." });
    return;
  }
  const user = req.user!;
  const allowed =
    user.role === "admin_general" ||
    (user.role === "admin_academique" && importRow.scope === "academique" && canAccessAcademie(user, importRow.academie ?? ""));
  if (!allowed) {
    res.status(403).json({ error: "Vous ne pouvez supprimer que les imports de votre académie." });
    return;
  }
  db.prepare("DELETE FROM imports WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

/**
 * Date/heure du dernier import académique (1er et 2nd degré), pour chaque
 * académie du référentiel (voir ref_academie_scrutins) — y compris celles
 * sans aucun import encore (imported1D/imported2D à null), pour que la carte
 * "Horodatage des imports" de l'admin général liste toutes les académies et
 * pas seulement celles déjà importées.
 */
router.get("/last-by-academie", requireRole("admin_general"), (_req, res) => {
  const rows = db
    .prepare(
      `SELECT
         a.academie,
         (SELECT MAX(i.imported_at) FROM imports i WHERE i.scope = 'academique' AND i.academie = a.academie AND i.degre = '1D') AS imported1D,
         (SELECT MAX(i.imported_at) FROM imports i WHERE i.scope = 'academique' AND i.academie = a.academie AND i.degre = '2D') AS imported2D
       FROM ref_academie_scrutins a
       ORDER BY a.academie`
    )
    .all();
  res.json({ academies: rows });
});

const VOTANTS_SUBQUERY = `(SELECT SUM(e.votant) FROM emargements e WHERE e.import_id = i.id) AS votants`;

router.get("/", (req, res) => {
  const user = req.user!;
  let rows;
  if (user.role === "admin_general") {
    rows = db.prepare(`SELECT i.*, ${VOTANTS_SUBQUERY} FROM imports i ORDER BY i.imported_at DESC LIMIT 200`).all();
  } else if (user.role === "admin_academique") {
    rows = db
      .prepare(
        `SELECT i.*, ${VOTANTS_SUBQUERY} FROM imports i
         WHERE (i.scope = 'academique' AND i.academie = ?) OR i.scope = 'national'
         ORDER BY i.imported_at DESC LIMIT 200`
      )
      .all(user.academie);
  } else {
    rows = db
      .prepare(`SELECT i.*, ${VOTANTS_SUBQUERY} FROM imports i WHERE i.scope = 'national' ORDER BY i.imported_at DESC LIMIT 200`)
      .all();
  }
  res.json({ imports: rows });
});

export default router;
