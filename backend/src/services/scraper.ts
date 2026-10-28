import { chromium, type BrowserContextOptions } from "playwright";

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
 * Headless : l'étape manuelle (résolution du captcha) a déjà eu lieu en
 * amont, hors de ce processus.
 *
 * Sur un portail construit en application monopage (SPA), charger l'URL de
 * la liste des électeurs renvoie systématiquement le squelette HTML de
 * l'appli (connecté ou non) — essayé en reproduisant nous-mêmes l'appel
 * interne (en-têtes Accept/X-Requested-With hors-page : toujours le
 * squelette, voire une erreur 500 une fois l'Origin/Referer ajoutés). Plutôt
 * que de continuer à deviner l'appel exact (en-têtes, jeton CSRF...), on
 * laisse la page se charger normalement — c'est alors SON PROPRE JavaScript
 * qui déclenche sa requête interne pour récupérer les données — et on
 * intercepte cette réponse JSON plutôt que de chercher à la reproduire.
 */
export interface ScrapedWithSession {
  text: string;
  /** URL réellement interceptée (requête JSON interne de la page) si elle a
   * été trouvée, sinon fileUrl lui-même (repli sur le contenu de la page) —
   * utile pour reproduire l'appel exact ailleurs (ex. script local de test). */
  sourceUrl: string;
}

export async function scrapeWithSession(
  sessionState: BrowserContextOptions["storageState"],
  fileUrl: string
): Promise<ScrapedWithSession> {
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

        // Armée AVANT la navigation, pour ne pas rater la requête interne si
        // elle part dès le tout début du chargement de la page.
        const apiResponsePromise = page
          .waitForResponse(
            (r) => r.request().resourceType() !== "document" && /json/i.test(r.headers()["content-type"] ?? ""),
            { timeout: GOTO_TIMEOUT_MS }
          )
          .catch(() => null);

        await page.goto(fileUrl, { waitUntil: "load", timeout: GOTO_TIMEOUT_MS });
        const apiResponse = await apiResponsePromise;
        if (apiResponse) return { text: await apiResponse.text(), sourceUrl: apiResponse.url() };

        // Repli : aucune requête JSON interne détectée avant expiration —
        // on renvoie le contenu de la page telle que rendue (après exécution
        // du JavaScript, donc potentiellement plus parlant que le squelette
        // initial : un formulaire de connexion affiché, un message d'erreur
        // rendu dans la page, etc.) plutôt que de perdre cette information.
        return { text: await page.content(), sourceUrl: fileUrl };
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
