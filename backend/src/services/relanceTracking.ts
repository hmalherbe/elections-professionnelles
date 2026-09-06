import dayjs from "dayjs";
import { db } from "../db/index.js";
import { fetchEmailEvents, fetchSmsEvents, type BrevoEmailEvent, type BrevoSmsEvent } from "./brevo.js";

export interface RelanceTrackingInput {
  ownerUserId: number;
  type: "mail" | "sms";
  /** Nom du Spelc concerné, ou "PSA" pour une relance PSA. */
  scope: string;
  campagneTag: string;
  nom: string;
  prenom: string;
  contact: string;
  testMode: boolean;
  sendOk: boolean;
  messageId: string | null;
  /** Raison de l'échec d'envoi (voir services/brevo.ts), affichée à l'admin en survol du statut. */
  errorMessage?: string | null;
}

/** Journal par personne, distinct du journal NDJSON (lib/relanceLog.ts) qui reste
 * inchangé : celui-ci est fait pour être mis à jour au fil du temps (statut de
 * livraison final, clics), ce qu'un fichier NDJSON en ajout seul ne permet pas. */
export function insertRelanceTracking(entry: RelanceTrackingInput): void {
  db.prepare(
    `INSERT INTO relance_tracking
       (owner_user_id, type, scope, campagne_tag, nom, prenom, contact, test_mode, send_ok, message_id, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.ownerUserId,
    entry.type,
    entry.scope,
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
  type: "mail" | "sms";
  scope: string;
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
const SMS_FAILURE_STATUSES = new Set(["hardBounces", "blocked"]);

export type StatusLabel = "ok" | "echec" | "en_attente";

/** Statut final affiché : le rejet Brevo (bounce/blocked/invalid) l'emporte
 * toujours sur l'acceptation initiale, qui ne garantissait qu'une prise en
 * charge par Brevo, pas une livraison réelle. */
export function computeStatusLabel(row: Pick<RelanceTrackingRow, "type" | "send_ok" | "delivery_status">): StatusLabel {
  if (!row.send_ok) return "echec";
  if (row.delivery_status) {
    const failureSet = row.type === "mail" ? EMAIL_FAILURE_STATUSES : SMS_FAILURE_STATUSES;
    if (failureSet.has(row.delivery_status)) return "echec";
  }
  return "ok";
}

function withStatus<T extends RelanceTrackingRow>(row: T): T & { statusLabel: StatusLabel } {
  return { ...row, statusLabel: computeStatusLabel(row) };
}

export function listRelanceTrackingByScope(scope: string, limit = 500): (RelanceTrackingRow & { statusLabel: StatusLabel })[] {
  const rows = db
    .prepare("SELECT * FROM relance_tracking WHERE scope = ? ORDER BY created_at DESC LIMIT ?")
    .all(scope, limit) as RelanceTrackingRow[];
  return rows.map(withStatus);
}

export function listAllRelanceTracking(limit = 500): (RelanceTrackingRow & { statusLabel: StatusLabel })[] {
  const rows = db.prepare("SELECT * FROM relance_tracking ORDER BY created_at DESC LIMIT ?").all(limit) as RelanceTrackingRow[];
  return rows.map(withStatus);
}

export interface MailSeriesPoint {
  date: string;
  total_envoye: number;
  erreurs_envoi: number;
  mails_lus: number;
  liens_clique: number;
}

/** Série quotidienne pour la courbe de suivi des mails, calculée à partir du
 * suivi par personne (relance_tracking) — seule source réellement alimentée
 * à chaque envoi, test ou campagne réelle confondus. */
export function getMailSeriesByScope(scope: string): MailSeriesPoint[] {
  return db
    .prepare(
      `SELECT date(created_at) AS date,
              SUM(send_ok) AS total_envoye,
              SUM(CASE WHEN send_ok = 0 THEN 1 ELSE 0 END) AS erreurs_envoi,
              SUM(opened) AS mails_lus,
              SUM(clicked) AS liens_clique
       FROM relance_tracking
       WHERE scope = ? AND type = 'mail'
       GROUP BY date(created_at)
       ORDER BY date(created_at)`
    )
    .all(scope) as MailSeriesPoint[];
}

export interface SmsSeriesPoint {
  date: string;
  sms_envoyes: number;
  erreurs_envoi: number;
  sms_delivres: number;
  sms_rejetes: number;
}

/** Série quotidienne pour la courbe de suivi des SMS, même principe que
 * getMailSeriesByScope. "Délivrés"/"Rejetés" ne sont connus qu'après le
 * sondage périodique de l'API Brevo (delivery_status), jamais à l'envoi. */
export function getSmsSeriesByScope(scope: string): SmsSeriesPoint[] {
  const rejectList = [...SMS_FAILURE_STATUSES].map(() => "?").join(",");
  return db
    .prepare(
      `SELECT date(created_at) AS date,
              SUM(send_ok) AS sms_envoyes,
              SUM(CASE WHEN send_ok = 0 THEN 1 ELSE 0 END) AS erreurs_envoi,
              SUM(CASE WHEN delivery_status = 'delivered' THEN 1 ELSE 0 END) AS sms_delivres,
              SUM(CASE WHEN delivery_status IN (${rejectList}) THEN 1 ELSE 0 END) AS sms_rejetes
       FROM relance_tracking
       WHERE scope = ? AND type = 'sms'
       GROUP BY date(created_at)
       ORDER BY date(created_at)`
    )
    .all(...SMS_FAILURE_STATUSES, scope) as SmsSeriesPoint[];
}

/** Les clics peuvent survenir n'importe quand après l'envoi ; au-delà de cette
 * fenêtre on arrête d'interroger Brevo pour ne pas accumuler des appels API
 * sans fin sur de très anciennes relances. */
const POLL_WINDOW_DAYS = 21;

function pendingRows(filter: { ownerUserId?: number; scope?: string } = {}): RelanceTrackingRow[] {
  const cutoff = dayjs().subtract(POLL_WINDOW_DAYS, "day").toISOString();
  const clauses = ["message_id IS NOT NULL", "created_at >= ?"];
  const params: unknown[] = [cutoff];
  if (filter.ownerUserId != null) {
    clauses.push("owner_user_id = ?");
    params.push(filter.ownerUserId);
  }
  if (filter.scope) {
    clauses.push("scope = ?");
    params.push(filter.scope);
  }
  const rows = db
    .prepare(`SELECT * FROM relance_tracking WHERE ${clauses.join(" AND ")}`)
    .all(...params) as RelanceTrackingRow[];
  // Ne resonde que ce qui peut encore évoluer : un mail non cliqué et pas en
  // échec définitif, ou un SMS dont le statut n'est pas encore stabilisé.
  return rows.filter((r) => {
    if (r.type === "mail") {
      if (r.clicked) return false;
      if (r.delivery_status && EMAIL_FAILURE_STATUSES.has(r.delivery_status)) return false;
      return true;
    }
    if (r.delivery_status && (SMS_FAILURE_STATUSES.has(r.delivery_status) || r.delivery_status === "delivered")) return false;
    return true;
  });
}

const EMAIL_STATUS_PRIORITY = ["hardBounces", "blocked", "invalid", "spam", "softBounces", "delivered", "opened", "sent", "requests", "deferred"];
const SMS_STATUS_PRIORITY = ["hardBounces", "blocked", "softBounces", "delivered", "sent"];

function pickStatus(events: { event?: string }[], priority: string[]): string | null {
  const present = new Set(events.map((e) => e.event).filter((e): e is string => Boolean(e)));
  return priority.find((s) => present.has(s)) ?? null;
}

function applyUpdate(rowId: number, status: string | null, clicked: boolean, opened = false): void {
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
 * statut de livraison / clic. Appelée à la fois par le sondage automatique
 * périodique (voir index.ts) et par le bouton de rafraîchissement manuel.
 *
 * Non testable en conditions réelles depuis cet environnement (accès réseau
 * à api.brevo.com bloqué en sandbox) : la logique de correspondance
 * (messageId pour les mails, reference/numéro pour les SMS) suit la
 * documentation Brevo mais mérite une vérification sur un vrai envoi.
 */
export async function refreshPendingRelanceTracking(
  filter: { ownerUserId?: number; scope?: string } = {}
): Promise<{ checked: number; updated: number }> {
  const rows = pendingRows(filter);
  if (!rows.length) return { checked: 0, updated: 0 };

  const byOwner = new Map<number, RelanceTrackingRow[]>();
  for (const r of rows) {
    if (!byOwner.has(r.owner_user_id)) byOwner.set(r.owner_user_id, []);
    byOwner.get(r.owner_user_id)!.push(r);
  }

  let updated = 0;
  const endDate = dayjs().format("YYYY-MM-DD");

  for (const [ownerId, ownerRows] of byOwner) {
    const userRow = db.prepare("SELECT brevo_api_key FROM users WHERE id = ?").get(ownerId) as
      | { brevo_api_key: string | null }
      | undefined;
    if (!userRow?.brevo_api_key) continue;
    const apiKey = userRow.brevo_api_key;

    const byTag = new Map<string, RelanceTrackingRow[]>();
    for (const r of ownerRows) {
      const key = `${r.type}::${r.campagne_tag}`;
      if (!byTag.has(key)) byTag.set(key, []);
      byTag.get(key)!.push(r);
    }

    for (const tagRows of byTag.values()) {
      const { type, campagne_tag: tag } = tagRows[0];
      const oldest = tagRows.reduce((min, r) => (r.created_at < min ? r.created_at : min), tagRows[0].created_at);
      const startDate = dayjs(oldest).format("YYYY-MM-DD");

      if (type === "mail") {
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
      } else {
        const events: BrevoSmsEvent[] = await fetchSmsEvents(apiKey, { tag, startDate, endDate, limit: 500 });
        for (const row of tagRows) {
          const matched = events.filter(
            (e) => (e.reference && e.reference === row.message_id) || e.sms === row.contact || e.phoneNumber === row.contact
          );
          if (!matched.length) {
            touchLastChecked(row.id);
            continue;
          }
          const status = pickStatus(matched, SMS_STATUS_PRIORITY);
          applyUpdate(row.id, status, false);
          updated++;
        }
      }
    }
  }

  return { checked: rows.length, updated };
}
