import { db } from "../db/index.js";

export type Canal = "mail" | "sms";

export function isOptedOut(canal: Canal, contact: string): boolean {
  const row = db.prepare("SELECT 1 FROM relance_optout WHERE canal = ? AND contact = ?").get(canal, contact);
  return Boolean(row);
}

/** Idempotent : cliquer plusieurs fois sur le même lien ne change rien après le premier clic. */
export function recordOptOut(canal: Canal, contact: string): void {
  db.prepare("INSERT OR IGNORE INTO relance_optout (canal, contact) VALUES (?, ?)").run(canal, contact);
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
