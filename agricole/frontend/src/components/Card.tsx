import type { ReactNode } from "react";

export function Card({ title, subtitle, children }: { title?: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      {title && <h3 className="text-sm font-semibold text-slate-800">{title}</h3>}
      {subtitle && <p className="mb-2 text-xs text-slate-500">{subtitle}</p>}
      {children}
    </div>
  );
}
