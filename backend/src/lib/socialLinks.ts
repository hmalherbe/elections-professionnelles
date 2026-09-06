export const SOCIAL_NETWORKS = ["facebook", "twitter", "instagram", "linkedin", "youtube"] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

const NETWORK_LABELS: Record<SocialNetwork, string> = {
  facebook: "Facebook",
  twitter: "X / Twitter",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  youtube: "YouTube",
};

export type SocialLinks = Partial<Record<SocialNetwork, { enabled: boolean; url: string }>>;

export function parseSocialLinks(raw: string | null): SocialLinks {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as SocialLinks;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Les images encodées en data URI (base64 inline) sont bloquées ou retirées
 * par de nombreux clients mail (notamment Gmail et Outlook.com) pour des
 * raisons de sécurité — elles s'affichent très bien dans un aperçu navigateur
 * mais pas forcément une fois réellement reçues par mail. Les pictogrammes
 * réseaux sociaux sont donc servis comme de vrais fichiers, à une URL
 * publique absolue (PUBLIC_BASE_URL + /api/assets/social-icons/<réseau>.png),
 * exactement comme n'importe quelle image d'un mail marketing classique.
 *
 * PUBLIC_BASE_URL doit être l'adresse publique du serveur (ex.
 * "http://163.172.15.114" ou votre nom de domaine une fois configuré),
 * renseignée dans .env et transmise au conteneur backend.
 */
function publicBaseUrl(): string {
  const configured = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  if (!configured) {
    console.warn(
      "PUBLIC_BASE_URL non configurée : les logos des réseaux sociaux dans les mails pointeront vers une URL relative " +
        "et ne s'afficheront probablement pas chez le destinataire. Renseignez PUBLIC_BASE_URL dans .env."
    );
  }
  return configured ?? "";
}

function networkIconUrl(network: SocialNetwork): string {
  return `${publicBaseUrl()}/api/assets/social-icons/${network}.png`;
}

/**
 * Bloc HTML de pied de mail listant les réseaux sociaux cochés (avec une URL
 * renseignée), sous forme de petits logos cliquables — pictogrammes
 * génériques (lettre ou symbole), pas les logos de marque déposés, mais
 * suffisamment reconnaissables pour identifier le réseau. Servis en fichiers
 * réels (voir publicBaseUrl ci-dessus), alt renseigné pour rester lisible si
 * les images sont bloquées par le client mail.
 */
export function buildSocialLinksHtml(links: SocialLinks): string {
  const active = SOCIAL_NETWORKS.filter((n) => links[n]?.enabled && links[n]?.url?.trim());
  if (active.length === 0) return "";
  const items = active
    .map(
      (n) =>
        `<a href="${links[n]!.url.trim()}" style="display:inline-block;margin-right:10px;line-height:0;">` +
        `<img src="${networkIconUrl(n)}" width="24" height="24" alt="${NETWORK_LABELS[n]}" style="border-radius:50%;vertical-align:middle;" />` +
        `</a>`
    )
    .join("");
  return `<div style="margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;">Suivez-nous : ${items}</div>`;
}

/** Logo en tête de mail, centré horizontalement (text-align sur le conteneur
 * : la propriété CSS la plus fiable pour un centrage universel en HTML mail,
 * y compris sur les clients qui ignorent flexbox/margin:auto sur un <img>). */
export function buildLogoHtml(logoDataUri: string | null): string {
  if (!logoDataUri) return "";
  return `<div style="margin-bottom:16px;text-align:center;"><img src="${logoDataUri}" alt="Logo" style="max-height:80px;max-width:280px;" /></div>`;
}
