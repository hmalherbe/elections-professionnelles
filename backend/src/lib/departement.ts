const DOM_PREFIXES = ["971", "972", "973", "974", "976", "978"];

/**
 * Extrait le département à partir du champ "affectation" (ex :
 * "COLLEGE X 97404 ST DENIS CEDEX"). On repère le code postal (5 chiffres)
 * dans la chaîne, puis on prend les 3 premiers caractères pour les DOM
 * (971, 972, 973, 974, 976, 978) et les 2 premiers sinon.
 */
export function extractDepartement(affectation: string | null | undefined): string | null {
  if (!affectation) return null;
  const match = affectation.match(/\b(\d{5})\b/);
  if (!match) return null;
  const postal = match[1];
  const prefix3 = postal.slice(0, 3);
  if (DOM_PREFIXES.includes(prefix3)) return prefix3;
  return postal.slice(0, 2);
}
