import { useEffect, useState } from "react";
import { api, qs } from "../lib/api";
import { formatPercent } from "../lib/colors";
import type { EtablissementRow } from "../lib/types";
import { Card } from "./Card";

type SortKey = "affectation" | "inscrits" | "votants" | "taux";

const COLUMNS: { key: SortKey; label: string; defaultDir: "asc" | "desc" }[] = [
  { key: "affectation", label: "Établissement", defaultDir: "asc" },
  { key: "inscrits", label: "Inscrits", defaultDir: "desc" },
  { key: "votants", label: "Votants", defaultDir: "desc" },
  { key: "taux", label: "Taux de participation", defaultDir: "desc" },
];

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
  const [sortKey, setSortKey] = useState<SortKey>("inscrits");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    setLoading(true);
    api
      .get<{ etablissements: EtablissementRow[] }>(`/stats/etablissements${qs({ scope, academie, spelc })}`)
      .then((res) => setRows(res.etablissements))
      .finally(() => setLoading(false));
  }, [scope, academie, spelc]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(COLUMNS.find((c) => c.key === key)!.defaultDir);
    }
  }

  const filtered = rows
    .filter((r) => r.affectation.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      if (sortKey === "affectation") return a.affectation.localeCompare(b.affectation) * dir;
      return (a[sortKey] - b[sortKey]) * dir;
    });

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
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={`cursor-pointer select-none py-2 ${col.key === "affectation" ? "pr-4" : "px-4"} hover:text-slate-700`}
                  onClick={() => toggleSort(col.key)}
                >
                  {col.label}
                  <span className={`ml-1 ${sortKey === col.key ? "text-slate-400" : "text-slate-300"}`}>
                    {sortKey === col.key ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
                  </span>
                </th>
              ))}
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
