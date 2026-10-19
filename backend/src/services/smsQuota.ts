import { db } from "../db/index.js";

export interface SmsQuotaStatus {
  /** null = aucun plafond configuré pour ce Spelc (pas de ligne importée). */
  quota: number | null;
  used: number;
  remaining: number | null;
  reached: boolean;
}

export function getSmsQuota(spelc: string): number | null {
  const row = db.prepare("SELECT credits FROM ref_sms_quota WHERE spelc = ?").get(spelc) as
    | { credits: number }
    | undefined;
  return row?.credits ?? null;
}

/**
 * Crédits SMS déjà consommés par ce Spelc depuis le début de la période de
 * relance : tous les envois acceptés par Brevo (send_ok), test ou réel —
 * les deux consomment de vrais crédits SMS, donc comptent également pour le
 * plafond national réparti par Spelc.
 */
export function smsCreditsUsed(spelc: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM relance_tracking WHERE scope = ? AND type = 'sms' AND send_ok = 1")
    .get(spelc) as { n: number };
  return row.n;
}

export function smsQuotaStatus(spelc: string): SmsQuotaStatus {
  const quota = getSmsQuota(spelc);
  const used = smsCreditsUsed(spelc);
  return {
    quota,
    used,
    remaining: quota === null ? null : Math.max(quota - used, 0),
    reached: quota !== null && used >= quota,
  };
}
