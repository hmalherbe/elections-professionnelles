import { Fragment, useEffect, useState } from "react";
import { api, qs } from "../lib/api";
import { formatPercent } from "../lib/colors";
import type { ScrutinDetailResult } from "../lib/types";
import { Card } from "./Card";

/**
 * Onglet "Scrutin" : taux de participation global et par établissement
 * (électeurs ET, parmi eux, les seuls adhérents), avec le détail nommé des
 * électeurs de chaque établissement, repliable — filtres votant/non votant,
 * établissement et adhérent/non adhérent, export Excel. Le choix du scrutin
 * (le Comité consultatif ministériel ou la Commission consultative mixte,
 * tous deux abrégés "CCM") se fait via le ScrutinToggle du panneau parent
 * (voir Dashboard.tsx), pas ici.
 */
export function ScrutinTab({ scrutin }: { scrutin: "scrutin1" | "scrutin2" }) {
  const [votant, setVotant] = useState<"" | "votant" | "non_votant">("");
  const [adherent, setAdherent] = useState<"" | "oui" | "non">("");
  const [etablissement, setEtablissement] = useState<string>("");
  const [data, setData] = useState<ScrutinDetailResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    api
      .get<ScrutinDetailResult>(
        `/stats/scrutin-detail${qs({
          scrutin,
          votant: votant || undefined,
          adherent: adherent || undefined,
          etablissement: etablissement || undefined,
        })}`
      )
      .then(setData)
      .finally(() => setLoading(false));
  }, [scrutin, votant, adherent, etablissement]);

  async function exportExcel() {
    setExporting(true);
    try {
      await api.download(
        `/stats/scrutin-detail/export${qs({
          scrutin,
          votant: votant || undefined,
          adherent: adherent || undefined,
          etablissement: etablissement || undefined,
        })}`,
        "detail-scrutin.xlsx"
      );
    } finally {
      setExporting(false);
    }
  }

  function toggle(etab: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(etab)) next.delete(etab);
      else next.add(etab);
      return next;
    });
  }

  const groups = data?.etablissements ?? [];
  const allOpen = groups.length > 0 && groups.every((g) => open.has(g.etablissement));
  function toggleAll() {
    setOpen(allOpen ? new Set() : new Set(groups.map((g) => g.etablissement)));
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card title="Taux de participation global">
          <p className="text-3xl font-semibold text-slate-800">{data ? formatPercent(data.global.taux) : "—"}</p>
          <p className="mt-1 text-sm text-slate-500">
            {data ? `${data.global.votants.toLocaleString("fr-FR")} / ${data.global.inscrits.toLocaleString("fr-FR")} inscrit(s)` : ""}
          </p>
        </Card>
        <Card title="Taux de participation — adhérents">
          <p className="text-3xl font-semibold text-slate-800">{data ? formatPercent(data.global.adherentsTaux) : "—"}</p>
          <p className="mt-1 text-sm text-slate-500">
            {data
              ? `${data.global.adherentsVotants.toLocaleString("fr-FR")} / ${data.global.adherentsInscrits.toLocaleString("fr-FR")} adhérent(s)`
              : ""}
          </p>
        </Card>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-500">Établissement</label>
          <select
            className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={etablissement}
            onChange={(e) => setEtablissement(e.target.value)}
          >
            <option value="">Tous</option>
            {data?.etablissementOptions.map((et) => (
              <option key={et} value={et}>
                {et}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500">Statut du vote</label>
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
        <button
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-60"
          disabled={exporting}
          onClick={exportExcel}
        >
          {exporting ? "Export…" : "Export Excel"}
        </button>
      </div>

      <Card
        title={`Détail par établissement (${data?.totalRows ?? 0} résultats, ${groups.length} établissements)`}
        action={
          groups.length > 0 && (
            <button
              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100"
              onClick={toggleAll}
            >
              {allOpen ? "Tout replier" : "Tout déplier"}
            </button>
          )
        }
      >
        <div className="max-h-[32rem] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="py-2 pr-4">Établissement / Électeur</th>
                <th className="px-4 py-2">Statut</th>
                <th className="px-4 py-2">Adhérent</th>
                <th className="px-4 py-2">Émargement</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.etablissement}>
                  <tr className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => toggle(g.etablissement)}>
                    <td className="py-2 pr-4 font-medium text-slate-800" colSpan={4}>
                      <span className="mr-1 inline-block w-3 text-slate-400">{open.has(g.etablissement) ? "▾" : "▸"}</span>
                      {g.etablissement}
                      <span className="ml-2 text-xs font-normal text-slate-400">
                        ({formatPercent(g.taux)}, {g.rows.length} affiché{g.rows.length > 1 ? "s" : ""})
                      </span>
                    </td>
                  </tr>
                  {open.has(g.etablissement) &&
                    g.rows.map((r, i) => (
                      <tr key={`${g.etablissement}-${i}`} className="border-b border-slate-50 bg-slate-50/60">
                        <td className="py-1.5 pl-8 pr-4 text-slate-600">
                          {r.nom} {r.prenom}
                        </td>
                        <td className="px-4 py-1.5">
                          {r.votant ? (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">Votant</span>
                          ) : (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Non votant</span>
                          )}
                        </td>
                        <td className="px-4 py-1.5">
                          {r.isAdherent ? (
                            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700">Adhérent</span>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-1.5 text-slate-500">
                          {r.dateEmargement ? new Date(r.dateEmargement).toLocaleString("fr-FR") : "—"}
                        </td>
                      </tr>
                    ))}
                </Fragment>
              ))}
            </tbody>
          </table>
          {loading && <p className="py-4 text-sm text-slate-400">Chargement…</p>}
          {!loading && groups.length === 0 && <p className="py-4 text-sm text-slate-400">Aucun résultat.</p>}
        </div>
      </Card>
    </div>
  );
}
