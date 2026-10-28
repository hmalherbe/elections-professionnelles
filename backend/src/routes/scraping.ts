import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { saveElecteursConfig, getElecteursConfigStatus, fetchElecteursFile } from "../services/electeursScraping.js";

const router = Router();
router.use(requireAuth);

/**
 * Aperçu sans import : essaie de parser le fichier récupéré en JSON (tableau
 * brut ou { items: [...] }, comme pour les émargements) pour en extraire le
 * nombre de lignes et les noms de champs ; sinon renvoie un simple extrait
 * texte, pour diagnostiquer un format imprévu.
 */
function previewScrapedFile(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : null;
    if (items) {
      return {
        format: "json",
        itemCount: items.length,
        fields: items.length > 0 ? Object.keys(items[0]) : [],
        sample: items.slice(0, 3),
      };
    }
    return { format: "json", fields: Object.keys(parsed ?? {}), sample: parsed };
  } catch {
    return { format: "text", length: raw.length, preview: raw.slice(0, 2000) };
  }
}

/**
 * Portail ÉLECTEURS : protégé par un captcha à chaque connexion (voir
 * services/electeursScraping.ts). Pas de login automatisé : seulement la
 * réutilisation d'une session déjà ouverte manuellement via le script local
 * fourni, puis importée ci-dessous.
 */
router.get("/electeurs/config", requireRole("admin_general"), (_req, res) => {
  res.json(getElecteursConfigStatus());
});

router.put("/electeurs/config", requireRole("admin_general"), (req, res) => {
  const { fileUrl, sessionState } = req.body ?? {};
  if (fileUrl === undefined && sessionState === undefined) {
    res.status(400).json({ error: "fileUrl ou sessionState requis." });
    return;
  }
  try {
    saveElecteursConfig(typeof fileUrl === "string" ? fileUrl.trim() : undefined, sessionState);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: `Fichier de session invalide : ${(err as Error).message}` });
  }
});

router.post("/electeurs/run", requireRole("admin_general"), async (_req, res) => {
  try {
    const { text, sourceUrl } = await fetchElecteursFile();
    res.json({ ...previewScrapedFile(text), sourceUrl });
  } catch (err) {
    res.status(502).json({ error: `Échec de la récupération : ${(err as Error).message}` });
  }
});

export default router;
