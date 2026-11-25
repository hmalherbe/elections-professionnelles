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
 * par de nombreux clients mail (Gmail, Outlook.com...) : les pictogrammes
 * réseaux sociaux sont donc servis comme de vrais fichiers, à une URL
 * publique absolue (PUBLIC_BASE_URL + /api/assets/social-icons/<réseau>.png).
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

/** Taille fixe du logo Spelc en entête de mail (voir buildLogoHtml). */
const LOGO_SIZE_PX = 200;

/**
 * Logo en tête de mail, centré horizontalement, taille fixée à
 * LOGO_SIZE_PX x LOGO_SIZE_PX. Certains clients (notamment Thunderbird)
 * redimensionnent une image selon sa taille intrinsèque malgré des
 * attributs width/height ou un style width/height classiques : on utilise
 * donc la technique "bulletproof" standard en HTML mail — cellule de
 * tableau à taille fixe (width/height en attributs, respectés beaucoup plus
 * largement qu'une propriété CSS) + attributs ET style !important sur
 * l'image elle-même + display:block (évite l'espace blanc sous l'image dû
 * à son alignement inline par défaut).
 */
export function buildLogoHtml(logoRef: string | null): string {
  if (!logoRef) return "";
  const src = logoRef.startsWith("/") ? `${publicBaseUrl()}${logoRef}` : logoRef;
  return (
    `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 16px auto;">` +
    `<tr><td width="${LOGO_SIZE_PX}" height="${LOGO_SIZE_PX}" align="center" valign="middle" ` +
    `style="width:${LOGO_SIZE_PX}px;height:${LOGO_SIZE_PX}px;">` +
    `<img src="${src}" alt="Logo" width="${LOGO_SIZE_PX}" height="${LOGO_SIZE_PX}" ` +
    `style="display:block;width:${LOGO_SIZE_PX}px !important;height:${LOGO_SIZE_PX}px !important;" />` +
    `</td></tr></table>`
  );
}

/**
 * Bannière pleine largeur (ex. champ {{logo_rugby}}) : contrairement à
 * buildLogoHtml (pensé pour un petit logo carré), l'image occupe toute la
 * largeur de la colonne du mail, hauteur proportionnelle — adapté à un
 * visuel de campagne large plutôt qu'à un logo.
 */
export function buildBannerHtml(assetPath: string, alt: string): string {
  const src = `${publicBaseUrl()}${assetPath}`;
  return `<div style="margin-bottom:16px;text-align:center;"><img src="${src}" alt="${alt}" style="width:100%;max-width:600px;height:auto;display:block;margin:0 auto;" /></div>`;
}
