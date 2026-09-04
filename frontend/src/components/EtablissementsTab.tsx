import { useEffect, useState } from "react";
import { api, qs } from "../lib/api";
import { formatPercent } from "../lib/colors";
import type { EtablissementRow } from "../lib/types";
import { Card } from "./Card";

export function EtablissementsTab({
  scope,
  academie,
  spelc,
}: {
  scope: "national" | "academique";
  academie?: string | null;
  spelc?: string | null;
}) {
  const [rows, setRows] = useState<EtablissementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setLoading(true);
    api
      .get<{ etablissements: EtablissementRow[] }>(`/stats/etablissements${qs({ scope, academie, spelc })}`)
      .then((res) => setRows(res.etablissements))
      .finally(() => setLoading(false));
  }, [scope, academie, spelc]);

  const filtered = rows.filter((r) => r.affectation.toLowerCase().includes(search.toLowerCase()));

  return (
    <Card title="Participation par établissement" subtitle={`${rows.length} établissements`}>
      <input
        type="text"
        placeholder="Rechercher un établissement…"
        className="mb-3 w-full max-w-sm rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="max-h-96 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
              <th className="py-2 pr-4">Établissement</th>
              <th className="px-4 py-2">Inscrits</th>
              <th className="px-4 py-2">Votants</th>
              <th className="px-4 py-2">Taux</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.affectation} className="border-b border-slate-100">
                <td className="py-1.5 pr-4">{r.affectation}</td>
                <td className="px-4 py-1.5 text-slate-500">{r.inscrits}</td>
                <td className="px-4 py-1.5 text-slate-500">{r.votants}</td>
                <td className="px-4 py-1.5 text-slate-500">{formatPercent(r.taux)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <p className="py-4 text-sm text-slate-400">Chargement…</p>}
        {!loading && filtered.length === 0 && <p className="py-4 text-sm text-slate-400">Aucun résultat.</p>}
      </div>
    </Card>
  );
}
