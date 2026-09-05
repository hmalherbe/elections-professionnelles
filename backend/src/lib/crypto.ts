import crypto from "node:crypto";

/**
 * Chiffrement symétrique (AES-256-GCM) pour les mots de passe des portails
 * de scraping stockés en base — jamais en clair. La clé est dérivée d'une
 * chaîne secrète d'environnement (SCRAPING_SECRET_KEY, ou à défaut
 * JWT_SECRET) via SHA-256, pour obtenir 32 octets quelle que soit sa
 * longueur d'origine.
 */
const SECRET = process.env.SCRAPING_SECRET_KEY || process.env.JWT_SECRET || "dev-secret-change-me";
const KEY = crypto.createHash("sha256").update(SECRET).digest();

export function encrypt(plainText: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decrypt(encoded: string): string {
  const buf = Buffer.from(encoded, "base64");
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
}
