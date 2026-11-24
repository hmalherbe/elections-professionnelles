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

/** Caractères distincts (par ordre de première apparition) absents de
 * l'alphabet GSM-7 — ceux qui, à eux seuls, forcent tout le message en
 * UCS-2 (voir gsm7Length) — pour expliquer à l'admin, dans l'aperçu, POURQUOI
 * un message en apparence plus court peut coûter plus de crédits qu'un
 * message plus long resté en GSM-7. */
function offendingChars(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const ch of text) {
    if (!GSM7_BASIC.includes(ch) && !GSM7_EXTENDED.includes(ch) && !seen.has(ch)) {
      seen.add(ch);
      result.push(ch);
    }
  }
  return result;
}

export interface SmsEncodingInfo {
  encoding: "GSM-7" | "UCS-2";
  /** Crédits Brevo, approximativement (voir smsSegmentCount). */
  segments: number;
  /** Capacité d'un segment pour cet encodage et ce nombre de segments
   * (160/70 pour un SMS simple, 153/67 par partie au-delà). */
  maxCharsPerSegment: number;
  /** Caractères ayant forcé l'encodage UCS-2 ; tableau vide si GSM-7. */
  offendingChars: string[];
}

/**
 * Détaille l'encodage réel d'un message (GSM-7 ou UCS-2), le nombre de
 * segments qui en résulte et, si UCS-2, les caractères responsables — pour
 * affichage dans l'aperçu SMS (sans ce détail, un message de 92 caractères
 * facturé 2 crédits alors qu'un message de 101 caractères n'en coûte qu'1
 * semble incohérent : seul l'encodage, pas la longueur brute, détermine la
 * taille d'un segment).
 */
export function analyzeSmsEncoding(text: string): SmsEncodingInfo {
  const gsm = gsm7Length(text);
  if (gsm !== null) {
    const segments = gsm <= 160 ? 1 : Math.ceil(gsm / 153);
    return { encoding: "GSM-7", segments, maxCharsPerSegment: segments <= 1 ? 160 : 153, offendingChars: [] };
  }
  const length = [...text].length;
  const segments = length <= 70 ? 1 : Math.ceil(length / 67);
  return { encoding: "UCS-2", segments, maxCharsPerSegment: segments <= 1 ? 70 : 67, offendingChars: offendingChars(text) };
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
  return analyzeSmsEncoding(text).segments;
}
