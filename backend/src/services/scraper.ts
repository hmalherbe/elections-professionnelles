import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Page } from "playwright";

export interface ScrapingConfig {
  portalUrl: string;
  username: string;
  password: string;
  fileUrl1: string;
  fileUrl2?: string | null;
  usernameSelector?: string | null;
  passwordSelector?: string | null;
  submitSelector?: string | null;
  /**
   * Mode alternatif pour un portail qui affiche les deux fichiers (1er et
   * 2nd degré) depuis UNE seule page via un menu déroulant, plutôt que deux
   * URL distinctes directement accessibles (cf. scrutinPageUrl/scrutinSelector
   * ci-dessous). Si scrutinSelector est renseigné, ce mode est utilisé à la
   * place de fileUrl1/fileUrl2.
   */
  scrutinPageUrl?: string | null;
  /** Sélecteur CSS du <select> de choix du scrutin. */
  scrutinSelector?: string | null;
  /** Valeur (attribut value de l'<option>) à sélectionner pour le 1er degré. */
  scrutinValue1D?: string | null;
  /** Valeur à sélectionner pour le 2nd degré. */
  scrutinValue2D?: string | null;
  /**
   * Sélecteur du bouton à cliquer après la sélection, si le changement de
   * valeur seul ne déclenche pas le téléchargement (cas le plus courant :
   * formulaire avec un bouton "Télécharger"/"Générer" explicite).
   */
  downloadTriggerSelector?: string | null;
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
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();

    await page.goto(config.portalUrl, { waitUntil: "networkidle" });
    await page.fill(config.usernameSelector || DEFAULT_USERNAME_SELECTOR, config.username);
    await page.fill(config.passwordSelector || DEFAULT_PASSWORD_SELECTOR, config.password);
    await Promise.all([
      page.waitForLoadState("networkidle"),
      page.click(config.submitSelector || DEFAULT_SUBMIT_SELECTOR),
    ]);

    if (config.scrutinSelector && config.scrutinValue1D) {
      const pageUrl = config.scrutinPageUrl || config.fileUrl1;
      await page.goto(pageUrl, { waitUntil: "networkidle" });
      const file1 = await selectScrutinAndCapture(page, config, config.scrutinValue1D);
      const file2 = config.scrutinValue2D ? await selectScrutinAndCapture(page, config, config.scrutinValue2D) : null;
      return { file1, file2 };
    }

    const file1 = await fetchAuthenticated(page, config.fileUrl1);
    const file2 = config.fileUrl2 ? await fetchAuthenticated(page, config.fileUrl2) : null;

    return { file1, file2 };
  } finally {
    await browser.close();
  }
}

/**
 * Sélectionne une valeur dans le menu déroulant du scrutin puis récupère le
 * JSON résultant, quel que soit le mécanisme utilisé par le portail : soit
 * un vrai téléchargement de fichier (Content-Disposition: attachment —
 * cas des portails qui font naviguer le formulaire), soit une réponse
 * réseau JSON déclenchée en arrière-plan (AJAX). On arme l'écoute des deux
 * AVANT l'action (sélection puis clic éventuel) pour ne rater ni l'un ni
 * l'autre, quel que soit celui qui se produit réellement.
 */
async function selectScrutinAndCapture(page: Page, config: ScrapingConfig, optionValue: string): Promise<string> {
  const downloadPromise = page.waitForEvent("download", { timeout: 20000 }).catch(() => null);
  const responsePromise = page
    .waitForResponse(
      (r) => r.request().resourceType() !== "document" && /json/i.test(r.headers()["content-type"] ?? ""),
      { timeout: 20000 }
    )
    .catch(() => null);

  await page.selectOption(config.scrutinSelector!, optionValue);
  if (config.downloadTriggerSelector) {
    await page.click(config.downloadTriggerSelector);
  }

  const [download, response] = await Promise.all([downloadPromise, responsePromise]);

  if (download) {
    const tmpFile = path.join(os.tmpdir(), `scraping-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    await download.saveAs(tmpFile);
    const content = fs.readFileSync(tmpFile, "utf-8");
    fs.unlinkSync(tmpFile);
    return content;
  }
  if (response) {
    return response.text();
  }
  throw new Error(
    `Aucun fichier JSON détecté après sélection de "${optionValue}" dans le menu déroulant — ` +
      `ni téléchargement, ni réponse réseau JSON. Vérifiez le sélecteur du menu et celui du bouton de téléchargement.`
  );
}

async function fetchAuthenticated(page: Page, url: string): Promise<string> {
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
