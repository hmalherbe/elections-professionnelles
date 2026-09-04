/**
 * Parse une date d'émargement. Les fichiers observés utilisent
 * "AAAAMMJJ HH:MM:SS" ; la spécification mentionne aussi "AAMMJJ HHMMSS".
 * On gère les deux formats de façon tolérante. Retourne un ISO string ou
 * null si la valeur est absente/invalide (= non émargé).
 */
export function parseDateEmargement(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  const [datePart, timePartRaw] = raw.trim().split(/\s+/, 2);
  if (!datePart) return null;
  const timePart = (timePartRaw ?? "").replace(/:/g, "");

  let year: number;
  let month: number;
  let day: number;
  if (datePart.length === 8) {
    year = Number(datePart.slice(0, 4));
    month = Number(datePart.slice(4, 6));
    day = Number(datePart.slice(6, 8));
  } else if (datePart.length === 6) {
    year = 2000 + Number(datePart.slice(0, 2));
    month = Number(datePart.slice(2, 4));
    day = Number(datePart.slice(4, 6));
  } else {
    return null;
  }

  const hh = Number(timePart.slice(0, 2) || "0");
  const mm = Number(timePart.slice(2, 4) || "0");
  const ss = Number(timePart.slice(4, 6) || "0");

  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day, hh, mm, ss));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
