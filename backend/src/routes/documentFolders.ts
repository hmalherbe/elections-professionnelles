import { Router, type Request, type Response } from "express";
import multer from "multer";
import path from "node:path";
import { ZipArchive } from "archiver";
import * as unzipper from "unzipper";
import { db } from "../db/index.js";
import { requireAuth, requireRole, canAccessAcademie, canAccessSpelc, type AuthUser } from "../middleware/auth.js";
import { saveDocumentUpload, deleteDocumentFile, DOCUMENTS_DIR } from "../lib/documentStorage.js";
import { extractDocumentText } from "../lib/documentText.js";

const router = Router();
const uploadZip = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
router.use(requireAuth);

function spelcAcademie(spelc: string): string | null {
  const row = db.prepare("SELECT academie FROM ref_spelc WHERE spelc = ?").get(spelc) as { academie: string } | undefined;
  return row?.academie ?? null;
}

interface FolderRow {
  id: number;
  scope: "academique" | "spelc";
  academie: string | null;
  spelc: string | null;
  parent_id: number | null;
  name: string;
  created_at: string;
}

function assertScopeAccess(user: AuthUser, academie: string | undefined, spelc: string | undefined, res: Response): boolean {
  if (academie) {
    if (!canAccessAcademie(user, academie)) {
      res.status(403).json({ error: "Accès non autorisé à cette académie." });
      return false;
    }
    return true;
  }
  if (spelc) {
    if (!canAccessSpelc(user, spelcAcademie(spelc), spelc)) {
      res.status(403).json({ error: "Accès non autorisé à ce Spelc." });
      return false;
    }
    return true;
  }
  res.status(400).json({ error: "Paramètre academie ou spelc requis." });
  return false;
}

/** Résout tout l'arbre de dossiers d'un périmètre en un coup, réutilisé par le
 * listing, l'export zip et l'import zip (qui doit vérifier/compléter l'arbre). */
function loadFolderTree(scope: "academique" | "spelc", scopeValue: string): FolderRow[] {
  const column = scope === "academique" ? "academie" : "spelc";
  return db
    .prepare(`SELECT id, scope, academie, spelc, parent_id, name, created_at FROM document_folders WHERE scope = ? AND ${column} = ? ORDER BY name COLLATE NOCASE`)
    .all(scope, scopeValue) as FolderRow[];
}

function folderPathOf(folderId: number | null, byId: Map<number, FolderRow>): string {
  const parts: string[] = [];
  let current = folderId;
  while (current !== null) {
    const folder = byId.get(current);
    if (!folder) break;
    parts.unshift(folder.name);
    current = folder.parent_id;
  }
  return parts.join("/");
}

/** Descendants d'un dossier, racine incluse, dans un ordre où un enfant
 * apparaît toujours après son parent (utile pour supprimer dans l'ordre
 * inverse et respecter la contrainte de clé étrangère parent_id). */
function collectSubtree(rootId: number): number[] {
  const ids = [rootId];
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = db.prepare("SELECT id FROM document_folders WHERE parent_id = ?").all(current) as { id: number }[];
    for (const child of children) {
      ids.push(child.id);
      queue.push(child.id);
    }
  }
  return ids;
}

router.get("/folders", requireRole("admin_academique", "admin_spelc", "admin_general"), (req, res) => {
  const academie = req.query.academie as string | undefined;
  const spelc = req.query.spelc as string | undefined;
  if (!assertScopeAccess(req.user!, academie, spelc, res)) return;
  const folders = academie ? loadFolderTree("academique", academie) : loadFolderTree("spelc", spelc!);
  res.json({ folders });
});

router.post("/folders", requireRole("admin_academique", "admin_spelc", "admin_general"), (req, res) => {
  const academie = req.body?.academie as string | undefined;
  const spelc = req.body?.spelc as string | undefined;
  if (!assertScopeAccess(req.user!, academie, spelc, res)) return;

  const name = String(req.body?.name ?? "").trim();
  if (!name) {
    res.status(400).json({ error: "Nom de dossier requis." });
    return;
  }
  if (name.length > 120) {
    res.status(400).json({ error: "Nom de dossier trop long (120 caractères maximum)." });
    return;
  }
  const parentIdRaw = req.body?.parent_id;
  const parentId = parentIdRaw === null || parentIdRaw === undefined || parentIdRaw === "" ? null : Number(parentIdRaw);
  if (parentId !== null && !Number.isFinite(parentId)) {
    res.status(400).json({ error: "Dossier parent invalide." });
    return;
  }

  const scope: "academique" | "spelc" = academie ? "academique" : "spelc";
  if (parentId !== null) {
    const parent = db.prepare("SELECT id, scope, academie, spelc FROM document_folders WHERE id = ?").get(parentId) as
      | FolderRow
      | undefined;
    const sameScope = parent && parent.scope === scope && (academie ? parent.academie === academie : parent.spelc === spelc);
    if (!sameScope) {
      res.status(400).json({ error: "Dossier parent invalide pour ce périmètre." });
      return;
    }
  }

  const info = db
    .prepare(
      `INSERT INTO document_folders (scope, academie, spelc, parent_id, name, created_by) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(scope, academie ?? null, spelc ?? null, parentId, name, req.user!.id);
  res.status(201).json({ id: info.lastInsertRowid, name, parent_id: parentId });
});

router.delete("/folders/:id", requireRole("admin_academique", "admin_spelc", "admin_general"), (req, res) => {
  const folder = db.prepare("SELECT id, scope, academie, spelc, parent_id, name, created_at FROM document_folders WHERE id = ?").get(req.params.id) as
    | FolderRow
    | undefined;
  if (!folder) {
    res.status(404).json({ error: "Dossier introuvable." });
    return;
  }
  const allowed =
    folder.scope === "academique"
      ? canAccessAcademie(req.user!, folder.academie!)
      : canAccessSpelc(req.user!, spelcAcademie(folder.spelc!), folder.spelc!);
  if (!allowed) {
    res.status(403).json({ error: "Accès non autorisé à ce dossier." });
    return;
  }

  const subtreeIds = collectSubtree(folder.id);
  const placeholders = subtreeIds.map(() => "?").join(",");
  const files = db.prepare(`SELECT filename FROM documents WHERE folder_id IN (${placeholders})`).all(...subtreeIds) as {
    filename: string;
  }[];
  for (const file of files) deleteDocumentFile(file.filename);
  db.prepare(`DELETE FROM documents WHERE folder_id IN (${placeholders})`).run(...subtreeIds);
  // Suppression enfants → parents pour respecter la contrainte parent_id (NO ACTION).
  for (const id of [...subtreeIds].reverse()) {
    db.prepare("DELETE FROM document_folders WHERE id = ?").run(id);
  }
  res.status(204).end();
});

router.get("/zip", requireRole("admin_academique", "admin_spelc", "admin_general"), async (req, res) => {
  const academie = req.query.academie as string | undefined;
  const spelc = req.query.spelc as string | undefined;
  if (!assertScopeAccess(req.user!, academie, spelc, res)) return;

  const scope: "academique" | "spelc" = academie ? "academique" : "spelc";
  const scopeValue = (academie ?? spelc)!;
  const folders = loadFolderTree(scope, scopeValue);
  const byId = new Map(folders.map((f) => [f.id, f]));

  const column = scope === "academique" ? "academie" : "spelc";
  const documents = db
    .prepare(`SELECT filename, original_name, folder_id FROM documents WHERE scope = ? AND ${column} = ?`)
    .all(scope, scopeValue) as { filename: string; original_name: string; folder_id: number | null }[];

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="documents-${scopeValue}.zip"`);

  const archive = new ZipArchive();
  archive.on("error", (err) => {
    console.error("Échec de la génération du zip de documents:", err);
    res.destroy(err);
  });
  archive.pipe(res);

  // Entrées de dossier explicites : préserve les dossiers vides dans l'archive.
  for (const folder of folders) {
    archive.append(Buffer.alloc(0), { name: `${folderPathOf(folder.id, byId)}/` });
  }
  for (const doc of documents) {
    const entryName = doc.folder_id ? `${folderPathOf(doc.folder_id, byId)}/${doc.original_name}` : doc.original_name;
    archive.file(path.join(DOCUMENTS_DIR, doc.filename), { name: entryName });
  }
  await archive.finalize();
});

router.post(
  "/zip-import",
  requireRole("admin_academique", "admin_spelc", "admin_general"),
  uploadZip.single("file"),
  async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "Fichier zip requis." });
      return;
    }
    const academie = req.body?.academie as string | undefined;
    const spelc = req.body?.spelc as string | undefined;
    if (!assertScopeAccess(req.user!, academie, spelc, res)) return;

    const scope: "academique" | "spelc" = academie ? "academique" : "spelc";
    const scopeValue = (academie ?? spelc)!;

    let directory: unzipper.CentralDirectory;
    try {
      directory = await unzipper.Open.buffer(req.file.buffer);
    } catch {
      res.status(400).json({ error: "Fichier zip invalide ou corrompu." });
      return;
    }

    // Mémorise, pour la durée de cet import, l'id du dossier déjà créé pour
    // chaque chemin rencontré — toujours à la racine de l'arborescence, comme
    // demandé, jamais dans le dossier actuellement affiché côté client.
    const folderIdByPath = new Map<string, number | null>([["", null]]);

    function ensureFolderPath(segments: string[]): number | null {
      let currentPath = "";
      let parentId: number | null = null;
      for (const segment of segments) {
        currentPath = currentPath ? `${currentPath}/${segment}` : segment;
        const cached = folderIdByPath.get(currentPath);
        if (cached !== undefined) {
          parentId = cached;
          continue;
        }
        const info = db
          .prepare(`INSERT INTO document_folders (scope, academie, spelc, parent_id, name, created_by) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(scope, academie ?? null, spelc ?? null, parentId, segment, req.user!.id);
        const newId = Number(info.lastInsertRowid);
        folderIdByPath.set(currentPath, newId);
        parentId = newId;
      }
      return parentId;
    }

    let foldersCreated = 0;
    let filesImported = 0;
    const skipped: string[] = [];

    for (const entry of directory.files) {
      const cleanPath = entry.path.replace(/\/+$/, "");
      if (!cleanPath) continue;
      const segments = cleanPath.split("/").filter(Boolean);

      if (entry.type === "Directory") {
        const before = folderIdByPath.size;
        ensureFolderPath(segments);
        foldersCreated += folderIdByPath.size - before;
        continue;
      }

      const fileName = segments.pop();
      if (!fileName) continue;
      const before = folderIdByPath.size;
      const folderId = ensureFolderPath(segments);
      foldersCreated += folderIdByPath.size - before;

      try {
        const buffer = await entry.buffer();
        const storedFilename = saveDocumentUpload(buffer, fileName);
        const { text, status } = await extractDocumentText(buffer, fileName, null);
        db.prepare(
          `INSERT INTO documents (scope, academie, spelc, folder_id, filename, original_name, mime_type, size_bytes, uploaded_by, extracted_text, extraction_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(scope, academie ?? null, spelc ?? null, folderId, storedFilename, fileName, null, buffer.length, req.user!.id, text, status);
        filesImported++;
      } catch (err) {
        skipped.push(`${cleanPath} : ${(err as Error).message}`);
      }
    }

    res.status(201).json({ foldersCreated, filesImported, skipped });
  }
);

export default router;
