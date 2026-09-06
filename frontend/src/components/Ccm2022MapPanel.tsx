import { useMemo, useState } from "react";
import { CCM_2022_ACADEMIE_MAP, type CcmOsEntry } from "../data/ccm2022AcademieMap";
import { CCM_2022_DEPARTEMENTS, CCM_2022_SPELCS } from "../data/ccm2022Breakdowns";
import { CCM_2022_DEPARTEMENT_GEO } from "../data/ccm2022DepartementGeo";
import { CCM_2022_SPELC_GEO } from "../data/ccm2022SpelcGeo";
import { OS_COLORS, OS_LABELS, TABLE_OS, formatVotes, leaderInfo, votesFor } from "../lib/ccm2022";
import { Card } from "./Card";

type Scrutin = "1D" | "2D";
type Vue = "academie" | "departement" | "spelc";

const VUE_LABELS: Record<Vue, string> = {
  academie: "Académie",
  departement: "Département",
  spelc: "Spelc",
};

const DEPT_NAME: Record<string, string> = Object.fromEntries(
  CCM_2022_DEPARTEMENTS.filter((d) => d.code).map((d) => [d.code as string, d.name])
);

interface MapShape {
  key: string;
  label: string;
  path: string;
  cx: number;
  cy: number;
  entries: CcmOsEntry[];
  orphan?: boolean;
}

export function Ccm2022MapPanel() {
  const [scrutin, setScrutin] = useState<Scrutin>("1D");
  const [vue, setVue] = useState<Vue>("academie");
  const [selected, setSelected] = useState<{ label: string; entries: CcmOsEntry[]; orphan?: boolean } | null>(null);

  const data = CCM_2022_ACADEMIE_MAP;
  const overseas = data.overseas[scrutin];

  function entriesForAcademie(academie: string): CcmOsEntry[] {
    return data.academies[academie]?.[scrutin] ?? overseas[academie] ?? [];
  }

  const geo = vue === "departement" ? CCM_2022_DEPARTEMENT_GEO : vue === "spelc" ? CCM_2022_SPELC_GEO : data;

  const mapShapes: MapShape[] = useMemo(() => {
    if (vue === "departement") {
      return Object.entries(CCM_2022_DEPARTEMENT_GEO.departements).map(([code, d]) => ({
        key: code,
        label: `${code} – ${DEPT_NAME[code] ?? code}`,
        path: d.path,
        cx: d.cx,
        cy: d.cy,
        entries: entriesForAcademie(d.academie),
      }));
    }
    if (vue === "spelc") {
      return CCM_2022_SPELC_GEO.spelcs.map((s) => ({
        key: s.key,
        label: s.spelc ? (s.spelc === "Centre-Poitou-Charente" ? `${s.spelc} (${s.academie})` : s.spelc) : `${s.academie} — non couvert`,
        path: s.path,
        cx: s.cx,
        cy: s.cy,
        entries: entriesForAcademie(s.academie),
        orphan: s.spelc === null,
      }));
    }
    return Object.entries(data.academies).map(([name, info]) => ({
      key: name,
      label: name,
      path: info.path,
      cx: info.cx,
      cy: info.cy,
      entries: info[scrutin],
    }));
  }, [vue, data, overseas, scrutin]);

  const tableRows = useMemo(() => {
    if (vue === "academie") {
      const metropole = Object.entries(data.academies).map(([name, info]) => ({ name, entries: info[scrutin] }));
      const domTom = Object.entries(overseas).map(([name, entries]) => ({ name, entries }));
      return [...metropole, ...domTom].sort((a, b) => a.name.localeCompare(b.name, "fr"));
    }
    if (vue === "departement") {
      return CCM_2022_DEPARTEMENTS.map((d) => ({
        name: d.code ? `${d.code} – ${d.name}` : d.name,
        entries: entriesForAcademie(d.academies[0]),
      }));
    }
    // vue === "spelc" : le Spelc Centre-Poitou-Charente chevauche deux académies
    // réelles (Poitiers et Orléans-Tours) et ne peut pas être réduit à une seule
    // ligne sans mélanger deux élections distinctes.
    return CCM_2022_SPELCS.flatMap((s) =>
      s.academies.length > 1
        ? s.academies.map((a) => ({ name: `${s.name} (${a})`, entries: entriesForAcademie(a) }))
        : [{ name: s.name, entries: entriesForAcademie(s.academies[0]) }]
    ).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }, [data, overseas, scrutin, vue]);

  const tableTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const os of TABLE_OS) totals[os] = tableRows.reduce((sum, r) => sum + votesFor(r.entries, os), 0);
    return totals;
  }, [tableRows]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-800">Résultats CCM 2022 par {VUE_LABELS[vue].toLowerCase()}</h3>
        <p className="mt-1 text-xs text-slate-500">
          Organisation syndicale en tête et nombre de sièges obtenus, par {VUE_LABELS[vue].toLowerCase()}. Référence
          historique fixe, sans lien avec le scrutin 2026 en cours de suivi. Survolez ou touchez la carte pour le
          détail complet.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-1">
            {(["1D", "2D"] as Scrutin[]).map((s) => (
              <button
                key={s}
                onClick={() => {
                  setScrutin(s);
                  setSelected(null);
                }}
                className={`rounded px-3 py-1 text-sm font-medium ${
                  scrutin === s ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {s === "1D" ? "1er degré" : "2nd degré"}
              </button>
            ))}
          </div>
          <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-1">
            {(["academie", "departement", "spelc"] as Vue[]).map((v) => (
              <button
                key={v}
                onClick={() => {
                  setVue(v);
                  setSelected(null);
                }}
                className={`rounded px-3 py-1 text-sm font-medium ${
                  vue === v ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {VUE_LABELS[v]}
              </button>
            ))}
          </div>
        </div>
        {vue !== "academie" && (
          <p className="mt-3 text-xs text-slate-400">
            {vue === "departement"
              ? "Les sièges ne sont attribués que par académie dans ce scrutin : chaque département affiche les contours réels de son département, coloré par les résultats de son académie de rattachement (plusieurs départements d'une même académie affichent donc les mêmes résultats)."
              : "Chaque zone affiche les contours réunis des départements d'un Spelc (référentiel interne de l'application), colorés par les résultats de l'académie de rattachement. Le Spelc « Centre-Poitou-Charente » chevauche deux académies réelles (Poitiers et Orléans-Tours) et apparaît donc en deux zones distinctes. Les départements grisés (Grenoble, Corse) ne sont rattachés à aucun Spelc dans ce référentiel."}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-800">
              Métropole — {VUE_LABELS[vue]} — {scrutin === "1D" ? "1er degré" : "2nd degré"}
            </h4>
            <span className="text-xs text-slate-400">
              {mapShapes.length} {vue === "academie" ? "académies" : vue === "departement" ? "départements" : "zones"}
            </span>
          </div>
          <svg
            viewBox={`0 0 ${geo.width} ${geo.height}`}
            className="w-full"
            role="img"
            aria-label={`Carte des ${VUE_LABELS[vue].toLowerCase()}s de France métropolitaine`}
          >
            <defs>
              {mapShapes
                .map((s) => ({ ...s, ...leaderInfo(s.entries) }))
                .filter((s) => s.tie)
                .map((s) => (
                  <pattern
                    key={s.key}
                    id={`tie-${s.key.replace(/[^a-zA-Z0-9]/g, "")}`}
                    width={8}
                    height={8}
                    patternUnits="userSpaceOnUse"
                    patternTransform="rotate(45)"
                  >
                    <rect width={8} height={4} fill={OS_COLORS[s.leaders[0].os]} />
                    <rect y={4} width={8} height={4} fill={OS_COLORS[s.leaders[1].os]} />
                  </pattern>
                ))}
            </defs>
            {mapShapes.map((s) => {
              const { leaders, tie } = leaderInfo(s.entries);
              const idSafe = s.key.replace(/[^a-zA-Z0-9]/g, "");
              const isSelected = selected?.label === s.label;
              return (
                <path
                  key={s.key}
                  d={s.path}
                  fill={
                    s.orphan
                      ? "#d7dbd3"
                      : !s.entries.length
                        ? "#eef1ec"
                        : tie
                          ? `url(#tie-${idSafe})`
                          : OS_COLORS[leaders[0].os]
                  }
                  stroke={isSelected ? "#0f172a" : "#ffffff"}
                  strokeWidth={isSelected ? 1.6 : vue === "departement" ? 0.6 : 1.1}
                  className="cursor-pointer transition-[filter] hover:brightness-105"
                  onMouseEnter={() => setSelected({ label: s.label, entries: s.entries, orphan: s.orphan })}
                  onFocus={() => setSelected({ label: s.label, entries: s.entries, orphan: s.orphan })}
                  tabIndex={0}
                  onClick={() => setSelected({ label: s.label, entries: s.entries, orphan: s.orphan })}
                >
                  <title>
                    {s.label}
                    {s.orphan
                      ? "\nNon couvert par le référentiel Spelc"
                      : s.entries
                          .filter((e) => e.sieges > 0 || e.votes > 0)
                          .map((e) => `\n${OS_LABELS[e.os] ?? e.os} : ${e.sieges} siège${e.sieges > 1 ? "s" : ""}`)
                          .join("")}
                  </title>
                </path>
              );
            })}
            {vue !== "departement" &&
              mapShapes.map((s) => {
                if (!s.entries.length) return null;
                const { leaders } = leaderInfo(s.entries);
                return (
                  <text
                    key={s.key}
                    x={s.cx}
                    y={s.cy}
                    textAnchor="middle"
                    fontSize={6.5}
                    fontWeight={600}
                    fill="#fcfcfb"
                    stroke="rgba(0,0,0,0.35)"
                    strokeWidth={2}
                    paintOrder="stroke"
                    pointerEvents="none"
                  >
                    {leaders[0].sieges}
                  </text>
                );
              })}
          </svg>
        </div>

        <div className="flex flex-col gap-4">
          <Card title="Organisations">
            <ul className="space-y-2 text-sm">
              {(["CFDT", "CFTC", "CGT", "SPELC"] as const).map((os) => (
                <li key={os} className="flex items-center gap-2">
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded"
                    style={{ backgroundColor: OS_COLORS[os], boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.12)" }}
                  />
                  {OS_LABELS[os]}
                </li>
              ))}
              <li className="flex items-center gap-2">
                <span
                  className="h-3.5 w-3.5 shrink-0 rounded"
                  style={{
                    background: `repeating-linear-gradient(45deg, ${OS_COLORS.SPELC} 0 4px, ${OS_COLORS.CFTC} 4px 8px)`,
                  }}
                />
                Égalité de sièges
              </li>
            </ul>
            <p className="mt-3 text-xs text-slate-400">
              Motif diagonal = égalité du nombre de sièges entre deux organisations dans cette académie. Le détail
              complet (voix et sièges) est toujours accessible au survol.
            </p>
          </Card>

          <Card title={selected?.label ?? "Aucune sélection"}>
            {selected ? (
              <>
                {selected.orphan && (
                  <p className="mb-2 text-xs text-amber-600">
                    Non couvert par le référentiel Spelc — résultats de l'académie de rattachement ci-dessous.
                  </p>
                )}
                {selected.entries.filter((e) => e.sieges > 0 || e.votes > 0).length ? (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
                        <th className="pb-1.5 font-medium">Organisation</th>
                        <th className="pb-1.5 text-right font-medium">Sièges</th>
                        <th className="pb-1.5 text-right font-medium">Voix</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.entries
                        .filter((e) => e.sieges > 0 || e.votes > 0)
                        .map((e) => (
                          <tr key={e.os} className="border-b border-slate-100 last:border-0">
                            <td className="flex items-center gap-2 py-1.5">
                              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: OS_COLORS[e.os] }} />
                              {OS_LABELS[e.os] ?? e.os}
                            </td>
                            <td className="py-1.5 text-right tabular-nums">{e.sieges}</td>
                            <td className="py-1.5 text-right tabular-nums text-slate-500">{formatVotes(e.votes)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-xs text-slate-400">Aucune donnée.</p>
                )}
              </>
            ) : (
              <p className="text-xs text-slate-400">Survolez la carte pour afficher le détail.</p>
            )}
          </Card>
        </div>
      </div>

      <Card title={`Tableau des résultats — ${scrutin === "1D" ? "1er degré" : "2nd degré"}`}>
        <p className="mb-3 text-xs text-slate-500">
          Nombre de voix obtenues par chaque organisation syndicale, {vue === "spelc" ? "Spelc par Spelc" : vue === "departement" ? "département par département" : "académie par académie"} (métropole et outre-mer) — vue sélectionnée ci-dessus.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
                <th className="py-1.5 pr-4 font-medium">{VUE_LABELS[vue]}</th>
                {TABLE_OS.map((os) => (
                  <th key={os} className="px-3 py-1.5 text-right font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: OS_COLORS[os] }} />
                      {OS_LABELS[os]}
                    </span>
                  </th>
                ))}
                <th className="py-1.5 pl-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map(({ name, entries }) => {
                const total = TABLE_OS.reduce((sum, os) => sum + votesFor(entries, os), 0);
                return (
                  <tr key={name} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="py-1.5 pr-4 text-slate-700">{name}</td>
                    {TABLE_OS.map((os) => {
                      const v = votesFor(entries, os);
                      return (
                        <td key={os} className={`px-3 py-1.5 text-right tabular-nums ${v ? "text-slate-700" : "text-slate-300"}`}>
                          {v ? formatVotes(v) : "–"}
                        </td>
                      );
                    })}
                    <td className="py-1.5 pl-3 text-right font-semibold tabular-nums text-slate-800">
                      {formatVotes(total)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 font-semibold text-slate-800">
                <td className="py-1.5 pr-4">Total</td>
                {TABLE_OS.map((os) => (
                  <td key={os} className="px-3 py-1.5 text-right tabular-nums">
                    {formatVotes(tableTotals[os])}
                  </td>
                ))}
                <td className="py-1.5 pl-3 text-right tabular-nums">
                  {formatVotes(TABLE_OS.reduce((sum, os) => sum + tableTotals[os], 0))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <Card title="Outre-mer" subtitle="Académies ultramarines, non représentées sur la carte de métropole ci-dessus.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(overseas).map(([name, entries]) => {
            const filtered = entries.filter((e) => e.sieges > 0 || e.votes > 0);
            return (
              <div key={name} className="rounded-md border border-slate-200 p-3">
                <p className="mb-2 text-sm font-semibold text-slate-800">{name}</p>
                {filtered.length ? (
                  <ul className="space-y-1">
                    {filtered.map((e) => (
                      <li key={e.os} className="flex items-center justify-between gap-2 text-xs text-slate-600">
                        <span className="flex items-center gap-1.5">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: OS_COLORS[e.os] }} />
                          {OS_LABELS[e.os] ?? e.os}
                        </span>
                        <span className="font-semibold tabular-nums">
                          {e.sieges} siège{e.sieges > 1 ? "s" : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-400">Aucune donnée</p>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <p className="text-xs text-slate-400">
        Source&nbsp;: résultats CCM 2022, onglets « Ventilation 1D » et « Ventilation 2D » du fichier de
        dépouillement transmis par l'administrateur général. Les sièges par organisation sont agrégés sur l'ensemble
        des scrutins/collèges de chaque académie. Fond de carte reconstitué par union des contours départementaux
        officiels (académies post-réforme 2020), projection équirectangulaire simplifiée à vocation illustrative.
      </p>
    </div>
  );
}
