const DOM_PREFIXES = ["971", "972", "973", "974", "976", "978"];

/**
 * Dérive le département d'un code postal déjà isolé (5 chiffres, zéro
 * initial inclus, ex. "97404" ou "30100") : les 3 premiers caractères pour
 * les DOM (971, 972, 973, 974, 976, 978), les 2 premiers sinon. Partagée
 * entre extractDepartement() (code postal à repérer dans un texte libre) et
 * tout appelant qui dispose déjà d'un champ code postal dédié et propre
 * (ex. le fichier des électeurs CCMMEP, qui a un champ codePostal séparé).
 */
export function departementFromPostalCode(postal: string): string {
  const prefix3 = postal.slice(0, 3);
  return DOM_PREFIXES.includes(prefix3) ? prefix3 : postal.slice(0, 2);
}

/**
 * Extrait le département à partir du champ "affectation" (ex :
 * "COLLEGE X 97404 ST DENIS CEDEX"). On repère le code postal (5 chiffres)
 * dans la chaîne, puis on en dérive le département (voir
 * departementFromPostalCode()).
 *
 * Repli sur un nombre à 4 chiffres (zéro initial reconstitué) si aucun code
 * à 5 chiffres n'est trouvé : pour les départements métropolitains 01 à 09,
 * le zéro initial du code postal est parfois perdu en amont (valeur
 * numérique, ex. "1500" pour "01500" dans le fichier source CCMMEP) — ne
 * s'applique qu'en l'absence de code à 5 chiffres, pour ne jamais prendre un
 * autre nombre à 4 chiffres de l'adresse à la place d'un vrai code postal.
 */
export function extractDepartement(affectation: string | null | undefined): string | null {
  if (!affectation) return null;
  const match5 = affectation.match(/\b(\d{5})\b/);
  let postal: string | null = null;
  if (match5) {
    postal = match5[1];
  } else {
    const match4 = affectation.match(/\b(\d{4})\b/);
    postal = match4 ? `0${match4[1]}` : null;
  }
  if (!postal) return null;
  return departementFromPostalCode(postal);
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
