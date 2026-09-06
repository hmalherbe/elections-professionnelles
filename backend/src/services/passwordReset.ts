import crypto from "node:crypto";
import { db } from "../db/index.js";
import { sendBrevoEmails } from "./brevo.js";
import { wrapEmailHtml } from "../lib/emailLayout.js";

const TOKEN_BYTES = 32;
const EXPIRY_MINUTES = 60;

function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Un seul lien de réinitialisation valide à la fois par utilisateur : toute
 * demande antérieure encore active (non utilisée, non expirée) est
 * invalidée par la nouvelle, pour qu'un e-mail plus ancien retrouvé plus
 * tard dans une boîte de réception ne fonctionne plus.
 */
export function createPasswordResetToken(userId: number): string {
  db.prepare(`DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL`).run(userId);
  const rawToken = crypto.randomBytes(TOKEN_BYTES).toString("hex");
  const expiresAt = new Date(Date.now() + EXPIRY_MINUTES * 60 * 1000).toISOString();
  db.prepare(`INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)`).run(
    userId,
    hashToken(rawToken),
    expiresAt
  );
  return rawToken;
}

interface ResetRow {
  id: number;
  user_id: number;
  expires_at: string;
  used_at: string | null;
}

/** Consomme un token (marque utilisé) et renvoie l'id utilisateur, ou null si invalide/expiré/déjà utilisé. */
export function consumePasswordResetToken(rawToken: string): number | null {
  const row = db
    .prepare(`SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?`)
    .get(hashToken(rawToken)) as ResetRow | undefined;
  if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) return null;
  db.prepare(`UPDATE password_resets SET used_at = datetime('now') WHERE id = ?`).run(row.id);
  return row.user_id;
}

/**
 * Clé Brevo dédiée aux e-mails système (réinitialisation de mot de passe) :
 * contrairement aux clés Brevo personnelles des admins (users.brevo_api_key,
 * utilisées pour leurs campagnes de relance), cet envoi doit fonctionner
 * même si le compte concerné — ou l'admin général — n'a configuré aucune
 * clé personnelle.
 */
export async function sendPasswordResetEmail(email: string, resetUrl: string): Promise<void> {
  const apiKey = process.env.SYSTEM_EMAIL_BREVO_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Envoi d'e-mail système non configuré (SYSTEM_EMAIL_BREVO_API_KEY manquante) : contactez l'administrateur."
    );
  }
  const bodyHtml =
    `<p>Une demande de réinitialisation de mot de passe a été effectuée pour ce compte.</p>` +
    `<p><a href="${resetUrl}" style="display:inline-block;padding:10px 20px;background:#059669;color:#ffffff;` +
    `text-decoration:none;border-radius:6px;">Choisir un nouveau mot de passe</a></p>` +
    `<p>Ce lien est valable ${EXPIRY_MINUTES} minutes et ne peut être utilisé qu'une seule fois.</p>` +
    `<p>Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet e-mail : votre mot de passe restera inchangé.</p>`;
  const result = await sendBrevoEmails({
    apiKey,
    to: [{ email }],
    subject: "Réinitialisation de votre mot de passe — Élections professionnelles",
    htmlContent: wrapEmailHtml(bodyHtml),
    tag: "password-reset",
  });
  if (result.errors > 0) {
    throw new Error(result.errorMessage ?? "Échec de l'envoi de l'e-mail de réinitialisation.");
  }
}
