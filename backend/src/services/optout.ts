import { db } from "../db/index.js";
import { normalizeFrenchMobile } from "../lib/phone.js";

export type Canal = "mail" | "sms";

export function isOptedOut(canal: Canal, contact: string): boolean {
  const row = db.prepare("SELECT 1 FROM relance_optout WHERE canal = ? AND contact = ?").get(canal, contact);
  return Boolean(row);
}

/** Idempotent : cliquer plusieurs fois sur le même lien ne change rien après le premier clic. */
export function recordOptOut(canal: Canal, contact: string): void {
  db.prepare("INSERT OR IGNORE INTO relance_optout (canal, contact) VALUES (?, ?)").run(canal, contact);
}

/**
 * Se désinscrire d'un canal désinscrit aussi l'autre canal, via l'adhérent
 * lié (même ligne `adherents`, qui porte mail ET mobile) — une personne ne
 * veut généralement plus être relancée du tout, pas seulement sur le canal
 * depuis lequel elle a cliqué. Retrouve tous les adhérents (tous Spelc
 * confondus : une même personne peut apparaître dans plusieurs fichiers)
 * partageant ce contact, et désinscrit leur autre contact s'il existe.
 */
export function recordOptOutBothChannels(canal: Canal, contact: string): void {
  recordOptOut(canal, contact);

  if (canal === "mail") {
    const rows = db
      .prepare("SELECT DISTINCT mobile FROM adherents WHERE mobile IS NOT NULL AND LOWER(TRIM(mail)) = ?")
      .all(contact) as { mobile: string }[];
    for (const r of rows) recordOptOut("sms", normalizeFrenchMobile(r.mobile));
  } else {
    // mobile non normalisé en base (saisie libre) : comparaison en mémoire,
    // pas d'index possible — volume borné au nombre total d'adhérents avec
    // mobile, acceptable pour une action rare (un clic de désinscription).
    const rows = db.prepare("SELECT DISTINCT mail, mobile FROM adherents WHERE mobile IS NOT NULL AND mail IS NOT NULL").all() as {
      mail: string;
      mobile: string;
    }[];
    for (const r of rows) {
      if (normalizeFrenchMobile(r.mobile) === contact) recordOptOut("mail", r.mail.trim().toLowerCase());
    }
  }
}

export interface OptOutRow {
  canal: Canal;
  contact: string;
  createdAt: string;
}

export function listOptOuts(): OptOutRow[] {
  return db
    .prepare("SELECT canal, contact, created_at AS createdAt FROM relance_optout ORDER BY created_at DESC")
    .all() as OptOutRow[];
}

/** Permet à un admin général de réinscrire quelqu'un par erreur désinscrit. */
export function removeOptOut(canal: Canal, contact: string): boolean {
  return db.prepare("DELETE FROM relance_optout WHERE canal = ? AND contact = ?").run(canal, contact).changes > 0;
}
