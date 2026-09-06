import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Card } from "./Card";

/** Taille max du logo pour rester raisonnable une fois encodé en base64 dans le corps du mail. */
const MAX_LOGO_BYTES = 500 * 1024;

export function LogoUploadCard({
  title,
  currentLogo,
  onSave,
}: {
  title: string;
  currentLogo: string | null;
  onSave: (dataUri: string) => Promise<void>;
}) {
  const [preview, setPreview] = useState<string | null>(currentLogo);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setPreview(currentLogo), [currentLogo]);

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMessage(null);
    if (file.size > MAX_LOGO_BYTES) {
      setMessage(`Fichier trop volumineux (max ${Math.round(MAX_LOGO_BYTES / 1024)} Ko).`);
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function save() {
    if (!preview) return;
    setBusy(true);
    setMessage(null);
    try {
      await onSave(preview);
      setMessage("Logo enregistré.");
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={title} subtitle="Inséré automatiquement en entête des modèles de mail prégarnis (champ {{logo}}).">
      <p className="mb-1 text-xs font-medium text-slate-500">1. Choisissez une image sur votre ordinateur</p>
      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
        >
          Choisir une image
        </button>
        {fileName && <span className="text-sm text-slate-500">{fileName}</span>}
      </div>
      {preview ? (
        <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2">
          <img src={preview} alt="Aperçu du logo" className="max-h-16" />
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-400">Aucune image sélectionnée pour l'instant.</p>
      )}
      <p className="mb-1 mt-3 text-xs font-medium text-slate-500">2. Enregistrez-la</p>
      <button
        onClick={save}
        disabled={busy || !preview}
        className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-60"
      >
        {busy ? "Enregistrement…" : "Enregistrer le logo"}
      </button>
      {!preview && <p className="mt-1 text-xs text-amber-600">Choisissez d'abord une image ci-dessus.</p>}
      {message && <p className="mt-1 text-xs text-slate-600">{message}</p>}
    </Card>
  );
}
