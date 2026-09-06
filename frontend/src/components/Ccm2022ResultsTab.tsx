import { useState } from "react";
import { CCM_2022_ACADEMIE_MAP, type CcmOsEntry } from "../data/ccm2022AcademieMap";
import { CCM_2022_SPELCS } from "../data/ccm2022Breakdowns";
import { OS_COLORS, OS_LABELS, TABLE_OS, formatVotes, votesFor } from "../lib/ccm2022";
import { Card } from "./Card";

type Scrutin = "1D" | "2D";

interface Props {
  /** "academie" pour un admin académique, "spelc" pour un admin Spelc. */
  mode: "academie" | "spelc";
  /** Nom de l'académie ou du Spelc du compte connecté. */
  value: string;
}

function entriesFor(academie: string, scrutin: Scrutin): CcmOsEntry[] {
  const info = CCM_2022_ACADEMIE_MAP.academies[academie];
  if (info) return info[scrutin];
  return CCM_2022_ACADEMIE_MAP.overseas[scrutin][academie] ?? [];
}

export function Ccm2022ResultsTab({ mode, value }: Props) {
  const [scrutin, setScrutin] = useState<Scrutin>("1D");

  // Une académie du compte est directe ; un Spelc peut, dans un seul cas connu
  // (Centre-Poitou-Charente), chevaucher deux académies réelles (Poitiers et
  // Orléans-Tours) — on affiche alors les deux résultats séparément plutôt
  // qu'un total unique qui mélangerait deux élections distinctes.
  const academies = mode === "academie" ? [value] : CCM_2022_SPELCS.find((s) => s.name === value)?.academies ?? [];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-800">Résultats CCM 2022 — {value}</h3>
        <p className="mt-1 text-xs text-slate-500">
          Nombre de voix et de sièges obtenus par chaque organisation syndicale
          {mode === "academie" ? " dans cette académie" : " pour ce Spelc"}. Référence historique fixe, sans lien
          avec le scrutin 2026 en cours de suivi.
        </p>
        <div className="mt-3 inline-flex rounded-md border border-slate-200 bg-slate-50 p-1">
          {(["1D", "2D"] as Scrutin[]).map((s) => (
            <button
              key={s}
              onClick={() => setScrutin(s)}
              className={`rounded px-3 py-1 text-sm font-medium ${
                scrutin === s ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {s === "1D" ? "1er degré" : "2nd degré"}
            </button>
          ))}
        </div>
      </div>

      {academies.length === 0 && (
        <Card>
          <p className="text-sm text-slate-400">Aucune donnée 2022 disponible pour « {value} ».</p>
        </Card>
      )}

      {academies.map((academie) => {
        const entries = entriesFor(academie, scrutin).filter((e) => e.sieges > 0 || e.votes > 0);
        const total = TABLE_OS.reduce((sum, os) => sum + votesFor(entries, os), 0);
        return (
          <Card
            key={academie}
            title={
              academies.length > 1
                ? `Académie de ${academie}`
                : `${scrutin === "1D" ? "1er degré" : "2nd degré"} — académie de ${academie}`
            }
          >
            {entries.length ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
                    <th className="py-1.5 pr-4 font-medium">Organisation</th>
                    <th className="py-1.5 px-3 text-right font-medium">Sièges</th>
                    <th className="py-1.5 pl-3 text-right font-medium">Voix</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.os} className="border-b border-slate-100 last:border-0">
                      <td className="flex items-center gap-2 py-1.5 pr-4">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: OS_COLORS[e.os] }} />
                        {OS_LABELS[e.os] ?? e.os}
                      </td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{e.sieges}</td>
                      <td className="py-1.5 pl-3 text-right tabular-nums text-slate-500">{formatVotes(e.votes)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-200 font-semibold text-slate-800">
                    <td className="py-1.5 pr-4">Total</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">
                      {entries.reduce((sum, e) => sum + e.sieges, 0)}
                    </td>
                    <td className="py-1.5 pl-3 text-right tabular-nums">{formatVotes(total)}</td>
                  </tr>
                </tfoot>
              </table>
            ) : (
              <p className="text-sm text-slate-400">Aucune donnée pour ce scrutin.</p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
