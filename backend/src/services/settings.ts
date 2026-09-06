import { db } from "../db/index.js";
import { parseSocialLinks, type SocialLinks } from "../lib/socialLinks.js";

export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as
    | { value: string | null }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

export interface TestContactSettings {
  testEmail: string | null;
  testMobile: string | null;
}

export function getTestContactSettings(): TestContactSettings {
  return {
    testEmail: getSetting("test_email"),
    testMobile: getSetting("test_mobile"),
  };
}

export interface PsaBranding {
  logoDataUri: string | null;
  socialLinks: SocialLinks;
}

/** Logo et réseaux sociaux insérés dans les modèles de relance PSA (admin général, global). */
export function getPsaBranding(): PsaBranding {
  return {
    logoDataUri: getSetting("psa_logo_data_uri"),
    socialLinks: parseSocialLinks(getSetting("psa_social_links")),
  };
}

export function setPsaLogo(dataUri: string): void {
  setSetting("psa_logo_data_uri", dataUri);
}

export function setPsaSocialLinks(links: SocialLinks): void {
  setSetting("psa_social_links", JSON.stringify(links));
}
