const MAX_LENGTH = 11;

/**
 * Nom d'expéditeur SMS alphanumérique : Brevo (comme la norme GSM 03.38
 * sous-jacente) exige au maximum 11 caractères, uniquement des lettres et
 * des chiffres (ni espace, ni accent, ni caractère spécial), et au moins une
 * lettre — un nom purement numérique serait interprété comme un numéro court
 * plutôt qu'un expéditeur alphanumérique.
 */
export function isValidSmsSender(value: string): boolean {
  return /^[A-Za-z0-9]{1,11}$/.test(value) && /[A-Za-z]/.test(value);
}

/**
 * Expéditeur par défaut suggéré à partir du nom du Spelc : "Spelc" suivi du
 * nom (accents et espaces retirés, car non autorisés), tronqué pour tenir
 * dans la limite de 11 caractères.
 */
export function suggestSmsSender(spelcName: string): string {
  const clean = spelcName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]/g, "");
  return `Spelc${clean}`.slice(0, MAX_LENGTH);
}
