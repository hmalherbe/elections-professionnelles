import { Router } from "express";
import multer from "multer";
import { db } from "../db/index.js";
import { requireAuth, requireRole, canAccessAcademie } from "../middleware/auth.js";
import { runImport, defaultSnapshotDate, findCrossDegreDuplicates } from "../services/imports.js";

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

router.get("/", (req, res) => {
  const user = req.user!;
  let rows;
  if (user.role === "admin_general") {
    rows = db.prepare("SELECT * FROM imports ORDER BY imported_at DESC LIMIT 200").all();
  } else if (user.role === "admin_academique") {
    rows = db
      .prepare(
        "SELECT * FROM imports WHERE (scope = 'academique' AND academie = ?) OR scope = 'national' ORDER BY imported_at DESC LIMIT 200"
      )
      .all(user.academie);
  } else {
    rows = db.prepare("SELECT * FROM imports WHERE scope = 'national' ORDER BY imported_at DESC LIMIT 200").all();
  }
  res.json({ imports: rows });
});

export default router;
