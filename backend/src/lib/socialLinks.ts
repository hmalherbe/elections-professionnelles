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
 * Bloc HTML de pied de mail listant les réseaux sociaux cochés (avec une
 * URL renseignée) — inséré via le champ de modèle {{reseaux_sociaux}}.
 * Rendu en simples liens texte (pas d'icônes image) pour un affichage fiable
 * quel que soit le client mail.
 */
export function buildSocialLinksHtml(links: SocialLinks): string {
  const active = SOCIAL_NETWORKS.filter((n) => links[n]?.enabled && links[n]?.url?.trim());
  if (active.length === 0) return "";
  const items = active
    .map((n) => `<a href="${links[n]!.url.trim()}" style="color:#1B2A4A;text-decoration:none;">${NETWORK_LABELS[n]}</a>`)
    .join(" &nbsp;·&nbsp; ");
  return `<div style="margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;">Suivez-nous : ${items}</div>`;
}

export function buildLogoHtml(logoDataUri: string | null): string {
  if (!logoDataUri) return "";
  return `<div style="margin-bottom:16px;"><img src="${logoDataUri}" alt="Logo" style="max-height:80px;max-width:280px;" /></div>`;
}
