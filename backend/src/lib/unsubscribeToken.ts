import crypto from "node:crypto";

/**
 * Jeton de désinscription (mail/SMS) : signature HMAC du contact seul,
 * vérifiable sans avoir besoin de stocker un jeton par destinataire à
 * l'avance — recalculée à la volée côté serveur à chaque clic sur le lien.
 * Même secret que lib/crypto.ts (clé API Brevo chiffrée), nommage différent
 * ici pour ne pas suggérer un lien avec le chiffrement des clés API. Pas de
 * canal dans la signature : un contact mail contient toujours "@", un
 * mobile jamais (voir canalFromContact) — le format du contact suffit déjà à
 * distinguer les deux, inutile de le répéter dans l'entrée du HMAC.
 */
const SECRET = process.env.SCRAPING_SECRET_KEY || process.env.JWT_SECRET || "dev-secret-change-me";

// 8 caractères base64url (~48 bits) : largement suffisant pour ce niveau de
// risque (désinscrire quelqu'un n'expose aucune donnée, au pire un
// inconvénient mineur) — court exprès pour économiser des caractères dans un
// SMS (voir buildUnsubscribeUrl). 12 : ancienne longueur, conservée pour que
// les liens déjà envoyés (mails/SMS déjà reçus avant ce raccourcissement)
// restent valides — voir verifyUnsubscribeToken.
const TOKEN_LENGTH = 8;
const LEGACY_TOKEN_LENGTH = 12;

/** Signature complète (jamais tronquée) : unsubscribeToken()/verifyUnsubscribeToken()
 * en prennent chacun un préfixe, toujours le même pour un contact donné. */
function fullSignature(contact: string): string {
  return crypto.createHmac("sha256", SECRET).update(contact).digest("base64url");
}

export function canalFromContact(contact: string): "mail" | "sms" {
  return contact.includes("@") ? "mail" : "sms";
}

export function unsubscribeToken(contact: string): string {
  return fullSignature(contact).slice(0, TOKEN_LENGTH);
}

/** Accepte un jeton à la longueur courante (8) ou à l'ancienne (12) — les deux
 * sont des préfixes de la même signature, donc un jeton de 8 caractères est
 * automatiquement valide pour un contact dont le jeton long a été calculé
 * plus tôt. Toute autre longueur est rejetée d'emblée (jamais une simple
 * troncature arbitraire à comparer). */
export function verifyUnsubscribeToken(contact: string, token: string): boolean {
  if (token.length !== TOKEN_LENGTH && token.length !== LEGACY_TOKEN_LENGTH) return false;
  const expected = fullSignature(contact).slice(0, token.length);
  return crypto.timingSafeEqual(Buffer.from(token, "utf-8"), Buffer.from(expected, "utf-8"));
}

/**
 * Un mobile français normalisé (voir lib/phone.ts) commence toujours par
 * "33" — le signaler dans l'URL n'apporte rien (toujours le même pays pour
 * cette application) : on le retire du segment d'URL (reconstruit à la
 * volée par expandContactParam) pour économiser 2 caractères sur chaque SMS.
 * Un contact mail, lui, passe tel quel (encodé pour l'URL).
 */
function shortenContactParam(contact: string): string {
  return /^33\d+$/.test(contact) ? contact.slice(2) : encodeURIComponent(contact);
}

/** Inverse de shortenContactParam() : reconstruit le contact complet
 * (identique à celui signé par unsubscribeToken) à partir du segment d'URL. */
export function expandContactParam(contactParam: string): string {
  return /^\d+$/.test(contactParam) ? `33${contactParam}` : decodeURIComponent(contactParam);
}

/**
 * URL de désinscription à insérer dans un modèle de mail/SMS (champ
 * {{lien_desinscription}}, voir routes/brevo.ts templateFieldsFor) — absolue
 * via PUBLIC_BASE_URL (déjà utilisée pour les liens de pièces jointes/logos),
 * indispensable pour un lien cliqué depuis un client mail ou un SMS. Chemin
 * volontairement très court (/u/<contact>/<jeton>, voir infra/nginx.conf
 * pour la réécriture vers /api/u) : chaque caractère compte dans un SMS (160
 * par segment GSM-7, facturé au segment).
 */
export function buildUnsubscribeUrl(contact: string): string {
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  const token = unsubscribeToken(contact);
  return `${base}/u/${shortenContactParam(contact)}/${token}`;
}
