import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Page, type BrowserContextOptions } from "playwright";

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

    const loginHint = "vérifiez l'identifiant/mot de passe et les sélecteurs de connexion.";
    const file1 = await fetchAuthenticated(page, config.fileUrl1);
    assertJsonLike(file1, config.fileUrl1, loginHint);
    const file2 = config.fileUrl2 ? await fetchAuthenticated(page, config.fileUrl2) : null;
    if (file2) assertJsonLike(file2, config.fileUrl2!, loginHint);

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

// Pour un endpoint JSON (pas une page HTML), "networkidle" peut ne jamais se
// déclencher (requêtes périodiques en arrière-plan côté portail) et bloquer
// la navigation indéfiniment malgré le timeout par défaut de Playwright :
// "load" suffit ici, la réponse elle-même nous intéresse, pas les éventuelles
// requêtes annexes que la page continuerait à faire après son chargement.
async function fetchAuthenticated(page: Page, url: string): Promise<string> {
  const response = await page.goto(url, { waitUntil: "load", timeout: GOTO_TIMEOUT_MS });
  if (!response || !response.ok()) {
    throw new Error(`Échec du téléchargement de ${url} (statut ${response?.status() ?? "inconnu"}).`);
  }
  return response.text();
}

/**
 * Un contenu qui commence par "<" indique le plus souvent une page HTML (ex.
 * renvoyé vers la page de connexion) plutôt que le fichier JSON attendu —
 * signe quasi certain d'une session invalide/expirée ou d'un identifiant
 * incorrect, plutôt qu'une erreur réseau franche. Utilisé uniquement pour le
 * pipeline d'import automatisé (scrapePortalFiles) où un échec net est
 * préférable à un contenu inexploitable silencieusement accepté ;
 * scrapeWithSession, lui, laisse volontairement passer un tel contenu tel
 * quel (voir previewScrapedFile côté route) pour que l'admin puisse lire le
 * texte réel renvoyé par le portail plutôt qu'une simple supposition.
 */
function assertJsonLike(text: string, url: string, loginHint: string): void {
  if (text.trimStart().startsWith("<")) {
    throw new Error(`Le contenu récupéré à ${url} n'est pas du JSON (probablement une page de connexion) — ${loginHint}`);
  }
}

const GOTO_TIMEOUT_MS = 20_000;
const LAUNCH_TIMEOUT_MS = 20_000;
const SCRAPE_SESSION_TIMEOUT_MS = 45_000;

/**
 * Borne une promesse dans le temps, quoi qu'il se passe en dessous (y
 * compris un blocage hors du contrôle de Playwright : mémoire serveur
 * saturée, réseau qui ne répond ni n'échoue franchement...). Sans ce filet,
 * un tel blocage laisse la requête HTTP — et le bouton côté interface —
 * figés indéfiniment plutôt que d'échouer proprement avec un message clair.
 */
function withHardTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Récupère un fichier à une URL protégée par authentification, en réutilisant
 * une session déjà ouverte (cookies/stockage sauvegardés via
 * context.storageState() après une connexion manuelle — captcha compris, voir
 * le script local fourni) plutôt qu'en rejouant un formulaire de connexion.
 * Headless comme le reste du scraping : l'étape manuelle (résolution du
 * captcha) a déjà eu lieu en amont, hors de ce processus.
 *
 * Appel "AJAX" fait depuis l'intérieur d'une page réellement chargée
 * (page.evaluate + fetch), pas une navigation de page (page.goto) ni un
 * appel hors-page (context.request) : sur un portail construit en
 * application monopage (SPA), l'URL de la liste des électeurs renvoie
 * systématiquement le squelette HTML de l'appli (connecté ou non) à une
 * navigation complète — seul le JavaScript de la page, une fois exécuté,
 * récupère le JSON via son propre appel interne. Un appel hors-page
 * (context.request) envoie les bons en-têtes Accept/X-Requested-With mais
 * pas l'Origin/Referer qu'un vrai navigateur ajoute automatiquement à un
 * fetch() déclenché depuis une page chargée — absence qui peut suffire à
 * faire échouer le serveur (statut 500 observé). On charge donc d'abord une
 * page de ce même site, puis on déclenche le fetch depuis l'intérieur.
 */
export async function scrapeWithSession(sessionState: BrowserContextOptions["storageState"], fileUrl: string): Promise<string> {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
    timeout: LAUNCH_TIMEOUT_MS,
  });
  try {
    return await withHardTimeout(
      (async () => {
        const context = await browser.newContext({ storageState: sessionState });
        const page = await context.newPage();
        const origin = new URL(fileUrl).origin;
        await page.goto(origin, { waitUntil: "load", timeout: GOTO_TIMEOUT_MS });
        return await page.evaluate(async (url) => {
          const res = await fetch(url, {
            headers: { Accept: "application/json, text/plain, */*", "X-Requested-With": "XMLHttpRequest" },
            credentials: "include",
          });
          return res.text();
        }, fileUrl);
      })(),
      SCRAPE_SESSION_TIMEOUT_MS,
      `Délai dépassé (${SCRAPE_SESSION_TIMEOUT_MS / 1000} s) lors de la récupération — le serveur manque peut-être de ` +
        "mémoire, ou le portail/la session ne répond pas. Réessayez ; si ça persiste, vérifiez la mémoire du serveur."
    );
  } finally {
    // Ferme le navigateur même si withHardTimeout a déjà rendu la main via le
    // timeout (l'opération interne continue sinon en arrière-plan et
    // accumulerait des processus Chromium orphelins à chaque échec).
    await browser.close().catch(() => {});
  }
}
