import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import multer from "multer";
import path from "node:path";
import { ZipArchive } from "archiver";
import * as unzipper from "unzipper";
import { db } from "../db/index.js";
import { requireAuth, requireRole, canAccessAcademie, canAccessSpelc, type AuthUser } from "../middleware/auth.js";
import { saveDocumentUpload, deleteDocumentFile, DOCUMENTS_DIR } from "../lib/documentStorage.js";

const router = Router();

// Les zips déposés peuvent atteindre plusieurs Go (ex. beaucoup de documents
// scannés) : on les écrit directement sur disque au fil de la réception
// (diskStorage), jamais en mémoire (memoryStorage aurait tenté de charger tout
// le fichier dans le tas Node — risque réel d'OOM sur les 2 Go de RAM de
// l'instance Scaleway DEV1-S en production). Répertoire temporaire dans le
// même volume que les documents (backend_data), nettoyé après chaque import.
const TMP_ZIP_DIR = path.resolve(DOCUMENTS_DIR, "../tmp-zip");
const uploadZip = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(TMP_ZIP_DIR, { recursive: true });
      cb(null, TMP_ZIP_DIR);
    },
    filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.zip`),
  }),
  limits: { fileSize: 4 * 1024 * 1024 * 1024 }, // 4 Go
});
router.use(requireAuth);

function spelcAcademie(spelc: string): string | null {
  const row = db.prepare("SELECT academie FROM ref_spelc WHERE spelc = ?").get(spelc) as { academie: string } | undefined;
  return row?.academie ?? null;
}

interface FolderRow {
  id: number;
  scope: "academique" | "spelc" | "general";
  academie: string | null;
  spelc: string | null;
  parent_id: number | null;
  name: string;
  created_at: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} Go`;
}

/** Liste d'académies destinataires, envoyée par le client en JSON (ex. '["Lyon","Paris"]'). */
function parseAcademiesParam(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((a): a is string => typeof a === "string" && a.trim() !== "") : [];
  } catch {
    return [];
  }
}

function assertScopeAccess(
  user: AuthUser,
  academie: string | undefined,
  spelc: string | undefined,
  general: boolean,
  res: Response
): boolean {
  // Arborescence commune : lecture ouverte à tout rôle authentifié (déjà filtré par
  // requireRole sur chaque route), écriture déjà restreinte à admin_general par les
  // routes elles-mêmes — aucune notion de périmètre à vérifier ici pour ce cas.
  if (general) return true;
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
  res.status(400).json({ error: "Paramètre academie, spelc ou general requis." });
  return false;
}

/** Résout tout l'arbre de dossiers d'un périmètre en un coup, réutilisé par le
 * listing, l'export zip et l'import zip (qui doit vérifier/compléter l'arbre). */
function loadFolderTree(scope: "academique" | "spelc" | "general", scopeValue: string | null): FolderRow[] {
  if (scope === "general") {
    return db
      .prepare(`SELECT id, scope, academie, spelc, parent_id, name, created_at FROM document_folders WHERE scope = 'general' ORDER BY name COLLATE NOCASE`)
      .all() as FolderRow[];
  }
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
  const general = req.query.general === "true";
  if (!assertScopeAccess(req.user!, academie, spelc, general, res)) return;
  const folders = general
    ? loadFolderTree("general", null)
    : academie
      ? loadFolderTree("academique", academie)
      : loadFolderTree("spelc", spelc!);
  res.json({ folders });
});

router.post("/folders", requireRole("admin_general"), (req, res) => {
  const academie = req.body?.academie as string | undefined;
  const spelc = req.body?.spelc as string | undefined;
  const general = req.body?.general === true || req.body?.general === "true";
  if (!assertScopeAccess(req.user!, academie, spelc, general, res)) return;

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

  const scope: "academique" | "spelc" | "general" = general ? "general" : academie ? "academique" : "spelc";
  if (parentId !== null) {
    const parent = db.prepare("SELECT id, scope, academie, spelc FROM document_folders WHERE id = ?").get(parentId) as
      | FolderRow
      | undefined;
    const sameScope =
      parent && parent.scope === scope && (general ? true : academie ? parent.academie === academie : parent.spelc === spelc);
    if (!sameScope) {
      res.status(400).json({ error: "Dossier parent invalide pour ce périmètre." });
      return;
    }
  }

  const info = db
    .prepare(
      `INSERT INTO document_folders (scope, academie, spelc, parent_id, name, created_by) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(scope, general ? null : (academie ?? null), general ? null : (spelc ?? null), parentId, name, req.user!.id);
  res.status(201).json({ id: info.lastInsertRowid, name, parent_id: parentId });
});

router.delete("/folders/:id", requireRole("admin_general"), (req, res) => {
  const folder = db.prepare("SELECT id, scope, academie, spelc, parent_id, name, created_at FROM document_folders WHERE id = ?").get(req.params.id) as
    | FolderRow
    | undefined;
  if (!folder) {
    res.status(404).json({ error: "Dossier introuvable." });
    return;
  }
  const allowed =
    folder.scope === "general"
      ? true // déjà restreint à admin_general par requireRole sur cette route
      : folder.scope === "academique"
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
  const general = req.query.general === "true";
  if (!assertScopeAccess(req.user!, academie, spelc, general, res)) return;

  const scope: "academique" | "spelc" | "general" = general ? "general" : academie ? "academique" : "spelc";
  const scopeValue = general ? "generaux" : (academie ?? spelc)!;
  const folders = loadFolderTree(scope, general ? null : scopeValue);
  const byId = new Map(folders.map((f) => [f.id, f]));

  const documents = general
    ? (db.prepare(`SELECT filename, original_name, folder_id FROM documents WHERE scope = 'general'`).all() as {
        filename: string;
        original_name: string;
        folder_id: number | null;
      }[])
    : (db
        .prepare(
          `SELECT filename, original_name, folder_id FROM documents WHERE scope = ? AND ${scope === "academique" ? "academie" : "spelc"} = ?`
        )
        .all(scope, scopeValue) as { filename: string; original_name: string; folder_id: number | null }[]);

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
  requireRole("admin_general"),
  uploadZip.single("file"),
  async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "Fichier zip requis." });
      return;
    }

    const general = req.body?.general === true || req.body?.general === "true";
    const academiesRaw = parseAcademiesParam(req.body?.academies);
    const singleAcademie = typeof req.body?.academie === "string" ? req.body.academie : undefined;
    const academies = academiesRaw.length > 0 ? academiesRaw : singleAcademie ? [singleAcademie] : [];
    const spelc = req.body?.spelc as string | undefined;

    if (!general && academies.length === 0 && !spelc) {
      fs.unlink(req.file.path, () => {});
      res.status(400).json({ error: "Paramètre academie(s), spelc ou general requis." });
      return;
    }
    if (!general) {
      for (const a of academies) {
        if (!canAccessAcademie(req.user!, a)) {
          fs.unlink(req.file.path, () => {});
          res.status(403).json({ error: `Accès non autorisé à l'académie ${a}.` });
          return;
        }
      }
      if (academies.length === 0 && spelc && !canAccessSpelc(req.user!, spelcAcademie(spelc), spelc)) {
        fs.unlink(req.file.path, () => {});
        res.status(403).json({ error: "Accès non autorisé à ce Spelc." });
        return;
      }
    }

    // "general" : une seule cible fictive → processZipImport n'écrit alors
    // qu'une copie physique unique (scope='general', ni académie ni Spelc),
    // jamais dupliquée — c'est tout l'intérêt par rapport à academies (une
    // copie complète par académie ciblée).
    const scope: "academique" | "spelc" | "general" = general ? "general" : academies.length > 0 ? "academique" : "spelc";
    const targets = general ? ["general"] : academies.length > 0 ? academies : [spelc!];

    let directory: unzipper.CentralDirectory;
    try {
      directory = await unzipper.Open.file(req.file.path);
    } catch {
      fs.unlink(req.file.path, () => {});
      res.status(400).json({ error: "Fichier zip invalide ou corrompu." });
      return;
    }

    // Estimation de l'espace disque nécessaire AVANT d'écrire quoi que ce soit :
    // une copie physique indépendante par cible (arborescences non partagées,
    // voir processZipImport), donc la taille décompressée de l'archive
    // multipliée par le nombre de cibles. Vérifiée contre l'espace libre du
    // volume où sont stockés les documents, avec une marge de sécurité — un
    // refus clair et immédiat vaut mieux qu'un import qui échoue fichier par
    // fichier après avoir rempli le disque (ENOSPC rencontré en pratique).
    const totalUncompressedBytes = directory.files
      .filter((f) => f.type !== "Directory")
      .reduce((sum, f) => sum + f.uncompressedSize, 0);
    const estimatedNeeded = totalUncompressedBytes * targets.length;
    try {
      // TMP_ZIP_DIR plutôt que DOCUMENTS_DIR : multer vient de le créer (voir
      // uploadZip.destination plus haut), donc toujours présent à cet instant —
      // contrairement à DOCUMENTS_DIR, qui n'existe pas tant qu'aucun document
      // n'a jamais été déposé (créé à la demande par saveDocumentUpload), ce qui
      // ferait échouer statfsSync (ENOENT) sur une installation neuve. Les deux
      // dossiers sont sur le même volume (TMP_ZIP_DIR est un frère de DOCUMENTS_DIR).
      const stats = fs.statfsSync(TMP_ZIP_DIR);
      const freeBytes = stats.bavail * stats.bsize;
      const SAFETY_MARGIN = 1.1;
      if (estimatedNeeded * SAFETY_MARGIN > freeBytes) {
        fs.unlink(req.file.path, () => {});
        const destination = general ? "vers l'arborescence commune" : `vers ${targets.length} académie(s)`;
        res.status(400).json({
          error:
            `Espace disque insuffisant : cette archive (${formatSize(totalUncompressedBytes)}) ${destination} nécessite environ ${formatSize(estimatedNeeded)}` +
            (targets.length > 1 ? " (une copie complète par académie)" : "") +
            ", mais seulement " +
            `${formatSize(freeBytes)} sont disponibles sur le serveur.` +
            (general
              ? " Libérez de l'espace disque avant de réessayer."
              : " Ciblez moins d'académies ou libérez de l'espace disque avant de réessayer."),
        });
        return;
      }
    } catch (err) {
      // Ne bloque pas l'import si la vérification elle-même échoue (ex. plateforme sans statfs).
      console.error("Impossible de vérifier l'espace disque disponible avant l'import zip :", err);
    }

    try {
      await processZipImport(req, res, directory, scope, targets);
    } finally {
      fs.unlink(req.file.path, () => {});
    }
  }
);

/** Traite l'archive déjà écrite sur disque par uploadZip (voir plus haut) —
 * séparé de la route pour garantir le nettoyage du fichier temporaire via un
 * try/finally quel que soit le chemin de sortie (succès, zip invalide, erreur).
 * Chaque cible (académie ou Spelc) a sa propre arborescence indépendante :
 * chaque entrée du zip n'est décompressée qu'une fois (entry.buffer()), puis
 * réécrite sur disque une fois par cible, pour ne pas multiplier le temps de
 * décompression par le nombre de cibles. */
async function processZipImport(
  req: Request,
  res: Response,
  directory: unzipper.CentralDirectory,
  scope: "academique" | "spelc" | "general",
  targets: string[]
): Promise<void> {
    // Mémorise, par cible et pour la durée de cet import, l'id du dossier déjà
    // créé pour chaque chemin rencontré — toujours à la racine de l'arborescence
    // de chaque cible, comme demandé, jamais dans le dossier actuellement
    // affiché côté client.
    const folderIdByPathPerTarget = new Map<string, Map<string, number | null>>(
      targets.map((t) => [t, new Map<string, number | null>([["", null]])])
    );

    function ensureFolderPath(target: string, segments: string[]): number | null {
      const folderIdByPath = folderIdByPathPerTarget.get(target)!;
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
          .run(scope, scope === "academique" ? target : null, scope === "spelc" ? target : null, parentId, segment, req.user!.id);
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
        for (const target of targets) {
          const before = folderIdByPathPerTarget.get(target)!.size;
          ensureFolderPath(target, segments);
          foldersCreated += folderIdByPathPerTarget.get(target)!.size - before;
        }
        continue;
      }

      const folderSegments = segments.slice(0, -1);
      const fileName = segments[segments.length - 1];
      if (!fileName) continue;

      let buffer: Buffer;
      try {
        buffer = await entry.buffer();
      } catch (err) {
        console.error(`Import zip : échec sur "${cleanPath}" :`, err);
        skipped.push(`${cleanPath} : ${(err as Error).message}`);
        continue;
      }

      for (const target of targets) {
        const before = folderIdByPathPerTarget.get(target)!.size;
        const folderId = ensureFolderPath(target, folderSegments);
        foldersCreated += folderIdByPathPerTarget.get(target)!.size - before;

        try {
          const storedFilename = saveDocumentUpload(buffer, fileName);
          // Extraction de texte volontairement différée (extraction_status NULL) plutôt que
          // faite ici pour chaque fichier : sur un zip de plusieurs centaines/milliers de
          // documents, l'extraction PDF/DOCX synchrone de chacun peut prendre plusieurs
          // minutes et n'a d'intérêt que pour les documents effectivement consultés par
          // l'Assistant IA — lire_document l'exécute alors à la demande et met la base à
          // jour (voir services/chatTools.ts), exactement comme pour un document déposé
          // avant l'ajout de cette colonne.
          db.prepare(
            `INSERT INTO documents (scope, academie, spelc, folder_id, filename, original_name, mime_type, size_bytes, uploaded_by, extracted_text, extraction_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
          ).run(
            scope,
            scope === "academique" ? target : null,
            scope === "spelc" ? target : null,
            folderId,
            storedFilename,
            fileName,
            null,
            buffer.length,
            req.user!.id
          );
          filesImported++;
        } catch (err) {
          const label = targets.length > 1 ? `${cleanPath} (${target})` : cleanPath;
          console.error(`Import zip : échec sur "${label}" :`, err);
          skipped.push(`${label} : ${(err as Error).message}`);
        }
      }
    }

    res.status(201).json({ foldersCreated, filesImported, skipped });
}

export default router;
