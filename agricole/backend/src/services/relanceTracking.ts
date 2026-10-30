import dayjs from "dayjs";
import { db } from "../db/index.js";
import { fetchEmailEvents, getBrevoApiKey, type BrevoEmailEvent } from "./brevo.js";

export interface RelanceTrackingInput {
  ownerUserId: number;
  campagneTag: string;
  nom: string;
  prenom: string;
  contact: string;
  testMode: boolean;
  sendOk: boolean;
  messageId: string | null;
  errorMessage?: string | null;
}

export function insertRelanceTracking(entry: RelanceTrackingInput): void {
  db.prepare(
    `INSERT INTO relance_tracking
       (owner_user_id, campagne_tag, nom, prenom, contact, test_mode, send_ok, message_id, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.ownerUserId,
    entry.campagneTag,
    entry.nom,
    entry.prenom,
    entry.contact,
    entry.testMode ? 1 : 0,
    entry.sendOk ? 1 : 0,
    entry.messageId,
    entry.errorMessage ?? null
  );
}

export interface RelanceTrackingRow {
  id: number;
  created_at: string;
  owner_user_id: number;
  campagne_tag: string;
  nom: string;
  prenom: string;
  contact: string;
  test_mode: number;
  send_ok: number;
  message_id: string | null;
  error_message: string | null;
  delivery_status: string | null;
  clicked: number;
  clicked_at: string | null;
  opened: number;
  opened_at: string | null;
  last_checked_at: string | null;
}

const EMAIL_FAILURE_STATUSES = new Set(["hardBounces", "blocked", "invalid", "spam"]);

export type StatusLabel = "ok" | "echec" | "en_attente";

export function computeStatusLabel(row: Pick<RelanceTrackingRow, "send_ok" | "delivery_status">): StatusLabel {
  if (!row.send_ok) return "echec";
  if (row.delivery_status && EMAIL_FAILURE_STATUSES.has(row.delivery_status)) return "echec";
  return "ok";
}

function withStatus<T extends RelanceTrackingRow>(row: T): T & { statusLabel: StatusLabel } {
  return { ...row, statusLabel: computeStatusLabel(row) };
}

export function listRelanceTracking(limit = 500): (RelanceTrackingRow & { statusLabel: StatusLabel })[] {
  const rows = db.prepare("SELECT * FROM relance_tracking ORDER BY created_at DESC LIMIT ?").all(limit) as RelanceTrackingRow[];
  return rows.map(withStatus);
}

export function clearRelanceTracking(): number {
  return db.prepare("DELETE FROM relance_tracking").run().changes;
}

export interface MailSeriesPoint {
  date: string;
  total_envoye: number;
  erreurs_envoi: number;
  mails_lus: number;
  liens_clique: number;
}

export function getMailSeries(): MailSeriesPoint[] {
  return db
    .prepare(
      `SELECT date(created_at) AS date,
              SUM(send_ok) AS total_envoye,
              SUM(CASE WHEN send_ok = 0 THEN 1 ELSE 0 END) AS erreurs_envoi,
              SUM(opened) AS mails_lus,
              SUM(clicked) AS liens_clique
       FROM relance_tracking
       GROUP BY date(created_at)
       ORDER BY date(created_at)`
    )
    .all() as MailSeriesPoint[];
}

const POLL_WINDOW_DAYS = 21;

function pendingRows(): RelanceTrackingRow[] {
  const cutoff = dayjs().subtract(POLL_WINDOW_DAYS, "day").toISOString();
  const rows = db
    .prepare("SELECT * FROM relance_tracking WHERE message_id IS NOT NULL AND created_at >= ?")
    .all(cutoff) as RelanceTrackingRow[];
  return rows.filter((r) => {
    if (r.clicked) return false;
    if (r.delivery_status && EMAIL_FAILURE_STATUSES.has(r.delivery_status)) return false;
    return true;
  });
}

const EMAIL_STATUS_PRIORITY = ["hardBounces", "blocked", "invalid", "spam", "softBounces", "delivered", "opened", "sent", "requests", "deferred"];

function pickStatus(events: { event?: string }[], priority: string[]): string | null {
  const present = new Set(events.map((e) => e.event).filter((e): e is string => Boolean(e)));
  return priority.find((s) => present.has(s)) ?? null;
}

function applyUpdate(rowId: number, status: string | null, clicked: boolean, opened: boolean): void {
  const now = new Date().toISOString();
  const sets = ["delivery_status = COALESCE(?, delivery_status)", "last_checked_at = ?"];
  const params: unknown[] = [status, now];
  if (clicked) {
    sets.push("clicked = 1", "clicked_at = COALESCE(clicked_at, ?)");
    params.push(now);
  }
  if (opened) {
    sets.push("opened = 1", "opened_at = COALESCE(opened_at, ?)");
    params.push(now);
  }
  db.prepare(`UPDATE relance_tracking SET ${sets.join(", ")} WHERE id = ?`).run(...params, rowId);
}

function touchLastChecked(rowId: number): void {
  db.prepare(`UPDATE relance_tracking SET last_checked_at = ? WHERE id = ?`).run(new Date().toISOString(), rowId);
}

/**
 * Interroge l'API Brevo pour les relances en attente et met à jour leur
 * statut de livraison / clic / ouverture. Appelée par le sondage
 * automatique périodique (voir index.ts) et par le bouton de
 * rafraîchissement manuel.
 */
export async function refreshPendingRelanceTracking(): Promise<{ checked: number; updated: number }> {
  const rows = pendingRows();
  if (!rows.length) return { checked: 0, updated: 0 };

  const apiKey = getBrevoApiKey();
  if (!apiKey) return { checked: 0, updated: 0 };

  const byTag = new Map<string, RelanceTrackingRow[]>();
  for (const r of rows) {
    if (!byTag.has(r.campagne_tag)) byTag.set(r.campagne_tag, []);
    byTag.get(r.campagne_tag)!.push(r);
  }

  let updated = 0;
  const endDate = dayjs().format("YYYY-MM-DD");

  for (const [tag, tagRows] of byTag.entries()) {
    const oldest = tagRows.reduce((min, r) => (r.created_at < min ? r.created_at : min), tagRows[0].created_at);
    const startDate = dayjs(oldest).format("YYYY-MM-DD");
    const events: BrevoEmailEvent[] = await fetchEmailEvents(apiKey, { tag, startDate, endDate, limit: 500 });
    for (const row of tagRows) {
      const matched = events.filter((e) => e.messageId && e.messageId === row.message_id);
      if (!matched.length) {
        touchLastChecked(row.id);
        continue;
      }
      const clicked = matched.some((e) => e.event === "clicks");
      const opened = matched.some((e) => e.event === "opened" || e.event === "uniqueOpened");
      const status = pickStatus(matched, EMAIL_STATUS_PRIORITY);
      applyUpdate(row.id, status, clicked, opened);
      updated++;
    }
  }

  return { checked: rows.length, updated };
}
