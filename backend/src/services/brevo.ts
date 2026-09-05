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
}

const BREVO_BASE = "https://api.brevo.com/v3";

export async function sendBrevoEmails(payload: SendEmailPayload): Promise<BrevoSendSummary> {
  let sent = 0;
  let errors = 0;
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
      if (response.ok) sent++;
      else {
        errors++;
        console.error("Échec envoi mail Brevo:", response.status, await response.text());
      }
    } catch (err) {
      errors++;
      console.error("Échec envoi mail Brevo (exception):", err);
    }
  }
  return { sent, errors };
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
      if (response.ok) sent++;
      else {
        errors++;
        console.error("Échec envoi SMS Brevo:", response.status, await response.text());
      }
    } catch (err) {
      errors++;
      console.error("Échec envoi SMS Brevo (exception):", err);
    }
  }
  return { sent, errors };
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
