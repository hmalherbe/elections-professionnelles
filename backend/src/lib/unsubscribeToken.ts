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

// 12 caractères base64url (~72 bits) : largement suffisant pour ce niveau de
// risque (désinscrire quelqu'un n'expose aucune donnée, au pire un
// inconvénient mineur) — court exprès pour économiser des caractères dans un
// SMS (voir buildUnsubscribeUrl).
const TOKEN_LENGTH = 12;

function sign(contact: string): string {
  return crypto.createHmac("sha256", SECRET).update(contact).digest("base64url").slice(0, TOKEN_LENGTH);
}

export function canalFromContact(contact: string): "mail" | "sms" {
  return contact.includes("@") ? "mail" : "sms";
}

export function unsubscribeToken(contact: string): string {
  return sign(contact);
}

export function verifyUnsubscribeToken(contact: string, token: string): boolean {
  const expected = sign(contact);
  // Longueurs égales par construction (12 caractères fixes) : timingSafeEqual
  // exige des buffers de même taille, jamais déclenché par une entrée
  // utilisateur de longueur différente puisqu'on compare à `expected`, pas
  // l'inverse.
  return (
    token.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(token, "utf-8"), Buffer.from(expected, "utf-8"))
  );
}

/**
 * URL de désinscription à insérer dans un modèle de mail/SMS (champ
 * {{lien_desinscription}}, voir routes/brevo.ts templateFieldsFor) — absolue
 * via PUBLIC_BASE_URL (déjà utilisée pour les liens de pièces jointes/logos),
 * indispensable pour un lien cliqué depuis un client mail ou un SMS. Chemin
 * et paramètres volontairement très courts (/api/u?c=...&t=...) : chaque
 * caractère compte dans un SMS (160 par segment GSM-7, facturé au segment).
 */
export function buildUnsubscribeUrl(contact: string): string {
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  const token = unsubscribeToken(contact);
  return `${base}/api/u?c=${encodeURIComponent(contact)}&t=${token}`;
}
