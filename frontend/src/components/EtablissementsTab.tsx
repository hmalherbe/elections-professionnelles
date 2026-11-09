import { useEffect, useState } from "react";
import { api, qs } from "../lib/api";
import { formatPercent } from "../lib/colors";
import type { EtablissementRow } from "../lib/types";
import { Card } from "./Card";

type SortKey = "affectation" | "inscrits" | "votants" | "taux" | "adherentsTaux";

const COLUMNS: { key: SortKey; label: string; defaultDir: "asc" | "desc" }[] = [
  { key: "affectation", label: "Établissement", defaultDir: "asc" },
  { key: "inscrits", label: "Inscrits", defaultDir: "desc" },
  { key: "votants", label: "Votants", defaultDir: "desc" },
  { key: "taux", label: "Taux de participation", defaultDir: "desc" },
  { key: "adherentsTaux", label: "Taux de participation (adhérents)", defaultDir: "desc" },
];

/** Tranches de 10 points de participation, 0-10 % à 90-100 % inclus. */
const TRANCHES = Array.from({ length: 10 }, (_, i) => ({ min: i / 10, max: (i + 1) / 10, label: `${i * 10}-${i * 10 + 10} %` }));

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
  const [tranche, setTranche] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("inscrits");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [exporting, setExporting] = useState(false);

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

  async function exportExcel() {
    setExporting(true);
    try {
      await api.download(`/stats/etablissements/export${qs({ scope, academie, spelc })}`, "participation-par-etablissement.xlsx");
    } finally {
      setExporting(false);
    }
  }

  const selectedTranche = tranche ? TRANCHES[Number(tranche)] : null;

  const filtered = rows
    .filter((r) => r.affectation.toLowerCase().includes(search.toLowerCase()))
    .filter(
      (r) => !selectedTranche || (r.taux >= selectedTranche.min && (r.taux < selectedTranche.max || selectedTranche.max >= 1))
    )
    .sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      if (sortKey === "affectation") return a.affectation.localeCompare(b.affectation) * dir;
      return (a[sortKey] - b[sortKey]) * dir;
    });

  return (
    <Card title="Participation par établissement" subtitle={`${filtered.length} / ${rows.length} établissements`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Rechercher un établissement…"
          className="w-full max-w-sm rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          value={tranche}
          onChange={(e) => setTranche(e.target.value)}
        >
          <option value="">Toutes les tranches de participation</option>
          {TRANCHES.map((t, i) => (
            <option key={t.label} value={i}>
              {t.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-60"
          disabled={exporting || rows.length === 0}
          onClick={exportExcel}
        >
          {exporting ? "Export…" : "Export Excel"}
        </button>
      </div>
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
                <td
                  className="px-4 py-1.5 text-slate-500"
                  title={`${r.adherentsVotants.toLocaleString("fr-FR")} / ${r.adherentsInscrits.toLocaleString("fr-FR")} adhérent(s)`}
                >
                  {formatPercent(r.adherentsTaux)}
                </td>
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
