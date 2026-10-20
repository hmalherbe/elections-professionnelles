import { decrypt, encrypt } from "../lib/crypto.js";
import { getSetting, setSetting } from "./settings.js";
import { scrapeWithSession, type ScrapedWithSession } from "./scraper.js";

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

/**
 * fileUrl et sessionState s'enregistrent indépendamment l'un de l'autre :
 * changer l'URL du fichier ne doit pas obliger à ré-uploader une session
 * encore valide, et inversement.
 */
export function saveElecteursConfig(fileUrl?: string, sessionState?: unknown): void {
  if (fileUrl !== undefined) setSetting("electeurs_file_url", fileUrl);
  if (sessionState !== undefined) {
    setSetting("electeurs_session_state", encrypt(JSON.stringify(sessionState)));
    setSetting("electeurs_session_updated_at", new Date().toISOString());
  }
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

export async function fetchElecteursFile(): Promise<ScrapedWithSession> {
  const encrypted = getSetting("electeurs_session_state");
  const fileUrl = getSetting("electeurs_file_url");
  if (!encrypted || !fileUrl) {
    throw new Error("Session ou URL du fichier non configurée (onglet Fichier électeur).");
  }
  const sessionState = JSON.parse(decrypt(encrypted));
  return scrapeWithSession(sessionState, fileUrl);
}
