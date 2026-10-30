import { getSetting, setSetting } from "./settings.js";
import { parseSocialLinks, type SocialLinks } from "../lib/socialLinks.js";
import { saveLogoUpload } from "../lib/uploads.js";

/**
 * Réglages d'organisation (logo/réseaux sociaux des mails, mail de test) :
 * une seule instance, partagée par tous les comptes administrateurs — pas
 * de notion de Spelc local comme dans l'application éducation nationale
 * (voir services/spelcSettings.ts là-bas, dont celui-ci est la version
 * simplifiée à un seul périmètre).
 */
export interface OrgSettings {
  logoPath: string | null;
  socialLinks: SocialLinks;
  testEmail: string | null;
}

export function getOrgSettings(): OrgSettings {
  return {
    logoPath: getSetting("org_logo_path"),
    socialLinks: parseSocialLinks(getSetting("org_social_links")),
    testEmail: getSetting("org_test_email"),
  };
}

export interface OrgSettingsUpdate {
  logoDataUri?: string;
  socialLinks?: SocialLinks;
  testEmail?: string;
}

export function updateOrgSettings(update: OrgSettingsUpdate): void {
  if (update.logoDataUri !== undefined) {
    const saved = saveLogoUpload(update.logoDataUri);
    if (saved) setSetting("org_logo_path", saved);
  }
  if (update.socialLinks !== undefined) setSetting("org_social_links", JSON.stringify(update.socialLinks));
  if (update.testEmail !== undefined) setSetting("org_test_email", update.testEmail);
}
