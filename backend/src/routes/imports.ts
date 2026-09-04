import { Router } from "express";
import multer from "multer";
import { db } from "../db/index.js";
import { requireAuth, requireRole, canAccessAcademie } from "../middleware/auth.js";
import { runImport, defaultSnapshotDate } from "../services/imports.js";

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
      res.status(201).json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  }
);

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
