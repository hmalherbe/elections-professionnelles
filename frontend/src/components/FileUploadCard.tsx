import { useRef, useState, type ReactNode } from "react";
import { Card } from "./Card";

interface Props {
  title: string;
  subtitle?: string;
  accept: string;
  extraFields?: ReactNode;
  onUpload: (file: File) => Promise<string>;
}

export function FileUploadCard({ title, subtitle, accept, extraFields, onUpload }: Props) {
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
          <p className={`text-xs ${status.type === "ok" ? "text-emerald-600" : "text-red-600"}`}>{status.message}</p>
        )}
      </div>
    </Card>
  );
}
