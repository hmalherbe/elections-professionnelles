import { useEffect, useState } from "react";
import { Card } from "./Card";
import { FileUploadCard } from "./FileUploadCard";
import { api, qs } from "../lib/api";

interface DocumentRecord {
  id: number;
  original_name: string;
  mime_type: string | null;
  size_bytes: number;
  uploaded_at: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

/** Dépôt et consultation de documents (tout type de fichier), pour un académique ou un Spelc — exactement l'un des deux props est fourni. */
export function DocumentsPanel({ academie, spelc }: { academie?: string; spelc?: string }) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    api.get<{ documents: DocumentRecord[] }>(`/documents${qs({ academie, spelc })}`).then((r) => setDocuments(r.documents));
  }
  useEffect(refresh, [academie, spelc]);

  async function handleDownload(doc: DocumentRecord) {
    setError(null);
    try {
      await api.download(`/documents/${doc.id}/download`, doc.original_name);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Supprimer ce document ? Cette action est irréversible.")) return;
    setBusyId(id);
    try {
      await api.delete(`/documents/${id}`);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <FileUploadCard
        title="Ajouter un document"
        subtitle="Tout type de fichier (PDF, Word, Excel, image...), visible et téléchargeable par les administrateurs ayant accès à ce périmètre."
        accept=""
        onUpload={async (file) => {
          const fd = new FormData();
          fd.append("file", file);
          if (academie) fd.append("academie", academie);
          if (spelc) fd.append("spelc", spelc);
          await api.upload("/documents", fd);
          refresh();
          return `« ${file.name} » ajouté.`;
        }}
      />
      <Card title="Documents" subtitle={`${documents.length} document(s)`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
              <th className="py-2 pr-4">Nom</th>
              <th className="px-4 py-2">Taille</th>
              <th className="px-4 py-2">Ajouté le</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.id} className="border-b border-slate-100">
                <td className="py-1.5 pr-4">
                  <button type="button" onClick={() => handleDownload(doc)} className="text-left text-emerald-700 hover:underline">
                    {doc.original_name}
                  </button>
                </td>
                <td className="px-4 py-1.5 text-slate-500">{formatSize(doc.size_bytes)}</td>
                <td className="px-4 py-1.5 text-slate-500">{new Date(doc.uploaded_at).toLocaleString("fr-FR")}</td>
                <td className="px-4 py-1.5 text-right">
                  <button
                    type="button"
                    disabled={busyId === doc.id}
                    className="text-xs text-red-600 hover:underline disabled:opacity-60"
                    onClick={() => handleDelete(doc.id)}
                  >
                    Supprimer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {documents.length === 0 && <p className="py-4 text-sm text-slate-400">Aucun document pour l'instant.</p>}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </Card>
    </div>
  );
}
