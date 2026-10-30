import { decrypt, encrypt } from "../lib/crypto.js";
import { getSetting, setSetting } from "./settings.js";

/** Clé API Brevo unique, configurée une seule fois (onglet Paramètres),
 * stockée chiffrée au repos (voir lib/crypto.ts). */
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
  messageId: string | null;
  errorMessage: string | null;
}

const BREVO_BASE = "https://api.brevo.com/v3";

function describeFetchException(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  const causeMessage = cause instanceof Error ? cause.message : cause ? String(cause) : null;
  return causeMessage ? `${err.message} (${causeMessage})` : err.message;
}

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

export async function sendBrevoEmails(payload: SendEmailPayload): Promise<BrevoSendSummary> {
  let sent = 0;
  let errors = 0;
  let messageId: string | null = null;
  let errorMessage: string | null = null;
  for (const recipient of payload.to) {
    try {
      const response = await fetch(`${BREVO_BASE}/smtp/email`, {
        method: "POST",
        headers: {
          "api-key": payload.apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          sender: { email: "no-reply@spelc.fr", name: "SPELC" },
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
  return { sent, errors, messageId, errorMessage };
}

export interface BrevoEmailEvent {
  email?: string;
  date?: string;
  event?: string;
  messageId?: string;
  tag?: string;
}

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

export interface BrevoPlanEntry {
  type: string;
  credits: number;
  creditsType: string;
}

export async function fetchAccountInfo(
  apiKey: string
): Promise<{ email: string; companyName: string; plan: BrevoPlanEntry[] } | null> {
  try {
    const response = await fetch(`${BREVO_BASE}/account`, {
      headers: { "api-key": apiKey, Accept: "application/json" },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { email?: string; companyName?: string; plan?: BrevoPlanEntry[] };
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
