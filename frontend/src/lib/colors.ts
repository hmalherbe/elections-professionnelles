export const COLOR_VOTANT = "#059669";
export const COLOR_NON_VOTANT = "#cbd5e1";
export const CATEGORICAL = ["#2563eb", "#7c3aed", "#d97706", "#e11d48", "#0d9488", "#4f46e5", "#ca8a04", "#0891b2"];

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)} %`;
}
