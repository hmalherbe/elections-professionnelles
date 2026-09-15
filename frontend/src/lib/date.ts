/**
 * Les colonnes horodatées de la base (created_at, uploaded_at, imported_at...)
 * sont écrites via `datetime('now')` de SQLite, qui renvoie l'heure UTC sous
 * la forme "AAAA-MM-JJ HH:MM:SS" — sans indicateur de fuseau. `new Date()`
 * traite cette forme comme une heure LOCALE (faute de "Z" ou de "T"), donc un
 * affichage direct via `new Date(valeur).toLocaleString()` retombe en retard
 * de l'écart UTC/local (2h en France en été) au lieu de le compenser.
 */
export function parseSqliteUtc(value: string): Date {
  return new Date(`${value.replace(" ", "T")}Z`);
}
