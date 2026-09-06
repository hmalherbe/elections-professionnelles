export type SocialNetwork = "facebook" | "twitter" | "instagram" | "linkedin" | "youtube";
export type SocialLinks = Partial<Record<SocialNetwork, { enabled: boolean; url: string }>>;

export const SOCIAL_NETWORKS: { key: SocialNetwork; label: string }[] = [
  { key: "facebook", label: "Facebook" },
  { key: "twitter", label: "X / Twitter" },
  { key: "instagram", label: "Instagram" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "youtube", label: "YouTube" },
];
