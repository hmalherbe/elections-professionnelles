import { useEffect, useRef, useState } from "react";
import { Card } from "./Card";
import { api, qs } from "../lib/api";

interface DocumentRecord {
  id: number;
  original_name: string;
  mime_type: string | null;
  size_bytes: number;
  uploaded_at: string;
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

/** Dépôt et consultation de documents (tout type de fichier), pour un académique ou un Spelc — exactement l'un des deux props est fourni. */
export function DocumentsPanel({ academie, spelc }: { academie?: string; spelc?: string }) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filesInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [outcomes, setOutcomes] = useState<UploadOutcome[] | null>(null);

  useEffect(() => {
    // webkitdirectory n'est pas un attribut HTML standard (donc pas typé par React) :
    // on le pose à la main sur l'input dédié à la sélection d'un dossier entier.
    folderInputRef.current?.setAttribute("webkitdirectory", "");
    folderInputRef.current?.setAttribute("directory", "");
  }, []);

  function refresh() {
    api.get<{ documents: DocumentRecord[] }>(`/documents${qs({ academie, spelc })}`).then((r) => {
      setDocuments(r.documents);
      const stillPresent = new Set(r.documents.map((d) => d.id));
      setSelectedIds((prev) => new Set([...prev].filter((id) => stillPresent.has(id))));
    });
  }
  useEffect(refresh, [academie, spelc]);

  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => (prev.size === documents.length ? new Set() : new Set(documents.map((d) => d.id))));
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
        if (academie) fd.append("academie", academie);
        if (spelc) fd.append("spelc", spelc);
        await api.upload("/documents", fd);
        results.push({ name: file.name, ok: true, message: "ajouté." });
      } catch (err) {
        results.push({ name: file.name, ok: false, message: (err as Error).message });
      }
    }
    setProgress(null);
    setUploading(false);
    setOutcomes(results);
    refresh();
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
    refresh();
    if (failures.length > 0) {
      setError(`Certains documents n'ont pas pu être supprimés :\n${failures.join("\n")}`);
    }
  }

  return (
    <div className="space-y-4">
      <Card
        title="Ajouter des documents"
        subtitle="Tout type de fichier (PDF, Word, Excel, image...), visible et téléchargeable par les administrateurs ayant accès à ce périmètre. Sélectionnez un ou plusieurs fichiers, ou un dossier entier — tout son contenu sera importé."
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
      <Card title="Documents" subtitle={`${documents.length} document(s)`}>
        {selectedIds.size > 0 && (
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
              <th className="w-8 py-2 pr-2">
                <input
                  type="checkbox"
                  checked={documents.length > 0 && selectedIds.size === documents.length}
                  disabled={documents.length === 0 || bulkDeleting}
                  onChange={toggleSelectAll}
                  aria-label="Tout sélectionner"
                />
              </th>
              <th className="py-2 pr-4">Nom</th>
              <th className="px-4 py-2">Taille</th>
              <th className="px-4 py-2">Ajouté le</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.id} className="border-b border-slate-100">
                <td className="py-1.5 pr-2">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(doc.id)}
                    disabled={bulkDeleting}
                    onChange={() => toggleSelected(doc.id)}
                    aria-label={`Sélectionner ${doc.original_name}`}
                  />
                </td>
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
        {documents.length === 0 && <p className="py-4 text-sm text-slate-400">Aucun document pour l'instant.</p>}
        {error && <p className="mt-2 whitespace-pre-line text-sm text-red-600">{error}</p>}
      </Card>
    </div>
  );
}
