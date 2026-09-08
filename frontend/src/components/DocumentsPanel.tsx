import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "./Card";
import { api, qs } from "../lib/api";

interface DocumentRecord {
  id: number;
  original_name: string;
  mime_type: string | null;
  size_bytes: number;
  uploaded_at: string;
}

interface FolderRecord {
  id: number;
  parent_id: number | null;
  name: string;
  created_at: string;
}

interface UploadOutcome {
  name: string;
  ok: boolean;
  message: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

/** Arbre de dossiers expansible (bouton +/− par dossier ayant des enfants),
 * plutôt qu'une navigation "on entre dans un dossier" : tous les dossiers
 * déjà développés restent visibles pendant qu'on parcourt l'arborescence. */
function FolderTree({
  folders,
  currentFolderId,
  expandedIds,
  readOnly,
  onToggle,
  onSelect,
  onDelete,
}: {
  folders: FolderRecord[];
  currentFolderId: number | null;
  expandedIds: Set<number>;
  readOnly: boolean;
  onToggle: (id: number) => void;
  onSelect: (id: number | null) => void;
  onDelete: (folder: FolderRecord) => void;
}) {
  const childrenByParent = useMemo(() => {
    const map = new Map<number | null, FolderRecord[]>();
    for (const f of folders) {
      const list = map.get(f.parent_id) ?? [];
      list.push(f);
      map.set(f.parent_id, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name, "fr"));
    return map;
  }, [folders]);

  function renderNode(folder: FolderRecord, depth: number) {
    const children = childrenByParent.get(folder.id) ?? [];
    const isExpanded = expandedIds.has(folder.id);
    const isCurrent = currentFolderId === folder.id;
    return (
      <div key={folder.id}>
        <div
          className={`flex items-center justify-between gap-2 rounded py-1 pr-1 ${isCurrent ? "bg-emerald-50" : "hover:bg-slate-50"}`}
          style={{ paddingLeft: `${depth * 18 + 4}px` }}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            {children.length > 0 ? (
              <button
                type="button"
                onClick={() => onToggle(folder.id)}
                className="flex h-4 w-4 flex-none items-center justify-center rounded border border-slate-300 text-xs font-bold leading-none text-slate-500 hover:bg-slate-100"
                aria-label={isExpanded ? `Réduire ${folder.name}` : `Développer ${folder.name}`}
              >
                {isExpanded ? "−" : "+"}
              </button>
            ) : (
              <span className="w-4 flex-none" />
            )}
            <button
              type="button"
              onClick={() => onSelect(folder.id)}
              className={`truncate text-left text-sm ${isCurrent ? "font-semibold text-emerald-800" : "text-slate-700"} hover:underline`}
            >
              📁 {folder.name}
            </button>
          </div>
          {!readOnly && (
            <button type="button" onClick={() => onDelete(folder)} className="flex-none text-xs text-red-600 hover:underline">
              Supprimer
            </button>
          )}
        </div>
        {isExpanded && children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  }

  const rootFolders = childrenByParent.get(null) ?? [];

  return (
    <div className="rounded-md border border-slate-200 py-0.5">
      <div className={`flex items-center gap-2 py-1 pl-1 ${currentFolderId === null ? "bg-emerald-50" : "hover:bg-slate-50"}`}>
        <span className="w-4 flex-none" />
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={`text-left text-sm ${currentFolderId === null ? "font-semibold text-emerald-800" : "text-slate-700"} hover:underline`}
        >
          🗂️ Racine
        </button>
      </div>
      {rootFolders.map((f) => renderNode(f, 1))}
    </div>
  );
}

/** Dépôt, arborescence de dossiers et consultation de documents (tout type de fichier),
 * pour un académique, un Spelc, ou l'arborescence commune ("general") — exactement l'un
 * des trois est fourni. readOnly (vues académique/Spelc) affiche la même arborescence que
 * l'admin général (mêmes lignes en base, pas de copie) sans les actions de dépôt/création/
 * suppression. */
export function DocumentsPanel({
  academie,
  spelc,
  general = false,
  readOnly = false,
}: {
  academie?: string;
  spelc?: string;
  general?: boolean;
  readOnly?: boolean;
}) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filesInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [outcomes, setOutcomes] = useState<UploadOutcome[] | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [exportingZip, setExportingZip] = useState(false);
  const [importingZip, setImportingZip] = useState(false);
  const [importResult, setImportResult] = useState<{ summary: string; skipped: string[] } | null>(null);

  useEffect(() => {
    // webkitdirectory n'est pas un attribut HTML standard (donc pas typé par React) :
    // on le pose à la main sur l'input dédié à la sélection d'un dossier entier.
    folderInputRef.current?.setAttribute("webkitdirectory", "");
    folderInputRef.current?.setAttribute("directory", "");
  }, []);

  function refreshFolders() {
    api
      .get<{ folders: FolderRecord[] }>(`/documents/folders${qs({ academie, spelc, general: general ? "true" : undefined })}`)
      .then((r) => setFolders(r.folders));
  }

  function refreshDocuments() {
    api
      .get<{ documents: DocumentRecord[] }>(
        `/documents${qs({ academie, spelc, general: general ? "true" : undefined, folder_id: currentFolderId?.toString() })}`
      )
      .then((r) => {
        setDocuments(r.documents);
        const stillPresent = new Set(r.documents.map((d) => d.id));
        setSelectedIds((prev) => new Set([...prev].filter((id) => stillPresent.has(id))));
      });
  }

  useEffect(refreshFolders, [academie, spelc, general]);
  useEffect(refreshDocuments, [academie, spelc, general, currentFolderId]);

  function expandPathTo(folderId: number | null) {
    if (folderId === null) return;
    const byId = new Map(folders.map((f) => [f.id, f]));
    setExpandedIds((prev) => {
      const next = new Set(prev);
      let current: number | null = folderId;
      while (current !== null) {
        next.add(current);
        current = byId.get(current)?.parent_id ?? null;
      }
      return next;
    });
  }

  function navigateTo(folderId: number | null) {
    setCurrentFolderId(folderId);
    setSelectedIds(new Set());
    expandPathTo(folderId);
  }

  function toggleExpanded(folderId: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  const currentFolderName = currentFolderId === null ? "Racine" : (folders.find((f) => f.id === currentFolderId)?.name ?? "…");

  const breadcrumb = useMemo(() => {
    const byId = new Map(folders.map((f) => [f.id, f]));
    const trail: FolderRecord[] = [];
    let current = currentFolderId;
    while (current !== null) {
      const folder = byId.get(current);
      if (!folder) break;
      trail.unshift(folder);
      current = folder.parent_id;
    }
    return trail;
  }, [folders, currentFolderId]);

  async function handleCreateFolder() {
    const name = window.prompt("Nom du nouveau dossier :");
    if (!name || !name.trim()) return;
    setCreatingFolder(true);
    setError(null);
    try {
      await api.post("/documents/folders", { academie, spelc, general, parent_id: currentFolderId, name: name.trim() });
      if (currentFolderId !== null) setExpandedIds((prev) => new Set(prev).add(currentFolderId));
      refreshFolders();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreatingFolder(false);
    }
  }

  async function handleDeleteFolder(folder: FolderRecord) {
    if (
      !confirm(
        `Supprimer le dossier « ${folder.name} » ? Tout son contenu (sous-dossiers et documents) sera supprimé définitivement.`
      )
    )
      return;
    setError(null);
    try {
      await api.delete(`/documents/folders/${folder.id}`);
      refreshFolders();
      refreshDocuments();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function uploadFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    setUploading(true);
    setOutcomes(null);
    setError(null);
    const results: UploadOutcome[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setProgress({ done: i, total: files.length });
      try {
        const fd = new FormData();
        fd.append("file", file);
        if (general) {
          fd.append("general", "true");
        } else if (spelc) {
          fd.append("spelc", spelc);
        } else if (academie) {
          fd.append("academie", academie);
        }
        if (currentFolderId !== null) fd.append("folder_id", String(currentFolderId));
        await api.upload("/documents", fd);
        results.push({ name: file.name, ok: true, message: "ajouté." });
      } catch (err) {
        results.push({ name: file.name, ok: false, message: (err as Error).message });
      }
    }
    setProgress(null);
    setUploading(false);
    setOutcomes(results);
    refreshDocuments();
    if (filesInputRef.current) filesInputRef.current.value = "";
    if (folderInputRef.current) folderInputRef.current.value = "";
  }

  async function handleDownload(doc: DocumentRecord) {
    setError(null);
    try {
      await api.download(`/documents/${doc.id}/download`, doc.original_name);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleBulkDelete() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const label = ids.length > 1 ? `ces ${ids.length} documents` : "ce document";
    if (!confirm(`Supprimer ${label} ? Cette action est irréversible.`)) return;
    setBulkDeleting(true);
    setError(null);
    const failures: string[] = [];
    for (const id of ids) {
      const doc = documents.find((d) => d.id === id);
      try {
        await api.delete(`/documents/${id}`);
      } catch (err) {
        failures.push(`${doc?.original_name ?? id} : ${(err as Error).message}`);
      }
    }
    setBulkDeleting(false);
    setSelectedIds(new Set());
    refreshDocuments();
    if (failures.length > 0) {
      setError(`Certains documents n'ont pas pu être supprimés :\n${failures.join("\n")}`);
    }
  }

  async function handleExportZip() {
    setExportingZip(true);
    setError(null);
    try {
      await api.download(
        `/documents/zip${qs({ academie, spelc, general: general ? "true" : undefined })}`,
        `documents-${academie ?? spelc ?? "generaux"}.zip`
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setExportingZip(false);
    }
  }

  async function handleImportZip(file: File | null) {
    if (!file) return;
    setImportingZip(true);
    setImportResult(null);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (general) {
        fd.append("general", "true");
      } else if (spelc) {
        fd.append("spelc", spelc);
      } else if (academie) {
        fd.append("academie", academie);
      }
      const res = await api.upload<{ foldersCreated: number; filesImported: number; skipped: string[] }>(
        "/documents/zip-import",
        fd
      );
      setImportResult({
        summary:
          `${res.filesImported} document(s) et ${res.foldersCreated} dossier(s) importés à la racine.` +
          (res.skipped.length > 0 ? ` ${res.skipped.length} élément(s) ignoré(s) — détail ci-dessous.` : ""),
        skipped: res.skipped,
      });
      navigateTo(null); // le contenu importé est toujours reproduit à la racine.
      refreshFolders();
      refreshDocuments();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImportingZip(false);
      if (zipInputRef.current) zipInputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-4">
      {readOnly && (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Ces dossiers et documents sont déposés par l'administration générale. Vous pouvez les consulter et les
          télécharger ; le dépôt, la création de dossiers et la suppression ne sont pas possibles ici.
        </p>
      )}

      {!readOnly && (
        <Card
          title="Ajouter des documents"
          subtitle="Tout type de fichier (PDF, Word, Excel, image...), visible et téléchargeable par les administrateurs ayant accès à ce périmètre. Sélectionnez un ou plusieurs fichiers, ou un dossier entier — tout son contenu sera importé dans le dossier actuellement ouvert."
        >
          <div className="flex flex-wrap gap-2">
            <label
              className={`cursor-pointer rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 ${uploading ? "pointer-events-none opacity-60" : ""}`}
            >
              Choisir des fichiers
              <input
                ref={filesInputRef}
                type="file"
                multiple
                disabled={uploading}
                className="hidden"
                onChange={(e) => uploadFiles(e.target.files)}
              />
            </label>
            <label
              className={`cursor-pointer rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 ${uploading ? "pointer-events-none opacity-60" : ""}`}
            >
              Choisir un dossier
              <input
                ref={folderInputRef}
                type="file"
                multiple
                disabled={uploading}
                className="hidden"
                onChange={(e) => uploadFiles(e.target.files)}
              />
            </label>
          </div>
          {progress && (
            <p className="mt-2 text-xs text-slate-400">
              Import en cours… {progress.done}/{progress.total}
            </p>
          )}
          {outcomes && (
            <div className="mt-2 space-y-0.5 text-xs">
              <p className={outcomes.every((o) => o.ok) ? "text-emerald-600" : "text-amber-700"}>
                {outcomes.filter((o) => o.ok).length}/{outcomes.length} document(s) ajouté(s).
              </p>
              {outcomes
                .filter((o) => !o.ok)
                .map((o, i) => (
                  <p key={`${o.name}-${i}`} className="text-red-600">
                    {o.name} : {o.message}
                  </p>
                ))}
            </div>
          )}
        </Card>
      )}

      <Card
        title="Archive (.zip)"
        subtitle={
          readOnly
            ? "Télécharge tous les dossiers et documents de ce périmètre en une archive."
            : "Exporte tous les dossiers et documents en une archive, ou importe une archive : sa structure de dossiers et de fichiers est reproduite à la racine de l'arborescence ci-dessous."
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={exportingZip}
            onClick={handleExportZip}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60"
          >
            {exportingZip ? "Préparation…" : "Télécharger une archive zip"}
          </button>
          {!readOnly && (
            <label
              className={`cursor-pointer rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 ${importingZip ? "pointer-events-none opacity-60" : ""}`}
            >
              {importingZip ? "Import en cours…" : "Importer une archive zip"}
              <input
                ref={zipInputRef}
                type="file"
                accept=".zip,application/zip"
                disabled={importingZip}
                className="hidden"
                onChange={(e) => handleImportZip(e.target.files?.[0] ?? null)}
              />
            </label>
          )}
        </div>
        {importResult && (
          <div className="mt-2 space-y-1 text-xs">
            <p className={importResult.skipped.length > 0 ? "text-amber-700" : "text-emerald-600"}>{importResult.summary}</p>
            {importResult.skipped.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-4 text-red-600">
                {importResult.skipped.map((reason, i) => (
                  <li key={i}>{reason}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>

      <Card
        title={readOnly ? "Dossiers (lecture seule)" : "Dossiers"}
        subtitle="Cliquez sur + / − pour développer ou réduire un dossier ; cliquez sur son nom pour l'ouvrir ci-dessous."
      >
        {!readOnly && (
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              disabled={creatingFolder}
              onClick={handleCreateFolder}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60"
            >
              + Nouveau dossier (dans « {currentFolderName} »)
            </button>
          </div>
        )}
        <FolderTree
          folders={folders}
          currentFolderId={currentFolderId}
          expandedIds={expandedIds}
          readOnly={readOnly}
          onToggle={toggleExpanded}
          onSelect={navigateTo}
          onDelete={handleDeleteFolder}
        />
      </Card>

      <Card
        title="Documents"
        subtitle={`${documents.length} document(s) — dossier ouvert : ${breadcrumb.length === 0 ? "Racine" : `Racine / ${breadcrumb.map((f) => f.name).join(" / ")}`}`}
      >
        {!readOnly && selectedIds.size > 0 && (
          <div className="mb-2 flex items-center gap-2">
            <button
              type="button"
              disabled={bulkDeleting}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
              onClick={handleBulkDelete}
            >
              {bulkDeleting ? "Suppression…" : `Supprimer la sélection (${selectedIds.size})`}
            </button>
          </div>
        )}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
              {!readOnly && (
                <th className="w-8 py-2 pr-2">
                  <input
                    type="checkbox"
                    checked={documents.length > 0 && selectedIds.size === documents.length}
                    disabled={documents.length === 0 || bulkDeleting}
                    onChange={() =>
                      setSelectedIds((prev) => (prev.size === documents.length ? new Set() : new Set(documents.map((d) => d.id))))
                    }
                    aria-label="Tout sélectionner"
                  />
                </th>
              )}
              <th className="py-2 pr-4">Nom</th>
              <th className="px-4 py-2">Taille</th>
              <th className="px-4 py-2">Ajouté le</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.id} className="border-b border-slate-100">
                {!readOnly && (
                  <td className="py-1.5 pr-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(doc.id)}
                      disabled={bulkDeleting}
                      onChange={() =>
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(doc.id)) next.delete(doc.id);
                          else next.add(doc.id);
                          return next;
                        })
                      }
                      aria-label={`Sélectionner ${doc.original_name}`}
                    />
                  </td>
                )}
                <td className="py-1.5 pr-4">
                  <button type="button" onClick={() => handleDownload(doc)} className="text-left text-emerald-700 hover:underline">
                    {doc.original_name}
                  </button>
                </td>
                <td className="px-4 py-1.5 text-slate-500">{formatSize(doc.size_bytes)}</td>
                <td className="px-4 py-1.5 text-slate-500">{new Date(doc.uploaded_at).toLocaleString("fr-FR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {documents.length === 0 && <p className="py-4 text-sm text-slate-400">Aucun document dans ce dossier.</p>}
        {error && <p className="mt-2 whitespace-pre-line text-sm text-red-600">{error}</p>}
      </Card>
    </div>
  );
}
