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
   * voir les call sites dans routes/psa.ts et routes/brevo.ts), utilisé pour
   * retrouver plus tard le statut de livraison et les clics de CE destinataire
   * précis via l'API d'évènements Brevo. `null` si l'envoi a échoué ou si
   * Brevo n'a pas renvoyé d'identifiant exploitable.
   */
  messageId: string | null;
}

const BREVO_BASE = "https://api.brevo.com/v3";

export async function sendBrevoEmails(payload: SendEmailPayload): Promise<BrevoSendSummary> {
  let sent = 0;
  let errors = 0;
  let messageId: string | null = null;
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
        console.error("Échec envoi mail Brevo:", response.status, await response.text());
      }
    } catch (err) {
      errors++;
      console.error("Échec envoi mail Brevo (exception):", err);
    }
  }
  return { sent, errors, messageId };
}

interface SendSmsPayload {
  apiKey: string;
  recipients: string[];
  content: string;
  tag: string;
}

export async function sendBrevoSms(payload: SendSmsPayload): Promise<BrevoSendSummary> {
  let sent = 0;
  let errors = 0;
  let messageId: string | null = null;
  for (const recipient of payload.recipients) {
    try {
      const response = await fetch(`${BREVO_BASE}/transactionalSMS/sms`, {
        method: "POST",
        headers: {
          "api-key": payload.apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          sender: "SPELC",
          recipient,
          content: payload.content,
          tag: payload.tag,
        }),
      });
      if (response.ok) {
        sent++;
        // Réponse Brevo : { reference, messageId, smsCount, usedCredits, remainingCredit }.
        // `reference` est la clé stable pour retrouver l'évènement plus tard.
        const data = (await response.json().catch(() => null)) as { reference?: string; messageId?: number | string } | null;
        messageId = data?.reference ?? (data?.messageId != null ? String(data.messageId) : null);
      } else {
        errors++;
        console.error("Échec envoi SMS Brevo:", response.status, await response.text());
      }
    } catch (err) {
      errors++;
      console.error("Échec envoi SMS Brevo (exception):", err);
    }
  }
  return { sent, errors, messageId };
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

export async function fetchAggregatedEmailStats(
  apiKey: string,
  tag: string,
  startDate: string,
  endDate: string
): Promise<{ delivered: number; opens: number; clicks: number; hardBounces: number; softBounces: number } | null> {
  const url = `${BREVO_BASE}/smtp/statistics/aggregatedReport?startDate=${startDate}&endDate=${endDate}&tag=${encodeURIComponent(tag)}`;
  const response = await fetch(url, { headers: { "api-key": apiKey, Accept: "application/json" } });
  if (!response.ok) return null;
  return (await response.json()) as {
    delivered: number;
    opens: number;
    clicks: number;
    hardBounces: number;
    softBounces: number;
  };
}

export async function fetchAggregatedSmsStats(
  apiKey: string,
  startDate: string,
  endDate: string
): Promise<{ delivered: number; sent: number; softBounces: number; hardBounces: number } | null> {
  const url = `${BREVO_BASE}/transactionalSMS/statistics/aggregatedReport?startDate=${startDate}&endDate=${endDate}`;
  const response = await fetch(url, { headers: { "api-key": apiKey, Accept: "application/json" } });
  if (!response.ok) return null;
  return (await response.json()) as { delivered: number; sent: number; softBounces: number; hardBounces: number };
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
}
