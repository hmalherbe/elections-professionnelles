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

/**
 * Extrait le département à partir du code RNE/UAI de l'établissement (ex :
 * "0751234A" pour un établissement parisien). Structure du code : les 3
 * premiers chiffres codent le département (zéro initial pour la métropole,
 * ex. "075" = Paris, "002" = Aisne ; déjà sur 3 chiffres pour les DOM, ex.
 * "971" = Guadeloupe), suivis de 4 chiffres de numéro d'ordre et d'une
 * lettre de clé de contrôle. On exige ce format strict (7 chiffres + 1
 * lettre) pour éviter de prendre pour un RNE une valeur qui n'en est pas
 * une — à la différence de extractDepartement(), qui cherche un code
 * postal dans un texte libre, ce champ est normalement dédié et structuré.
 *
 * Nom de champ à confirmer dès réception du format réel du fichier CCMMEP
 * (voir RawEmargementItem.rne dans parsers/emargements.ts) ; ne couvre pas
 * le cas particulier des codes RNE corses ("2A"/"2B"), au même niveau de
 * simplification que extractDepartement() pour les codes postaux en 20xxx.
 */
export function extractDepartementFromRne(rne: string | null | undefined): string | null {
  if (!rne) return null;
  const match = rne.trim().toUpperCase().match(/^(\d{7})[A-Z]$/);
  if (!match) return null;
  const prefix3 = match[1].slice(0, 3);
  if (DOM_PREFIXES.includes(prefix3)) return prefix3;
  // Départements métropolitains : toujours "0" + le code à 2 chiffres
  // (01 à 95) dans un RNE — on retire ce premier caractère pour retomber
  // sur le même format à 2 chiffres (avec zéro initial conservé, ex. "02")
  // que extractDepartement() et la table de référence ref_departements.
  return prefix3.slice(1);
}
