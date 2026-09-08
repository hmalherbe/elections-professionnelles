import { Router, type Request, type Response } from "express";
import multer from "multer";
import path from "node:path";
import { db } from "../db/index.js";
import { requireAuth, requireRole, canAccessAcademie, canAccessSpelc } from "../middleware/auth.js";
import { saveDocumentUpload, deleteDocumentFile, DOCUMENTS_DIR } from "../lib/documentStorage.js";
import { extractDocumentText } from "../lib/documentText.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
router.use(requireAuth);

function spelcAcademie(spelc: string): string | null {
  const row = db.prepare("SELECT academie FROM ref_spelc WHERE spelc = ?").get(spelc) as { academie: string } | undefined;
  return row?.academie ?? null;
}

// Colonnes exposées sur la surface HTTP : jamais extracted_text, potentiellement
// volumineux (jusqu'à 20 000 caractères) et réservé à l'Assistant IA, qui le lit
// directement en base (voir services/chatTools.ts).
const LIST_COLUMNS =
  "id, scope, academie, spelc, folder_id, filename, original_name, mime_type, size_bytes, uploaded_by, uploaded_at";

interface DocumentRow {
  id: number;
  scope: "academique" | "spelc";
  academie: string | null;
  spelc: string | null;
  folder_id: number | null;
  filename: string;
  original_name: string;
  mime_type: string | null;
  size_bytes: number;
  uploaded_by: number | null;
  uploaded_at: string;
}

/** "" (absent) → racine (folder_id IS NULL) ; sinon l'id du dossier ciblé. */
function parseFolderIdParam(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

router.get("/", requireRole("admin_academique", "admin_spelc", "admin_general"), (req, res) => {
  const academie = req.query.academie as string | undefined;
  const spelc = req.query.spelc as string | undefined;
  const folderId = parseFolderIdParam(req.query.folder_id);
  if (academie) {
    if (!canAccessAcademie(req.user!, academie)) {
      res.status(403).json({ error: "Accès non autorisé à cette académie." });
      return;
    }
    const rows = db
      .prepare(
        `SELECT ${LIST_COLUMNS} FROM documents WHERE scope = 'academique' AND academie = ? AND folder_id IS ? ORDER BY uploaded_at DESC`
      )
      .all(academie, folderId) as DocumentRow[];
    res.json({ documents: rows });
    return;
  }
  if (spelc) {
    if (!canAccessSpelc(req.user!, spelcAcademie(spelc), spelc)) {
      res.status(403).json({ error: "Accès non autorisé à ce Spelc." });
      return;
    }
    const rows = db
      .prepare(
        `SELECT ${LIST_COLUMNS} FROM documents WHERE scope = 'spelc' AND spelc = ? AND folder_id IS ? ORDER BY uploaded_at DESC`
      )
      .all(spelc, folderId) as DocumentRow[];
    res.json({ documents: rows });
    return;
  }
  res.status(400).json({ error: "Paramètre academie ou spelc requis." });
});

router.post("/", requireRole("admin_academique", "admin_spelc", "admin_general"), upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Fichier requis." });
    return;
  }
  const academie = req.body?.academie as string | undefined;
  const spelc = req.body?.spelc as string | undefined;
  const folderId = parseFolderIdParam(req.body?.folder_id);

  if (academie) {
    if (!canAccessAcademie(req.user!, academie)) {
      res.status(403).json({ error: "Vous ne pouvez déposer des documents que pour votre académie." });
      return;
    }
    const filename = saveDocumentUpload(req.file.buffer, req.file.originalname);
    const { text, status } = await extractDocumentText(req.file.buffer, req.file.originalname, req.file.mimetype);
    db.prepare(
      `INSERT INTO documents (scope, academie, folder_id, filename, original_name, mime_type, size_bytes, uploaded_by, extracted_text, extraction_status)
       VALUES ('academique', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(academie, folderId, filename, req.file.originalname, req.file.mimetype, req.file.size, req.user!.id, text, status);
    res.status(201).json({ ok: true });
    return;
  }
  if (spelc) {
    if (!canAccessSpelc(req.user!, spelcAcademie(spelc), spelc)) {
      res.status(403).json({ error: "Vous ne pouvez déposer des documents que pour votre Spelc." });
      return;
    }
    const filename = saveDocumentUpload(req.file.buffer, req.file.originalname);
    const { text, status } = await extractDocumentText(req.file.buffer, req.file.originalname, req.file.mimetype);
    db.prepare(
      `INSERT INTO documents (scope, spelc, folder_id, filename, original_name, mime_type, size_bytes, uploaded_by, extracted_text, extraction_status)
       VALUES ('spelc', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(spelc, folderId, filename, req.file.originalname, req.file.mimetype, req.file.size, req.user!.id, text, status);
    res.status(201).json({ ok: true });
    return;
  }
  res.status(400).json({ error: "Paramètre academie ou spelc requis." });
});

function getDocumentOr404(id: string, res: Response): DocumentRow | null {
  const row = db.prepare(`SELECT ${LIST_COLUMNS} FROM documents WHERE id = ?`).get(id) as DocumentRow | undefined;
  if (!row) {
    res.status(404).json({ error: "Document introuvable." });
    return null;
  }
  return row;
}

function assertDocumentAccess(req: Request, res: Response, row: DocumentRow): boolean {
  const ok =
    row.scope === "academique"
      ? canAccessAcademie(req.user!, row.academie!)
      : canAccessSpelc(req.user!, spelcAcademie(row.spelc!), row.spelc!);
  if (!ok) res.status(403).json({ error: "Accès non autorisé à ce document." });
  return ok;
}

router.get("/:id/download", (req, res) => {
  const row = getDocumentOr404(req.params.id, res);
  if (!row) return;
  if (!assertDocumentAccess(req, res, row)) return;
  res.download(path.join(DOCUMENTS_DIR, row.filename), row.original_name);
});

router.delete("/:id", (req, res) => {
  const row = getDocumentOr404(req.params.id, res);
  if (!row) return;
  if (!assertDocumentAccess(req, res, row)) return;
  deleteDocumentFile(row.filename);
  db.prepare("DELETE FROM documents WHERE id = ?").run(row.id);
  res.status(204).end();
});

export default router;
