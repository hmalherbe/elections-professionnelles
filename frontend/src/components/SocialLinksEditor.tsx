import { useEffect, useState } from "react";
import { Card } from "./Card";
import { SOCIAL_NETWORKS, type SocialLinks } from "../lib/socialLinks";

export function SocialLinksEditor({
  value,
  onSave,
}: {
  value: SocialLinks;
  onSave: (links: SocialLinks) => Promise<void>;
}) {
  const [links, setLinks] = useState<SocialLinks>(value);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => setLinks(value), [value]);

  function toggle(key: keyof SocialLinks, enabled: boolean) {
    setLinks({ ...links, [key]: { enabled, url: links[key]?.url ?? "" } });
  }

  function setUrl(key: keyof SocialLinks, url: string) {
    setLinks({ ...links, [key]: { enabled: links[key]?.enabled ?? true, url } });
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      await onSave(links);
      setMessage("Réseaux sociaux enregistrés.");
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Réseaux sociaux"
      subtitle="Insérés en pied de page des modèles de mail prégarnis (champ {{reseaux_sociaux}})."
    >
      <div className="space-y-2">
        {SOCIAL_NETWORKS.map((n) => (
          <div key={n.key} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={links[n.key]?.enabled ?? false}
              onChange={(e) => toggle(n.key, e.target.checked)}
            />
            <span className="w-20 shrink-0 text-sm text-slate-600">{n.label}</span>
            <input
              type="url"
              placeholder="https://..."
              disabled={!links[n.key]?.enabled}
              value={links[n.key]?.url ?? ""}
              onChange={(e) => setUrl(n.key, e.target.value)}
              className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-100 disabled:text-slate-400"
            />
          </div>
        ))}
      </div>
      <button
        onClick={save}
        disabled={busy}
        className="mt-3 rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-60"
      >
        {busy ? "Enregistrement…" : "Enregistrer"}
      </button>
      {message && <p className="mt-1 text-xs text-slate-600">{message}</p>}
    </Card>
  );
}
