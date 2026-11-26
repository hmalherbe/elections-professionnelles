import { Fragment, useEffect, useState } from "react";
import { api, qs } from "../lib/api";
import { formatPercent } from "../lib/colors";
import { SCRUTINS } from "../lib/scrutins";
import type { ScrutinDetailResult, ScrutinEmargement, ScrutinStats } from "../lib/types";
import { Card } from "./Card";

type VotantFilter = "" | "votant" | "non_votant";
type TypeScrutinFilter = "" | "scrutin1" | "scrutin2";

/**
 * Onglet "Scrutin" : taux de participation global et par établissement
 * pour les 2 scrutins agricoles côte à côte — "le CCM" (Comité consultatif
 * ministériel, scrutin1) et "la CCM" (Commission consultative mixte,
 * scrutin2) — fusionnés par identité (une personne peut être sur la liste
 * électorale de l'un, de l'autre, ou des deux). Détail par établissement
 * repliable, avec un statut et un émargement par scrutin pour chaque
 * électeur, filtres établissement / type de scrutin (ne liste que les
 * électeurs inscrits à celui choisi) / statut de vote (par scrutin) /
 * adhérent, export Excel.
 */
export function ScrutinTab() {
  const [votant1, setVotant1] = useState<VotantFilter>("");
  const [votant2, setVotant2] = useState<VotantFilter>("");
  const [typeScrutin, setTypeScrutin] = useState<TypeScrutinFilter>("");
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
          votant1: votant1 || undefined,
          votant2: votant2 || undefined,
          typeScrutin: typeScrutin || undefined,
          adherent: adherent || undefined,
          etablissement: etablissement || undefined,
        })}`
      )
      .then(setData)
      .finally(() => setLoading(false));
  }, [votant1, votant2, typeScrutin, adherent, etablissement]);

  async function exportExcel() {
    setExporting(true);
    try {
      await api.download(
        `/stats/scrutin-detail/export${qs({
          votant1: votant1 || undefined,
          votant2: votant2 || undefined,
          typeScrutin: typeScrutin || undefined,
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
        <ScrutinRateCard title="Le CCM (Comité consultatif ministériel)" stats={data?.global.scrutin1} />
        <ScrutinRateCard title="La CCM (Commission consultative mixte)" stats={data?.global.scrutin2} />
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
          <label className="block text-xs font-medium text-slate-500">Type de scrutin</label>
          <select
            className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={typeScrutin}
            onChange={(e) => setTypeScrutin(e.target.value as TypeScrutinFilter)}
          >
            <option value="">Tous</option>
            <option value="scrutin1">Le CCM ({SCRUTINS[0].label})</option>
            <option value="scrutin2">La CCM ({SCRUTINS[1].label})</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500">Statut — le CCM</label>
          <select
            className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={votant1}
            onChange={(e) => setVotant1(e.target.value as VotantFilter)}
          >
            <option value="">Tous</option>
            <option value="votant">Votants</option>
            <option value="non_votant">Non votants</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500">Statut — la CCM</label>
          <select
            className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={votant2}
            onChange={(e) => setVotant2(e.target.value as VotantFilter)}
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
                <th className="px-4 py-2">Statut (le CCM)</th>
                <th className="px-4 py-2">Émargement (le CCM)</th>
                <th className="px-4 py-2">Statut (la CCM)</th>
                <th className="px-4 py-2">Émargement (la CCM)</th>
                <th className="px-4 py-2">Adhérent</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.etablissement}>
                  <tr className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => toggle(g.etablissement)}>
                    <td className="py-2 pr-4 font-medium text-slate-800" colSpan={6}>
                      <span className="mr-1 inline-block w-3 text-slate-400">{open.has(g.etablissement) ? "▾" : "▸"}</span>
                      {g.etablissement}
                      <span className="ml-2 text-xs font-normal text-slate-400">
                        (le CCM : {formatPercent(g.scrutin1.taux)} — la CCM : {formatPercent(g.scrutin2.taux)}, {g.rows.length} affiché
                        {g.rows.length > 1 ? "s" : ""})
                      </span>
                    </td>
                  </tr>
                  {open.has(g.etablissement) &&
                    g.rows.map((r, i) => (
                      <tr key={`${g.etablissement}-${i}`} className="border-b border-slate-50 bg-slate-50/60">
                        <td className="py-1.5 pl-8 pr-4 text-slate-600">
                          {r.nom} {r.prenom}
                        </td>
                        <EmargementCells emargement={r.scrutin1} />
                        <EmargementCells emargement={r.scrutin2} />
                        <td className="px-4 py-1.5">
                          {r.isAdherent ? (
                            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700">Adhérent</span>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
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

function ScrutinRateCard({ title, stats }: { title: string; stats: ScrutinStats | undefined }) {
  return (
    <Card title={title}>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Taux de participation</p>
          <p className="text-2xl font-semibold text-slate-800">{stats ? formatPercent(stats.taux) : "—"}</p>
          <p className="mt-0.5 text-xs text-slate-400">
            {stats ? `${stats.votants.toLocaleString("fr-FR")} / ${stats.inscrits.toLocaleString("fr-FR")}` : ""}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Taux — adhérents</p>
          <p className="text-2xl font-semibold text-slate-800">{stats ? formatPercent(stats.adherentsTaux) : "—"}</p>
          <p className="mt-0.5 text-xs text-slate-400">
            {stats ? `${stats.adherentsVotants.toLocaleString("fr-FR")} / ${stats.adherentsInscrits.toLocaleString("fr-FR")}` : ""}
          </p>
        </div>
      </div>
    </Card>
  );
}

/** Statut + émargement d'un scrutin pour un électeur — "Non inscrit" (plutôt
 * qu'un statut votant/non votant) si cette personne n'est pas sur la liste
 * électorale de CE scrutin (les 2 listes, importées séparément, peuvent
 * différer). */
function EmargementCells({ emargement }: { emargement: ScrutinEmargement | null }) {
  if (!emargement) {
    return (
      <>
        <td className="px-4 py-1.5">
          <span className="text-xs text-slate-400">Non inscrit</span>
        </td>
        <td className="px-4 py-1.5 text-slate-400">—</td>
      </>
    );
  }
  return (
    <>
      <td className="px-4 py-1.5">
        {emargement.votant ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">Votant</span>
        ) : (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Non votant</span>
        )}
      </td>
      <td className="px-4 py-1.5 text-slate-500">
        {emargement.dateEmargement ? new Date(emargement.dateEmargement).toLocaleString("fr-FR") : "—"}
      </td>
    </>
  );
}
