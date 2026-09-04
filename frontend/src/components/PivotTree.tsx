import { Fragment, useState } from "react";
import { Card } from "./Card";
import { formatPercent } from "../lib/colors";
import type { AcademieNode } from "../lib/types";

function Bar({ taux }: { taux: number }) {
  return (
    <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-100">
      <div className="h-full bg-emerald-600" style={{ width: `${Math.min(taux * 100, 100)}%` }} />
    </div>
  );
}

export function PivotTree({ tree }: { tree: AcademieNode[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());

  function toggle(label: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  return (
    <Card title="Participation par académie (cascade par Spelc)">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
              <th className="py-2 pr-4">Académie / Spelc</th>
              <th className="px-4 py-2">Inscrits</th>
              <th className="px-4 py-2">Votants</th>
              <th className="px-4 py-2">Taux</th>
            </tr>
          </thead>
          <tbody>
            {tree.map((node) => (
              <Fragment key={node.label}>
                <tr className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => toggle(node.label)}>
                  <td className="py-2 pr-4 font-medium text-slate-800">
                    <span className="mr-1 inline-block w-3 text-slate-400">{open.has(node.label) ? "▾" : "▸"}</span>
                    {node.label}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{node.inscrits.toLocaleString("fr-FR")}</td>
                  <td className="px-4 py-2 text-slate-600">{node.votants.toLocaleString("fr-FR")}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <Bar taux={node.taux} />
                      <span className="text-slate-600">{formatPercent(node.taux)}</span>
                    </div>
                  </td>
                </tr>
                {open.has(node.label) &&
                  node.spelcs.map((s) => (
                    <tr key={node.label + s.label} className="border-b border-slate-50 bg-slate-50/60">
                      <td className="py-1.5 pl-8 pr-4 text-slate-600">{s.label}</td>
                      <td className="px-4 py-1.5 text-slate-500">{s.inscrits.toLocaleString("fr-FR")}</td>
                      <td className="px-4 py-1.5 text-slate-500">{s.votants.toLocaleString("fr-FR")}</td>
                      <td className="px-4 py-1.5">
                        <div className="flex items-center gap-2">
                          <Bar taux={s.taux} />
                          <span className="text-slate-500">{formatPercent(s.taux)}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
              </Fragment>
            ))}
          </tbody>
        </table>
        {tree.length === 0 && <p className="py-4 text-sm text-slate-400">Aucune donnée importée.</p>}
      </div>
    </Card>
  );
}
