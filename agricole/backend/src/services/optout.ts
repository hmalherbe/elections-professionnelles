import { db } from "../db/index.js";

export function isOptedOut(contact: string): boolean {
  const row = db.prepare("SELECT 1 FROM relance_optout WHERE contact = ?").get(contact);
  return Boolean(row);
}

/** Idempotent : cliquer plusieurs fois sur le même lien ne change rien après le premier clic. */
export function recordOptOut(contact: string): void {
  db.prepare("INSERT OR IGNORE INTO relance_optout (contact) VALUES (?)").run(contact);
}

export interface OptOutRow {
  contact: string;
  createdAt: string;
}

export function listOptOuts(): OptOutRow[] {
  return db.prepare("SELECT contact, created_at AS createdAt FROM relance_optout ORDER BY created_at DESC").all() as OptOutRow[];
}

/** Permet à un admin de réinscrire quelqu'un par erreur désinscrit. */
export function removeOptOut(contact: string): boolean {
  return db.prepare("DELETE FROM relance_optout WHERE contact = ?").run(contact).changes > 0;
}
