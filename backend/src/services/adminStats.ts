import { db } from "../db/index.js";
import { normalizeFrenchMobile } from "../lib/phone.js";
import { smsQuotaStatus } from "./smsQuota.js";
// Exception consciente à la séparation services/routes : le rapprochement
// adhérent <-> émargement (matchedAdherents) vit dans routes/brevo.ts,
// co-localisé avec le reste de la logique de templating des relances — le
// dupliquer ici coûterait plus cher (et risquerait de diverger) que cette
// dépendance à sens unique vers un module route.
import { matchedAdherents, matchedAdherentsAsOf, needsRelance, type Recipient } from "../routes/brevo.js";

function toPct(fraction: number | null): number | null {
  return fraction === null ? null : Math.round(fraction * 1000) / 10;
}

export interface DesinscriptionSpelcRow {
  spelc: string;
  mail: number;
  sms: number;
  total: number;
}

/**
 * Désinscriptions (relance_optout) attribuées à un Spelc via la table
 * adherents — nécessaire car relance_optout n'a pas de colonne spelc (une
 * désinscription est globale, par contact, pas par Spelc — voir
 * services/optout.ts). Un même contact peut appartenir à plusieurs Spelc
 * (même limite que recordOptOutBothChannels) : il est alors compté dans
 * chacun. `nonAttribuees` compte les désinscriptions dont le contact n'est
 * retrouvé dans aucun fichier adhérents (mail/mobile jamais importé, ou
 * déjà retiré depuis).
 */
export function desinscriptionsParSpelcEtCanal(): { rows: DesinscriptionSpelcRow[]; nonAttribuees: number } {
  const optouts = db.prepare("SELECT canal, contact FROM relance_optout").all() as { canal: "mail" | "sms"; contact: string }[];
  const adherentRows = db
    .prepare("SELECT spelc, mail, mobile FROM adherents WHERE mail IS NOT NULL OR mobile IS NOT NULL")
    .all() as { spelc: string; mail: string | null; mobile: string | null }[];

  const bySpelc = new Map<string, { mail: number; sms: number }>();
  let nonAttribuees = 0;
  for (const o of optouts) {
    const spelcs = new Set<string>();
    for (const a of adherentRows) {
      if (o.canal === "mail" ? a.mail && a.mail.trim().toLowerCase() === o.contact : a.mobile && normalizeFrenchMobile(a.mobile) === o.contact) {
        spelcs.add(a.spelc);
      }
    }
    if (spelcs.size === 0) {
      nonAttribuees++;
      continue;
    }
    for (const spelc of spelcs) {
      const entry = bySpelc.get(spelc) ?? { mail: 0, sms: 0 };
      entry[o.canal]++;
      bySpelc.set(spelc, entry);
    }
  }

  const rows = [...bySpelc.entries()]
    .map(([spelc, c]) => ({ spelc, mail: c.mail, sms: c.sms, total: c.mail + c.sms }))
    .sort((a, b) => b.total - a.total);
  return { rows, nonAttribuees };
}

export interface CreditsSmsRow {
  spelc: string;
  reels: number;
  estimes: number;
  /** % d'écart (réel - estimé) / estimé, positif si le réel coûte plus que prévu. Null si jamais estimé. */
  ecartPct: number | null;
}

/**
 * Compare, par Spelc, les crédits SMS réellement facturés par Brevo
 * (colonne credits) aux crédits estimés avant envoi (colonne
 * estimated_credits, voir smsSegmentCount) — ne porte que sur les envois
 * réels (hors test) déjà acceptés par Brevo, et seulement ceux faits
 * depuis l'ajout de cette colonne (estimated_credits non NULL), les envois
 * plus anciens n'ayant pas d'estimation à comparer.
 */
export function creditsSmsReelsVsEstimesParSpelc(): CreditsSmsRow[] {
  const rows = db
    .prepare(
      `SELECT scope AS spelc, COALESCE(SUM(credits), 0) AS reels, COALESCE(SUM(estimated_credits), 0) AS estimes
       FROM relance_tracking
       WHERE type = 'sms' AND send_ok = 1 AND test_mode = 0 AND estimated_credits IS NOT NULL
       GROUP BY scope
       ORDER BY scope`
    )
    .all() as { spelc: string; reels: number; estimes: number }[];
  return rows.map((r) => ({
    spelc: r.spelc,
    reels: r.reels,
    estimes: r.estimes,
    ecartPct: r.estimes > 0 ? toPct((r.reels - r.estimes) / r.estimes) : null,
  }));
}

export interface SpelcQuotaRow {
  spelc: string;
  quota: number;
  used: number;
  remaining: number;
  pctUsed: number;
  reached: boolean;
}

const QUOTA_ALERT_THRESHOLD_PCT = 80;

/** Spelc ayant atteint, ou étant à `thresholdPct` ou plus de, leur plafond de crédits SMS (services/smsQuota.ts). */
export function spelcsProchesPlafondSms(thresholdPct = QUOTA_ALERT_THRESHOLD_PCT): SpelcQuotaRow[] {
  const spelcs = db.prepare("SELECT spelc FROM ref_sms_quota").all() as { spelc: string }[];
  const rows: SpelcQuotaRow[] = [];
  for (const { spelc } of spelcs) {
    const status = smsQuotaStatus(spelc);
    if (status.quota === null) continue;
    const pctUsed = status.quota > 0 ? (toPct(status.used / status.quota) as number) : 0;
    if (status.reached || pctUsed >= thresholdPct) {
      rows.push({ spelc, quota: status.quota, used: status.used, remaining: status.remaining ?? 0, pctUsed, reached: status.reached });
    }
  }
  return rows.sort((a, b) => b.pctUsed - a.pctUsed);
}

function participationRate(recipients: Recipient[]): { matched: number; votants: number; taux: number | null } {
  const matched = recipients.filter((r) => r.localMatched || r.nationalMatched);
  const votants = matched.filter((r) => (r.localMatched && r.votantLocal) || (r.nationalMatched && r.votantNational));
  return { matched: matched.length, votants: votants.length, taux: matched.length ? votants.length / matched.length : null };
}

export interface EfficaciteRelanceRow {
  spelc: string;
  derniereCampagneDate: string;
  tauxAvant: number | null;
  tauxApres: number | null;
  progressionPoints: number | null;
  relances: number;
}

export interface SpelcSansEnvoiRow {
  spelc: string;
  nonVotants: number;
}

export interface QualiteRapprochementRow {
  spelc: string;
  totalAdherents: number;
  jamaisRetrouves: number;
  pctJamaisRetrouves: number;
}

export interface AdminStatsAvancees {
  desinscriptions: { rows: DesinscriptionSpelcRow[]; nonAttribuees: number };
  creditsSms: CreditsSmsRow[];
  plafondsSms: SpelcQuotaRow[];
  efficaciteRelances: EfficaciteRelanceRow[];
  spelcsSansEnvoi: SpelcSansEnvoiRow[];
  qualiteRapprochement: QualiteRapprochementRow[];
}

/**
 * Les 3 métriques "par Spelc" ci-dessous (efficacité des relances, Spelc
 * sans envoi, qualité du rapprochement) partagent toutes le même
 * rapprochement adhérents/émargements actuel (matchedAdherents), coûteux à
 * calculer (lecture + appariement en mémoire par Spelc) : un seul passage
 * par Spelc plutôt que 3, le calcul est donc fait ici plutôt que dans 3
 * fonctions indépendantes qui le répéteraient chacune.
 */
export function getAdminStatsAvancees(): AdminStatsAvancees {
  const spelcs = (db.prepare("SELECT spelc FROM ref_spelc ORDER BY spelc").all() as { spelc: string }[]).map((r) => r.spelc);
  const dejaEnvoye = new Set(
    (
      db.prepare("SELECT DISTINCT scope FROM relance_tracking WHERE test_mode = 0 AND send_ok = 1").all() as { scope: string }[]
    ).map((r) => r.scope)
  );

  const efficaciteRelances: EfficaciteRelanceRow[] = [];
  const spelcsSansEnvoi: SpelcSansEnvoiRow[] = [];
  const qualiteRapprochement: QualiteRapprochementRow[] = [];

  for (const spelc of spelcs) {
    const recipients = matchedAdherents(spelc);

    if (recipients.length > 0) {
      const jamaisRetrouves = recipients.filter((r) => !r.localMatched && !r.nationalMatched).length;
      qualiteRapprochement.push({
        spelc,
        totalAdherents: recipients.length,
        jamaisRetrouves,
        pctJamaisRetrouves: toPct(jamaisRetrouves / recipients.length) as number,
      });
    }

    if (!dejaEnvoye.has(spelc)) {
      const nonVotants = recipients.filter(needsRelance).length;
      if (nonVotants > 0) spelcsSansEnvoi.push({ spelc, nonVotants });
      continue; // jamais de campagne réelle envoyée : pas de "dernière campagne" à mesurer
    }

    const last = db
      .prepare("SELECT MAX(created_at) AS d FROM relance_tracking WHERE scope = ? AND test_mode = 0 AND send_ok = 1")
      .get(spelc) as { d: string };
    const dayStart = db
      .prepare(
        `SELECT MIN(created_at) AS d FROM relance_tracking
         WHERE scope = ? AND test_mode = 0 AND send_ok = 1 AND date(created_at) = date(?)`
      )
      .get(spelc, last.d) as { d: string };
    const relancesCount = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM relance_tracking
           WHERE scope = ? AND test_mode = 0 AND send_ok = 1 AND date(created_at) = date(?)`
        )
        .get(spelc, last.d) as { n: number }
    ).n;

    const before = participationRate(matchedAdherentsAsOf(spelc, dayStart.d));
    const after = participationRate(recipients);
    efficaciteRelances.push({
      spelc,
      derniereCampagneDate: last.d.slice(0, 10),
      tauxAvant: toPct(before.taux),
      tauxApres: toPct(after.taux),
      progressionPoints: before.taux !== null && after.taux !== null ? toPct(after.taux - before.taux) : null,
      relances: relancesCount,
    });
  }

  return {
    desinscriptions: desinscriptionsParSpelcEtCanal(),
    creditsSms: creditsSmsReelsVsEstimesParSpelc(),
    plafondsSms: spelcsProchesPlafondSms(),
    efficaciteRelances: efficaciteRelances.sort((a, b) => (a.progressionPoints ?? 0) - (b.progressionPoints ?? 0)),
    spelcsSansEnvoi: spelcsSansEnvoi.sort((a, b) => b.nonVotants - a.nonVotants),
    qualiteRapprochement: qualiteRapprochement.sort((a, b) => b.pctJamaisRetrouves - a.pctJamaisRetrouves),
  };
}
