import { decrypt, encrypt } from "../lib/crypto.js";
import { getSetting, setSetting } from "./settings.js";

/**
 * Clé API Brevo unique, partagée par tous les syndicats adhérents : réglée
 * une seule fois par l'admin général (onglet "Paramètres"), au lieu d'une
 * clé par compte admin Spelc comme auparavant (colonne users.brevo_api_key,
 * désormais inutilisée) — stockée chiffrée au repos dans app_settings via
 * lib/crypto.ts.
 */
export function isBrevoApiKeyConfigured(): boolean {
  return Boolean(getSetting("brevo_api_key"));
}

export function saveBrevoApiKey(apiKey: string): void {
  setSetting("brevo_api_key", encrypt(apiKey));
}

export function maskedBrevoApiKey(): string | null {
  const encrypted = getSetting("brevo_api_key");
  return encrypted ? "••••••••" + decrypt(encrypted).slice(-4) : null;
}

export function getBrevoApiKey(): string | null {
  const encrypted = getSetting("brevo_api_key");
  return encrypted ? decrypt(encrypted) : null;
}

interface SendEmailPayload {
  apiKey: string;
  to: { email: string; name?: string }[];
  subject: string;
  htmlContent: string;
  tag: string;
}

export interface BrevoSendSummary {
  sent: number;
  errors: number;
  /**
   * Identifiant Brevo du dernier envoi réussi de cette boucle (chaque appel
   * de ce module n'envoie en pratique qu'à un seul destinataire à la fois —
   * voir les call sites dans routes/brevo.ts), utilisé pour
   * retrouver plus tard le statut de livraison et les clics de CE destinataire
   * précis via l'API d'évènements Brevo. `null` si l'envoi a échoué ou si
   * Brevo n'a pas renvoyé d'identifiant exploitable.
   */
  messageId: string | null;
  /**
   * Raison du dernier échec de cette boucle (réponse d'erreur Brevo ou
   * exception réseau), pour affichage à l'admin — auparavant seulement
   * journalisée en console (donc invisible sans accès aux logs serveur).
   * `null` si aucun échec.
   */
  errorMessage: string | null;
  /**
   * Somme des crédits RÉELLEMENT facturés par Brevo (champ `usedCredits` de
   * sa réponse), cumulée sur tous les envois réussis de cette boucle — `null`
   * si aucun envoi n'a réussi, ou si Brevo n'a pas renvoyé ce champ.
   * N'existe que pour les SMS (Brevo ne renvoie pas ce champ pour un mail,
   * dont le coût n'est de toute façon pas compté en "crédits SMS"). Autorité
   * sur le nombre de crédits consommés : à préférer à toute estimation
   * locale (voir lib/smsSegments.ts) chaque fois qu'un envoi réel a eu lieu,
   * l'estimation ne restant utile que pour un aperçu SANS envoi, où aucune
   * réponse Brevo n'existe — voir le correctif suite à un écart constaté
   * (4 crédits réels / SMS facturés par Brevo pour un envoi vers un numéro
   * français avec expéditeur alphanumérique, contre 1-2 estimés par
   * smsSegmentCount, qui suppose à tort un coût de 1 crédit par segment
   * indépendant du pays de destination et du type d'expéditeur).
   */
  creditsUsed: number | null;
}

const BREVO_BASE = "https://api.brevo.com/v3";

/** `fetch` échoue au niveau réseau (DNS, connexion refusée, TLS...) avec un
 * message générique "fetch failed" ; la cause réelle (ex. "getaddrinfo
 * ENOTFOUND api.brevo.com") est dans `.cause`, sans quoi elle reste invisible
 * à l'admin comme dans les logs. */
function describeFetchException(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  const causeMessage = cause instanceof Error ? cause.message : cause ? String(cause) : null;
  return causeMessage ? `${err.message} (${causeMessage})` : err.message;
}

/** Réponse d'erreur Brevo typique : {"code":"...","message":"..."}. On
 * retombe sur le texte brut (tronqué) si ce n'est pas ce format. */
async function describeBrevoError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const data = JSON.parse(text) as { code?: string; message?: string };
    if (data.message) return data.code ? `${data.code} : ${data.message}` : data.message;
  } catch {
    /* pas du JSON, on garde le texte brut */
  }
  return `HTTP ${response.status}${text ? ` : ${text.slice(0, 500)}` : ""}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Nombre de tentatives supplémentaires après un 429 (limite de débit Brevo)
 * avant d'abandonner et de compter l'envoi en échec — jamais une boucle
 * infinie. */
const MAX_429_RETRIES = 1;
const DEFAULT_RETRY_DELAY_MS = 2000;

/**
 * Relance une requête Brevo ayant répondu 429 (trop de requêtes), en
 * respectant l'en-tête Retry-After si Brevo le fournit, sinon un délai par
 * défaut, jusqu'à MAX_429_RETRIES tentatives. Les autres erreurs HTTP (4xx/5xx
 * hors 429) ne sont jamais ré-essayées : ce sont des erreurs définitives
 * (contenu refusé, destinataire invalide...), pas une simple saturation
 * temporaire — les réessayer ferait perdre du temps pour rien.
 */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let response = await fetch(url, init);
  for (let attempt = 0; response.status === 429 && attempt < MAX_429_RETRIES; attempt++) {
    const retryAfterSeconds = Number(response.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : DEFAULT_RETRY_DELAY_MS;
    await sleep(delayMs);
    response = await fetch(url, init);
  }
  return response;
}

export async function sendBrevoEmails(payload: SendEmailPayload): Promise<BrevoSendSummary> {
  let sent = 0;
  let errors = 0;
  let messageId: string | null = null;
  let errorMessage: string | null = null;
  for (const recipient of payload.to) {
    try {
      const response = await fetchWithRetry(`${BREVO_BASE}/smtp/email`, {
        method: "POST",
        headers: {
          "api-key": payload.apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          sender: { email: "ccm2026@spelc.fr", name: "Spelc" },
          to: [recipient],
          subject: payload.subject,
          htmlContent: payload.htmlContent,
          tags: [payload.tag],
        }),
      });
      if (response.ok) {
        sent++;
        const data = (await response.json().catch(() => null)) as { messageId?: string; messageIds?: string[] } | null;
        messageId = data?.messageId ?? data?.messageIds?.[0] ?? null;
      } else {
        errors++;
        errorMessage = await describeBrevoError(response);
        console.error("Échec envoi mail Brevo:", errorMessage);
      }
    } catch (err) {
      errors++;
      errorMessage = describeFetchException(err);
      console.error("Échec envoi mail Brevo (exception):", err);
    }
  }
  return { sent, errors, messageId, errorMessage, creditsUsed: null };
}

interface SendSmsPayload {
  apiKey: string;
  recipients: string[];
  content: string;
  tag: string;
  /** Nom d'expéditeur alphanumérique (max 11 caractères, lettres/chiffres
   * uniquement — voir lib/smsSender.ts) affiché comme "From" chez le destinataire. */
  sender: string;
}

export async function sendBrevoSms(payload: SendSmsPayload): Promise<BrevoSendSummary> {
  let sent = 0;
  let errors = 0;
  let messageId: string | null = null;
  let errorMessage: string | null = null;
  let creditsUsed: number | null = null;
  for (const recipient of payload.recipients) {
    try {
      const response = await fetchWithRetry(`${BREVO_BASE}/transactionalSMS/sms`, {
        method: "POST",
        headers: {
          "api-key": payload.apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          sender: payload.sender,
          recipient,
          content: payload.content,
          tag: payload.tag,
        }),
      });
      if (response.ok) {
        sent++;
        // Réponse Brevo : { reference, messageId, smsCount, usedCredits, remainingCredit }.
        // `reference` est la clé stable pour retrouver l'évènement plus tard. `usedCredits`
        // est le nombre RÉEL de crédits facturés par Brevo pour CET envoi (dépend du pays
        // de destination et du type d'expéditeur, pas seulement du nombre de segments
        // GSM-7/UCS-2 — voir le commentaire de BrevoSendSummary.creditsUsed) : cumulé ici
        // plutôt qu'estimé, pour que l'appelant l'utilise à la place de smsSegmentCount().
        const data = (await response.json().catch(() => null)) as
          | { reference?: string; messageId?: number | string; usedCredits?: number }
          | null;
        messageId = data?.reference ?? (data?.messageId != null ? String(data.messageId) : null);
        if (typeof data?.usedCredits === "number") {
          creditsUsed = (creditsUsed ?? 0) + data.usedCredits;
        }
      } else {
        errors++;
        errorMessage = await describeBrevoError(response);
        console.error("Échec envoi SMS Brevo:", errorMessage);
      }
    } catch (err) {
      errors++;
      errorMessage = describeFetchException(err);
      console.error("Échec envoi SMS Brevo (exception):", err);
    }
  }
  return { sent, errors, messageId, errorMessage, creditsUsed };
}

export interface BrevoEmailEvent {
  email?: string;
  date?: string;
  event?: string;
  messageId?: string;
  tag?: string;
}

/**
 * Évènements bruts d'un mail transactionnel (delivered, opened, clicks,
 * hardBounces, softBounces, blocked, invalid...), filtrés par tag et fenêtre
 * de dates puis recoupés côté appelant par messageId — plus robuste qu'un
 * filtre serveur dont on ne peut pas vérifier la précision exacte depuis cet
 * environnement (accès réseau à api.brevo.com bloqué en sandbox).
 */
export async function fetchEmailEvents(
  apiKey: string,
  { tag, startDate, endDate, limit = 100 }: { tag: string; startDate: string; endDate: string; limit?: number }
): Promise<BrevoEmailEvent[]> {
  const url = `${BREVO_BASE}/smtp/statistics/events?tags=${encodeURIComponent(tag)}&startDate=${startDate}&endDate=${endDate}&limit=${limit}`;
  try {
    const response = await fetch(url, { headers: { "api-key": apiKey, Accept: "application/json" } });
    if (!response.ok) return [];
    const data = (await response.json().catch(() => null)) as { events?: BrevoEmailEvent[] } | null;
    return Array.isArray(data?.events) ? data!.events! : [];
  } catch (err) {
    console.error("Échec récupération évènements mail Brevo:", err);
    return [];
  }
}

export interface BrevoSmsEvent {
  phoneNumber?: string;
  sms?: string;
  reference?: string;
  date?: string;
  event?: string;
  tag?: string;
}

/** Évènements bruts d'un SMS transactionnel (sent, delivered, softBounces, hardBounces, blocked). */
export async function fetchSmsEvents(
  apiKey: string,
  { tag, startDate, endDate, limit = 100 }: { tag: string; startDate: string; endDate: string; limit?: number }
): Promise<BrevoSmsEvent[]> {
  const url = `${BREVO_BASE}/transactionalSMS/statistics/events?tags=${encodeURIComponent(tag)}&startDate=${startDate}&endDate=${endDate}&limit=${limit}`;
  try {
    const response = await fetch(url, { headers: { "api-key": apiKey, Accept: "application/json" } });
    if (!response.ok) return [];
    const data = (await response.json().catch(() => null)) as { events?: BrevoSmsEvent[] } | null;
    return Array.isArray(data?.events) ? data!.events! : [];
  } catch (err) {
    console.error("Échec récupération évènements SMS Brevo:", err);
    return [];
  }
}

export interface BrevoPlanEntry {
  type: string;
  credits: number;
  creditsType: string;
}

/** Infos de compte Brevo, dont les crédits restants (mail/SMS) par plan. */
export async function fetchAccountInfo(
  apiKey: string
): Promise<{ email: string; companyName: string; plan: BrevoPlanEntry[] } | null> {
  try {
    const response = await fetch(`${BREVO_BASE}/account`, {
      headers: { "api-key": apiKey, Accept: "application/json" },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      email?: string;
      companyName?: string;
      plan?: BrevoPlanEntry[];
    };
    return {
      email: data.email ?? "",
      companyName: data.companyName ?? "",
      plan: Array.isArray(data.plan) ? data.plan : [],
    };
  } catch (err) {
    console.error("Échec récupération compte Brevo:", describeFetchException(err));
    return null;
  }
}
