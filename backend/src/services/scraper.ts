import { chromium } from "playwright";

export interface ScrapingConfig {
  portalUrl: string;
  username: string;
  password: string;
  fileUrl1: string;
  fileUrl2?: string | null;
  usernameSelector?: string | null;
  passwordSelector?: string | null;
  submitSelector?: string | null;
}

const DEFAULT_USERNAME_SELECTOR = 'input[name="username"]';
const DEFAULT_PASSWORD_SELECTOR = 'input[name="password"]';
const DEFAULT_SUBMIT_SELECTOR = 'button[type="submit"]';

/**
 * Se connecte à un portail de gestion via un vrai navigateur headless
 * (Playwright), puis récupère le(s) fichier(s) JSON protégé(s) par la
 * session ouverte. Aucune fenêtre visible (headless: true) : c'est le mode
 * "caché" demandé, pas une option à activer séparément.
 */
export async function scrapePortalFiles(config: ScrapingConfig): Promise<{ file1: string; file2: string | null }> {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(config.portalUrl, { waitUntil: "networkidle" });
    await page.fill(config.usernameSelector || DEFAULT_USERNAME_SELECTOR, config.username);
    await page.fill(config.passwordSelector || DEFAULT_PASSWORD_SELECTOR, config.password);
    await Promise.all([
      page.waitForLoadState("networkidle"),
      page.click(config.submitSelector || DEFAULT_SUBMIT_SELECTOR),
    ]);

    const file1 = await fetchAuthenticated(page, config.fileUrl1);
    const file2 = config.fileUrl2 ? await fetchAuthenticated(page, config.fileUrl2) : null;

    return { file1, file2 };
  } finally {
    await browser.close();
  }
}

async function fetchAuthenticated(page: import("playwright").Page, url: string): Promise<string> {
  const response = await page.goto(url, { waitUntil: "networkidle" });
  if (!response || !response.ok()) {
    throw new Error(`Échec du téléchargement de ${url} (statut ${response?.status() ?? "inconnu"}).`);
  }
  const text = await response.text();
  // Un contenu qui commence par "<" indique le plus souvent une page HTML
  // (ex. renvoyé vers la page de connexion) plutôt que le fichier attendu —
  // signe quasi certain d'un identifiant/mot de passe ou d'un sélecteur
  // de connexion incorrect, plutôt qu'une erreur réseau franche.
  if (text.trimStart().startsWith("<")) {
    throw new Error(
      `Le contenu récupéré à ${url} n'est pas du JSON (probablement une page de connexion) — ` +
        `vérifiez l'identifiant/mot de passe et les sélecteurs de connexion.`
    );
  }
  return text;
}
