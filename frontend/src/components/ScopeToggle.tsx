export function ScopeToggle({
  scope,
  onChange,
}: {
  scope: "national" | "academique";
  onChange: (scope: "national" | "academique") => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-sm">
      <button
        className={`rounded px-3 py-1 ${scope === "national" ? "bg-emerald-600 text-white" : "text-slate-600"}`}
        onClick={() => onChange("national")}
      >
        Scrutin national (CCMMEP)
      </button>
      <button
        className={`rounded px-3 py-1 ${scope === "academique" ? "bg-emerald-600 text-white" : "text-slate-600"}`}
        onClick={() => onChange("academique")}
      >
        Scrutin local
      </button>
    </div>
  );
}
