import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, qs } from "../lib/api";
import { CATEGORICAL } from "../lib/colors";
import type { ScrutinsResult } from "../lib/types";
import { Card } from "./Card";

interface Props {
  scope: "national" | "academique";
  academie?: string | null;
  spelc?: string | null;
  /** Autorise le filtre "adhérent" (nécessite un Spelc précis et des scrutins locaux). */
  allowAdherentFilter?: boolean;
}

const PAGE_SIZE = 100;

export function ScrutinsTab({ scope, academie, spelc, allowAdherentFilter }: Props) {
  const [votant, setVotant] = useState<"" | "votant" | "non_votant">("");
  const [adherent, setAdherent] = useState<"" | "oui" | "non">("");
  const [scrutinType, setScrutinType] = useState<string>("");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<ScrutinsResult | null>(null);
  const [loading, setLoading] = useState(true);

  // Toute modification de filtre revient à la première page.
  useEffect(() => {
    setPage(0);
  }, [scope, academie, spelc, votant, adherent, scrutinType]);

  useEffect(() => {
    setLoading(true);
    api
      .get<ScrutinsResult>(
        `/stats/scrutins${qs({
          scope,
          academie,
          spelc,
          votant: votant || undefined,
          adherent: allowAdherentFilter ? adherent || undefined : undefined,
          scrutinType: scrutinType || undefined,
          limit: String(PAGE_SIZE),
          offset: String(page * PAGE_SIZE),
        })}`
      )
      .then(setData)
      .finally(() => setLoading(false));
  }, [scope, academie, spelc, votant, adherent, scrutinType, allowAdherentFilter, page]);

  const scrutinTypes = data?.groups.map((g) => g.scrutinType) ?? [];
  const totalPages = Math.max(1, Math.ceil((data?.totalRows ?? 0) / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-500">Type de scrutin</label>
          <select
            className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={scrutinType}
            onChange={(e) => setScrutinType(e.target.value)}
          >
            <option value="">Tous</option>
            {scrutinTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500">Votant / Non votant</label>
          <select
            className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={votant}
            onChange={(e) => setVotant(e.target.value as typeof votant)}
          >
            <option value="">Tous</option>
            <option value="votant">Votants</option>
            <option value="non_votant">Non votants</option>
          </select>
        </div>
        {allowAdherentFilter && (
          <div>
            <label className="block text-xs font-medium text-slate-500">Adhérent</label>
            <select
              className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              value={adherent}
              onChange={(e) => setAdherent(e.target.value as typeof adherent)}
            >
              <option value="">Tous</option>
              <option value="oui">Adhérents</option>
              <option value="non">Non adhérents</option>
            </select>
          </div>
        )}
      </div>

      <Card title="Répartition par type de scrutin">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data?.groups ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="scrutinType" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="total" name="Inscrits" fill={CATEGORICAL[0]} radius={[4, 4, 0, 0]} />
              <Bar dataKey="votants" name="Votants" fill={CATEGORICAL[4]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card
        title={`Détail (${data?.totalRows ?? 0} résultats)`}
        subtitle={totalPages > 1 ? `Page ${page + 1} sur ${totalPages}` : undefined}
      >
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="py-2 pr-4">Nom</th>
                <th className="px-4 py-2">Prénom</th>
                <th className="px-4 py-2">Scrutin</th>
                <th className="px-4 py-2">Statut</th>
                <th className="px-4 py-2">Émargement</th>
                <th className="px-4 py-2">Établissement</th>
              </tr>
            </thead>
            <tbody>
              {(data?.rows ?? []).map((r, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-1.5 pr-4">{r.nom}</td>
                  <td className="px-4 py-1.5">{r.prenom}</td>
                  <td className="px-4 py-1.5">{r.scrutinType ?? "—"}</td>
                  <td className="px-4 py-1.5">
                    {r.votant ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">Votant</span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Non votant</span>
                    )}
                  </td>
                  <td className="px-4 py-1.5 text-slate-500">
                    {r.dateEmargement ? new Date(r.dateEmargement).toLocaleString("fr-FR") : "—"}
                  </td>
                  <td className="px-4 py-1.5 text-slate-500">{r.affectation ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && <p className="py-4 text-sm text-slate-400">Chargement…</p>}
          {!loading && (data?.rows.length ?? 0) === 0 && (
            <p className="py-4 text-sm text-slate-400">Aucun résultat.</p>
          )}
        </div>
        {totalPages > 1 && <PageScroller page={page} totalPages={totalPages} onChange={setPage} />}
      </Card>
    </div>
  );
}

function PageScroller({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
      <button
        disabled={page === 0}
        onClick={() => onChange(page - 1)}
        className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-600 disabled:opacity-40"
        aria-label="Page précédente"
      >
        ‹
      </button>
      <div className="flex flex-1 gap-1 overflow-x-auto pb-1">
        {Array.from({ length: totalPages }, (_, i) => i).map((i) => (
          <button
            key={i}
            onClick={() => onChange(i)}
            className={`shrink-0 rounded-md px-2.5 py-1 text-sm ${
              i === page ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-100"
            }`}
          >
            {i + 1}
          </button>
        ))}
      </div>
      <button
        disabled={page >= totalPages - 1}
        onClick={() => onChange(page + 1)}
        className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-600 disabled:opacity-40"
        aria-label="Page suivante"
      >
        ›
      </button>
    </div>
  );
}
