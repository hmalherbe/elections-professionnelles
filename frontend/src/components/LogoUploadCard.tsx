import { useEffect, useState, type ChangeEvent } from "react";
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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => setPreview(currentLogo), [currentLogo]);

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMessage(null);
    if (file.size > MAX_LOGO_BYTES) {
      setMessage(`Fichier trop volumineux (max ${Math.round(MAX_LOGO_BYTES / 1024)} Ko).`);
      return;
    }
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
      <input type="file" accept="image/*" onChange={handleFile} className="block text-sm text-slate-600" />
      {preview && (
        <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2">
          <img src={preview} alt="Aperçu du logo" className="max-h-16" />
        </div>
      )}
      <button
        onClick={save}
        disabled={busy || !preview}
        className="mt-2 rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-60"
      >
        {busy ? "Enregistrement…" : "Enregistrer le logo"}
      </button>
      {message && <p className="mt-1 text-xs text-slate-600">{message}</p>}
    </Card>
  );
}
