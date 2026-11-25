import { getSetting, setSetting } from "./settings.js";
import { parseSocialLinks, type SocialLinks } from "../lib/socialLinks.js";

/**
 * Réglages d'organisation (réseaux sociaux des mails, mail de test) : une
 * seule instance, partagée par tous les comptes administrateurs — pas de
 * notion de Spelc local comme dans l'application éducation nationale. Le
 * logo des mails n'est plus géré ici (image fixe, voir routes/brevo.ts
 * SPELC_LOGO_PATH/RUGBY_BANNER_PATH).
 */
export interface OrgSettings {
  socialLinks: SocialLinks;
  testEmail: string | null;
}

export function getOrgSettings(): OrgSettings {
  return {
    socialLinks: parseSocialLinks(getSetting("org_social_links")),
    testEmail: getSetting("org_test_email"),
  };
}

export interface OrgSettingsUpdate {
  socialLinks?: SocialLinks;
  testEmail?: string;
}

export function updateOrgSettings(update: OrgSettingsUpdate): void {
  if (update.socialLinks !== undefined) setSetting("org_social_links", JSON.stringify(update.socialLinks));
  if (update.testEmail !== undefined) setSetting("org_test_email", update.testEmail);
}
