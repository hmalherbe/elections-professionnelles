import type { ReactNode } from "react";

export function Card({
  title,
  subtitle,
  action,
  children,
}: {
  title?: string;
  subtitle?: string;
  /** Élément optionnel affiché à droite du titre (ex. un bouton d'action). */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      {(title || action) && (
        <div className="flex items-start justify-between gap-2">
          {title && <h3 className="text-sm font-semibold text-slate-800">{title}</h3>}
          {action}
        </div>
      )}
      {subtitle && <p className="mb-2 text-xs text-slate-500">{subtitle}</p>}
      {children}
    </div>
  );
}
