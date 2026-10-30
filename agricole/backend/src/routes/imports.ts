import { Router } from "express";
import multer from "multer";
import { db } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { runImport, defaultSnapshotDate } from "../services/imports.js";
import { isScrutinCode } from "../lib/scrutins.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });

router.use(requireAuth);

/** Import quotidien du fichier JSON des émargements d'un des 2 scrutins nationaux agricoles. */
router.post("/:scrutin", upload.single("file"), (req, res) => {
  const scrutin = req.params.scrutin;
  if (!isScrutinCode(scrutin)) {
    res.status(400).json({ error: "Scrutin invalide (attendu : scrutin1 ou scrutin2)." });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "Fichier JSON requis." });
    return;
  }
  try {
    const raw = JSON.parse(req.file.buffer.toString("utf-8"));
    const snapshotDate = (req.body?.snapshotDate as string) || defaultSnapshotDate();
    const result = runImport(raw, {
      scrutin,
      filename: req.file.originalname,
      importedBy: req.user!.id,
      snapshotDate,
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

interface ImportRow {
  id: number;
  scrutin: string;
  filename: string | null;
  imported_at: string;
  snapshot_date: string;
  row_count: number;
}

router.get("/", (_req, res) => {
  const rows = db.prepare("SELECT * FROM imports ORDER BY imported_at DESC").all() as ImportRow[];
  res.json({ imports: rows });
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM imports WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

export default router;
