import { db } from "../db/index.js";
import { parseSocialLinks, type SocialLinks } from "../lib/socialLinks.js";
import { saveLogoUpload } from "../lib/uploads.js";

export interface SpelcSettings {
  logoDataUri: string | null;
  socialLinks: SocialLinks;
  testEmail: string | null;
  testMobile: string | null;
  smsSender: string | null;
}

interface SpelcSettingsRow {
  logo_data_uri: string | null;
  social_links: string | null;
  test_email: string | null;
  test_mobile: string | null;
  sms_sender: string | null;
}

export function getSpelcSettings(spelc: string): SpelcSettings {
  const row = db
    .prepare("SELECT logo_data_uri, social_links, test_email, test_mobile, sms_sender FROM spelc_settings WHERE spelc = ?")
    .get(spelc) as SpelcSettingsRow | undefined;
  return {
    logoDataUri: row?.logo_data_uri ?? null,
    socialLinks: parseSocialLinks(row?.social_links ?? null),
    testEmail: row?.test_email ?? null,
    testMobile: row?.test_mobile ?? null,
    smsSender: row?.sms_sender ?? null,
  };
}

export interface SpelcSettingsUpdate {
  logoDataUri?: string;
  socialLinks?: SocialLinks;
  testEmail?: string;
  testMobile?: string;
  smsSender?: string;
}

/** Mise à jour partielle : seuls les champs fournis sont modifiés. */
export function updateSpelcSettings(spelc: string, update: SpelcSettingsUpdate): void {
  const current = db
    .prepare("SELECT logo_data_uri, social_links, test_email, test_mobile, sms_sender FROM spelc_settings WHERE spelc = ?")
    .get(spelc) as SpelcSettingsRow | undefined;
  const next = {
    logo_data_uri:
      update.logoDataUri !== undefined
        ? (saveLogoUpload(`spelc-${spelc}`, update.logoDataUri) ?? update.logoDataUri)
        : (current?.logo_data_uri ?? null),
    social_links: update.socialLinks !== undefined ? JSON.stringify(update.socialLinks) : (current?.social_links ?? null),
    test_email: update.testEmail !== undefined ? update.testEmail : (current?.test_email ?? null),
    test_mobile: update.testMobile !== undefined ? update.testMobile : (current?.test_mobile ?? null),
    sms_sender: update.smsSender !== undefined ? update.smsSender : (current?.sms_sender ?? null),
  };
  db.prepare(
    `INSERT INTO spelc_settings (spelc, logo_data_uri, social_links, test_email, test_mobile, sms_sender, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(spelc) DO UPDATE SET
       logo_data_uri = excluded.logo_data_uri,
       social_links = excluded.social_links,
       test_email = excluded.test_email,
       test_mobile = excluded.test_mobile,
       sms_sender = excluded.sms_sender,
       updated_at = datetime('now')`
  ).run(spelc, next.logo_data_uri, next.social_links, next.test_email, next.test_mobile, next.sms_sender);
}
