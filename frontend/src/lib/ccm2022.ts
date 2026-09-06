import type { CcmOsEntry } from "../data/ccm2022AcademieMap";

export const OS_LABELS: Record<string, string> = {
  CFDT: "Fep-CFDT",
  CFTC: "CFTC",
  CGT: "CGT Educ'action",
  SPELC: "Spelc",
  Autres: "Autres",
};

// Palette dédiée aux résultats CCM 2022 : 4 teintes validées colorblind-safe en
// comparaison "toutes paires" (choroplethe), au-delà de ce que la palette
// générale de l'appli (lib/colors.ts, prévue pour des séries adjacentes) peut
// garantir.
export const OS_COLORS: Record<string, string> = {
  CFDT: "#2261dd",
  CFTC: "#cd5800",
  CGT: "#a2008f",
  SPELC: "#009476",
  Autres: "#8a9088",
};

export const TABLE_OS = ["CFDT", "CFTC", "CGT", "SPELC", "Autres"] as const;

export function leaderInfo(entries: CcmOsEntry[]): { leaders: CcmOsEntry[]; tie: boolean } {
  if (!entries.length) return { leaders: [], tie: false };
  const top = entries[0].sieges;
  const leaders = entries.filter((e) => e.sieges === top);
  return { leaders, tie: leaders.length > 1 };
}

export function formatVotes(n: number): string {
  return n.toLocaleString("fr-FR");
}

export function votesFor(entries: CcmOsEntry[], os: string): number {
  return entries.find((e) => e.os === os)?.votes ?? 0;
}
