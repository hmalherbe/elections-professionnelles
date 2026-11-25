import crypto from "node:crypto";

/**
 * Jeton de désinscription (mail) : signature HMAC du contact seul,
 * vérifiable sans avoir besoin de stocker un jeton par destinataire à
 * l'avance — recalculée à la volée côté serveur à chaque clic sur le lien.
 * Même secret que lib/crypto.ts (clé API Brevo chiffrée), nommage différent
 * ici pour ne pas suggérer un lien avec le chiffrement des clés API.
 */
const SECRET = process.env.SECRET_KEY || process.env.JWT_SECRET || "dev-secret-change-me";

const TOKEN_LENGTH = 12;

function sign(contact: string): string {
  return crypto.createHmac("sha256", SECRET).update(contact).digest("base64url").slice(0, TOKEN_LENGTH);
}

export function unsubscribeToken(contact: string): string {
  return sign(contact);
}

export function verifyUnsubscribeToken(contact: string, token: string): boolean {
  const expected = sign(contact);
  return (
    token.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(token, "utf-8"), Buffer.from(expected, "utf-8"))
  );
}

/**
 * URL de désinscription à insérer dans le modèle de mail (champ
 * {{lien_desinscription}}, voir routes/brevo.ts templateFieldsFor) —
 * absolue via PUBLIC_BASE_URL, indispensable pour un lien cliqué depuis un
 * client mail.
 */
export function buildUnsubscribeUrl(contact: string): string {
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  const token = unsubscribeToken(contact);
  return `${base}/api/u?c=${encodeURIComponent(contact)}&t=${token}`;
}
