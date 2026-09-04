export function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function normalizeName(value: string | null | undefined): string {
  if (!value) return "";
  return stripAccents(value)
    .toUpperCase()
    .replace(/[^A-Z\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeKey(value: string | null | undefined): string {
  if (!value) return "";
  return stripAccents(value).toLowerCase().trim();
}
