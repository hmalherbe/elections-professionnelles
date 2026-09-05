/**
 * Normalise un numéro de mobile français vers le format international sans
 * "+" attendu par l'API SMS de Brevo (ex. "06 20 05 38 11" -> "33620053811").
 * Un numéro français saisi au format national (0X XX XX XX XX) est rejeté
 * tel quel par Brevo, qui exige l'indicatif pays.
 */
export function normalizeFrenchMobile(raw: string): string {
  const digits = raw.replace(/[^0-9+]/g, "");
  if (digits.startsWith("+33")) return digits.slice(1);
  if (digits.startsWith("0033")) return digits.slice(2);
  if (digits.startsWith("33")) return digits;
  if (digits.startsWith("0")) return `33${digits.slice(1)}`;
  return digits;
}
