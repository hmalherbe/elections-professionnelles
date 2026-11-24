/**
 * Jeu de caractères GSM 03.38 (alphabet par défaut des SMS) : un message
 * entièrement composé de ces caractères est encodé en GSM-7 (160 caractères
 * pour un SMS simple, 153 par partie au-delà, à cause de l'en-tête technique
 * de concaténation) ; dès qu'UN SEUL caractère en est absent (accent non
 * couvert, apostrophe/guillemet typographique ’ “ ”, tiret cadratin, emoji…),
 * l'opérateur bascule l'intégralité du message en UCS-2, où un SMS simple ne
 * fait plus que 70 caractères (67 par partie au-delà) — un simple "’" au
 * lieu de "'" peut ainsi, à lui seul, multiplier le nombre de crédits
 * consommés par 2 ou 3. Jeu "de base" (1 caractère = 1 unité).
 */
const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

/** Jeu "étendu" GSM 03.38 : chaque caractère compte pour 2 unités (précédé
 * d'un caractère d'échappement dans l'encodage réel). */
const GSM7_EXTENDED = "^{}\\[~]|€";

/**
 * Longueur du message en unités GSM-7 (un caractère étendu compte double)
 * si TOUT le message est encodable dans cet alphabet, sinon `null` (le
 * message nécessite l'encodage UCS-2).
 */
function gsm7Length(text: string): number | null {
  let length = 0;
  for (const ch of text) {
    if (GSM7_BASIC.includes(ch)) length += 1;
    else if (GSM7_EXTENDED.includes(ch)) length += 2;
    else return null;
  }
  return length;
}

/**
 * Nombre de segments (= crédits Brevo, approximativement) consommés par ce
 * message, en tenant compte de l'encodage réel (GSM-7 si tous les
 * caractères le permettent, UCS-2 sinon — voir gsm7Length ci-dessus) et des
 * tailles de segment différentes pour un SMS simple vs multi-parties.
 * Approximation standard du secteur SMS : Brevo peut appliquer des règles
 * de facturation propres non documentées publiquement (ex. par pays de
 * destination), donc ce nombre reste indicatif.
 */
export function smsSegmentCount(text: string): number {
  const gsm = gsm7Length(text);
  if (gsm !== null) {
    return gsm <= 160 ? 1 : Math.ceil(gsm / 153);
  }
  const length = [...text].length;
  return length <= 70 ? 1 : Math.ceil(length / 67);
}
