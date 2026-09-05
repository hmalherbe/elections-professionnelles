import { useRef, useState, type ReactNode } from "react";
import { Card } from "./Card";

interface Props {
  title: string;
  subtitle?: string;
  /** Colonnes attendues, dans l'ordre, affichées sous forme de repère rapide. */
  expectedColumns?: string[];
  accept: string;
  extraFields?: ReactNode;
  onUpload: (file: File) => Promise<string>;
}

export function FileUploadCard({ title, subtitle, expectedColumns, accept, extraFields, onUpload }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<{ type: "ok" | "error"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    setBusy(true);
    setStatus(null);
    try {
      const message = await onUpload(file);
      setStatus({ type: "ok", message });
    } catch (err) {
      setStatus({ type: "error", message: (err as Error).message });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <Card title={title} subtitle={subtitle}>
      <div className="space-y-2">
        {expectedColumns && (
          <div className="rounded-md bg-slate-50 px-2.5 py-2 text-xs text-slate-500">
            <span className="font-medium text-slate-600">Colonnes attendues, dans l'ordre : </span>
            {expectedColumns.map((col, i) => (
              <span key={col}>
                {i > 0 && <span className="text-slate-300"> · </span>}
                <code className="rounded bg-slate-200 px-1 py-0.5 text-slate-700">{col}</code>
              </span>
            ))}
          </div>
        )}
        {extraFields}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
          className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-emerald-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-emerald-700"
        />
        {busy && <p className="text-xs text-slate-400">Import en cours…</p>}
        {status && (
          <p
            className={`whitespace-pre-line text-xs ${status.type === "ok" ? "text-emerald-600" : "text-red-600"}`}
          >
            {status.message}
          </p>
        )}
      </div>
    </Card>
  );
}
