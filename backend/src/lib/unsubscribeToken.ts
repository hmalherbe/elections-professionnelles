import crypto from "node:crypto";

/**
 * Jeton de désinscription (mail/SMS) : signature HMAC de "canal:contact",
 * vérifiable sans avoir besoin de stocker un jeton par destinataire à
 * l'avance — recalculée à la volée côté serveur à chaque clic sur le lien.
 * Même secret que lib/crypto.ts (clé API Brevo chiffrée), nommage différent
 * ici pour ne pas suggérer un lien avec le chiffrement des clés API.
 */
const SECRET = process.env.SCRAPING_SECRET_KEY || process.env.JWT_SECRET || "dev-secret-change-me";

function sign(canal: string, contact: string): string {
  return crypto.createHmac("sha256", SECRET).update(`${canal}:${contact}`).digest("base64url").slice(0, 22);
}

export function unsubscribeToken(canal: "mail" | "sms", contact: string): string {
  return sign(canal, contact);
}

export function verifyUnsubscribeToken(canal: "mail" | "sms", contact: string, token: string): boolean {
  const expected = sign(canal, contact);
  // Longueurs égales par construction (22 caractères fixes) : timingSafeEqual
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
 * indispensable pour un lien cliqué depuis un client mail ou un SMS.
 */
export function buildUnsubscribeUrl(canal: "mail" | "sms", contact: string): string {
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  const token = unsubscribeToken(canal, contact);
  const qs = `canal=${encodeURIComponent(canal)}&contact=${encodeURIComponent(contact)}&token=${token}`;
  return `${base}/api/unsubscribe?${qs}`;
}
