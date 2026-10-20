import { decrypt, encrypt } from "../lib/crypto.js";
import { getSetting, setSetting } from "./settings.js";
import { scrapeWithSession } from "./scraper.js";

/**
 * Config du scraping "portail électeurs" : URL du fichier des électeurs et
 * session (cookies/stockage) déjà authentifiée, obtenue hors ligne via le
 * script local (connexion manuelle, captcha compris) puis importée ici —
 * voir scraper.ts scrapeWithSession(). Un seul portail, pas de scoping par
 * académie contrairement à scraping_config (CCMMEP/académique) : stockée
 * dans app_settings comme la clé API Brevo ou Mistral.
 */

export function isElecteursSessionConfigured(): boolean {
  return Boolean(getSetting("electeurs_session_state"));
}

export function saveElecteursConfig(fileUrl: string, sessionState: unknown): void {
  setSetting("electeurs_file_url", fileUrl);
  setSetting("electeurs_session_state", encrypt(JSON.stringify(sessionState)));
  setSetting("electeurs_session_updated_at", new Date().toISOString());
}

export interface ElecteursConfigStatus {
  configured: boolean;
  fileUrl: string | null;
  updatedAt: string | null;
}

export function getElecteursConfigStatus(): ElecteursConfigStatus {
  return {
    configured: isElecteursSessionConfigured(),
    fileUrl: getSetting("electeurs_file_url"),
    updatedAt: getSetting("electeurs_session_updated_at"),
  };
}

export async function fetchElecteursFile(): Promise<string> {
  const encrypted = getSetting("electeurs_session_state");
  const fileUrl = getSetting("electeurs_file_url");
  if (!encrypted || !fileUrl) {
    throw new Error("Session ou URL du fichier non configurée (onglet Fichier électeur).");
  }
  const sessionState = JSON.parse(decrypt(encrypted));
  return scrapeWithSession(sessionState, fileUrl);
}
