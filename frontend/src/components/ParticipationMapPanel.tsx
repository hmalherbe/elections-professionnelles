import { useMemo, useState } from "react";
import { CCM_2022_ACADEMIE_MAP } from "../data/ccm2022AcademieMap";
import { CCM_2022_SPELC_GEO } from "../data/ccm2022SpelcGeo";
import { formatPercentOrDash } from "../lib/colors";
import type { AcademieNode, ParticipationRow } from "../lib/types";
import { Card } from "./Card";

type MetricKey = "taux" | "tauxCcmi" | "tauxCcma" | "adherentsTauxCcmi" | "adherentsTauxCcma";
type Vue = "academie" | "spelc";

const VUE_LABELS: Record<Vue, string> = { academie: "Académie", spelc: "Spelc" };

const METRICS: { key: MetricKey; label: string; inscritsKey: keyof ParticipationRow; votantsKey: keyof ParticipationRow }[] = [
  { key: "taux", label: "CCMMEP", inscritsKey: "inscrits", votantsKey: "votants" },
  { key: "tauxCcmi", label: "Taux CCMI (1er degré)", inscritsKey: "inscritsCcmi", votantsKey: "votantsCcmi" },
  { key: "tauxCcma", label: "Taux CCMA (2nd degré)", inscritsKey: "inscritsCcma", votantsKey: "votantsCcma" },
  {
    key: "adherentsTauxCcmi",
    label: "Taux adhérents CCMI",
    inscritsKey: "adherentsInscritsCcmi",
    votantsKey: "adherentsVotantsCcmi",
  },
  {
    key: "adherentsTauxCcma",
    label: "Taux adhérents CCMA",
    inscritsKey: "adherentsInscritsCcma",
    votantsKey: "adherentsVotantsCcma",
  },
];

/**
 * Rampe séquentielle (une seule teinte, clair -> foncé), 13 crans 100->700 —
 * palette de référence du skill dataviz (references/palette.md). Le
 * validateur de palette ne juge pas une rampe séquentielle (seule la
 * monotonie de luminosité compte, voir color-formula.md) : cette rampe
 * documentée est reprise telle quelle, sans modification.
 */
const SEQUENTIAL_RAMP = [
  "#cde2fb",
  "#b7d3f6",
  "#9ec5f4",
  "#86b6ef",
  "#6da7ec",
  "#5598e7",
  "#3987e5",
  "#2a78d6",
  "#256abf",
  "#1c5cab",
  "#184f95",
  "#104281",
  "#0d366b",
];
/** Gris neutre pour une zone sans aucune donnée (0 inscrit) — distinct du pas
 * le plus clair de la rampe, pour ne jamais confondre "aucune donnée" avec
 * "taux de participation proche de 0 %" (même principe que formatPercentOrDash). */
const NO_DATA_COLOR = "#eef1ec";
const ORPHAN_COLOR = "#d7dbd3";

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

/** Couleur de la rampe séquentielle pour un taux 0..1, par interpolation
 * linéaire entre les deux crans documentés encadrant cette valeur. */
function colorForRate(rate: number): string {
  const clamped = Math.max(0, Math.min(1, rate));
  const pos = clamped * (SEQUENTIAL_RAMP.length - 1);
  const i = Math.min(Math.floor(pos), SEQUENTIAL_RAMP.length - 2);
  const frac = pos - i;
  const a = hexToRgb(SEQUENTIAL_RAMP[i]);
  const b = hexToRgb(SEQUENTIAL_RAMP[i + 1]);
  return rgbToHex([a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac, a[2] + (b[2] - a[2]) * frac]);
}

interface MapShape {
  key: string;
  label: string;
  path: string;
  cx: number;
  cy: number;
  row: ParticipationRow | null;
  /** Département réel non rattaché à un Spelc dans le référentiel (vue Spelc uniquement). */
  orphan?: boolean;
}

export function ParticipationMapPanel({ tree }: { tree: AcademieNode[] }) {
  const [metric, setMetric] = useState<MetricKey>("taux");
  const [vue, setVue] = useState<Vue>("academie");
  const [selected, setSelected] = useState<{ label: string; row: ParticipationRow | null; orphan?: boolean } | null>(null);

  const metricDef = METRICS.find((m) => m.key === metric)!;
  const geo = vue === "spelc" ? CCM_2022_SPELC_GEO : CCM_2022_ACADEMIE_MAP;

  function academieNode(academie: string): AcademieNode | null {
    return tree.find((n) => n.label === academie) ?? null;
  }
  function rowForAcademie(academie: string): ParticipationRow | null {
    return academieNode(academie);
  }
  function rowForSpelc(academie: string, spelc: string | null): ParticipationRow | null {
    if (!spelc) return null;
    return academieNode(academie)?.spelcs.find((s) => s.label === spelc) ?? null;
  }

  const mapShapes: MapShape[] = useMemo(() => {
    if (vue === "spelc") {
      return CCM_2022_SPELC_GEO.spelcs.map((s) => ({
        key: s.key,
        label: s.spelc ?? `${s.academie} — non couvert`,
        path: s.path,
        cx: s.cx,
        cy: s.cy,
        row: rowForSpelc(s.academie, s.spelc),
        orphan: s.spelc === null,
      }));
    }
    return Object.entries(CCM_2022_ACADEMIE_MAP.academies).map(([name, info]) => ({
      key: name,
      label: name,
      path: info.path,
      cx: info.cx,
      cy: info.cy,
      row: rowForAcademie(name),
    }));
  }, [vue, tree]);

  // Académies ultramarines : pas de contour dans le fond de carte (voir
  // Ccm2022MapPanel), listées à part sous forme de cartes de données brutes.
  const metropoleAcademies = new Set(Object.keys(CCM_2022_ACADEMIE_MAP.academies));
  const overseasRows = tree.filter((n) => !metropoleAcademies.has(n.label));

  function fillFor(row: ParticipationRow | null, orphan?: boolean): string {
    if (orphan) return ORPHAN_COLOR;
    const inscrits = row ? (row[metricDef.inscritsKey] as number) : 0;
    if (!row || inscrits === 0) return NO_DATA_COLOR;
    return colorForRate(row[metric] as number);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-800">Carte de la participation</h3>
        <p className="mt-1 text-xs text-slate-500">
          Taux de participation par {VUE_LABELS[vue].toLowerCase()}, sur la métropole. Survolez ou touchez une zone
          pour le détail. Les académies ultramarines, sans contour sur ce fond de carte, sont listées plus bas.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="inline-flex flex-wrap rounded-md border border-slate-200 bg-slate-50 p-1">
            {METRICS.map((m) => (
              <button
                key={m.key}
                onClick={() => {
                  setMetric(m.key);
                  setSelected(null);
                }}
                className={`rounded px-3 py-1 text-sm font-medium ${
                  metric === m.key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-1">
            {(["academie", "spelc"] as Vue[]).map((v) => (
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
        {vue === "spelc" && (
          <p className="mt-3 text-xs text-slate-400">
            Chaque zone affiche les contours réunis des départements d'un Spelc (référentiel interne de
            l'application). Le territoire « Centre-Poitou-Charente », scindé en deux Spelc (Poitiers et
            Orléans-Tours), apparaît donc en deux zones distinctes. Les départements grisés ne sont rattachés à
            aucun Spelc dans ce référentiel.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-800">
              Métropole — {VUE_LABELS[vue]} — {metricDef.label}
            </h4>
            <span className="text-xs text-slate-400">
              {mapShapes.length} {vue === "academie" ? "académies" : "zones"}
            </span>
          </div>
          <svg
            viewBox={`0 0 ${geo.width} ${geo.height}`}
            className="w-full"
            role="img"
            aria-label={`Carte de la participation (${metricDef.label}) par ${VUE_LABELS[vue].toLowerCase()}`}
          >
            {mapShapes.map((s) => {
              const isSelected = selected?.label === s.label;
              return (
                <path
                  key={s.key}
                  d={s.path}
                  fill={fillFor(s.row, s.orphan)}
                  stroke={isSelected ? "#0f172a" : "#ffffff"}
                  strokeWidth={isSelected ? 1.6 : 1.1}
                  className="cursor-pointer transition-[filter] hover:brightness-105"
                  onMouseEnter={() => setSelected({ label: s.label, row: s.row, orphan: s.orphan })}
                  onFocus={() => setSelected({ label: s.label, row: s.row, orphan: s.orphan })}
                  tabIndex={0}
                  onClick={() => setSelected({ label: s.label, row: s.row, orphan: s.orphan })}
                >
                  <title>
                    {s.label}
                    {s.orphan
                      ? "\nNon couvert par le référentiel Spelc"
                      : s.row
                        ? `\n${metricDef.label} : ${formatPercentOrDash(
                            s.row[metric] as number,
                            s.row[metricDef.inscritsKey] as number
                          )} (${s.row[metricDef.votantsKey]} / ${s.row[metricDef.inscritsKey]})`
                        : "\nAucune donnée"}
                  </title>
                </path>
              );
            })}
          </svg>

          <div className="mt-3 flex items-center gap-3">
            <span className="text-xs text-slate-400">0 %</span>
            <div
              className="h-2.5 flex-1 rounded-full"
              style={{ background: `linear-gradient(to right, ${SEQUENTIAL_RAMP.join(",")})` }}
            />
            <span className="text-xs text-slate-400">100 %</span>
            <span className="ml-2 flex items-center gap-1.5 text-xs text-slate-400">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: NO_DATA_COLOR }} />
              Aucune donnée
            </span>
          </div>
        </div>

        <Card title={selected?.label ?? "Aucune sélection"}>
          {selected ? (
            selected.orphan ? (
              <p className="text-xs text-amber-600">Non couvert par le référentiel Spelc.</p>
            ) : selected.row ? (
              <div className="space-y-1 text-sm">
                <p className="text-2xl font-semibold text-slate-900">
                  {formatPercentOrDash(selected.row[metric] as number, selected.row[metricDef.inscritsKey] as number)}
                </p>
                <p className="text-xs text-slate-500">{metricDef.label}</p>
                <p className="mt-2 text-slate-600">
                  {selected.row[metricDef.votantsKey]} votants / {selected.row[metricDef.inscritsKey]} inscrits
                </p>
              </div>
            ) : (
              <p className="text-xs text-slate-400">Aucune donnée.</p>
            )
          ) : (
            <p className="text-xs text-slate-400">Survolez la carte pour afficher le détail.</p>
          )}
        </Card>
      </div>

      {overseasRows.length > 0 && (
        <Card title="Outre-mer" subtitle="Académies ultramarines, non représentées sur la carte de métropole ci-dessus.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {overseasRows.map((n) => (
              <div key={n.label} className="rounded-md border border-slate-200 p-3">
                <p className="mb-1 text-sm font-semibold text-slate-800">{n.label}</p>
                <p className="text-lg font-semibold text-slate-900">
                  {formatPercentOrDash(n[metric] as number, n[metricDef.inscritsKey] as number)}
                </p>
                <p className="text-xs text-slate-400">{metricDef.label}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <p className="text-xs text-slate-400">
        Fond de carte reconstitué par union des contours départementaux officiels (académies post-réforme 2020),
        projection équirectangulaire simplifiée à vocation illustrative — même fond que l'onglet « Résultats CCM
        2022 ».
      </p>
    </div>
  );
}
