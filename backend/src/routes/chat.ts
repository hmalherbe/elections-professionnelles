import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { buildToolsForRole, executeTool } from "../services/chatTools.js";
import { chatWithTools, isMistralConfigured, saveMistralApiKey, type ChatMessage } from "../services/mistral.js";

const router = Router();
router.use(requireAuth);

// Accessible à tous les rôles authentifiés (lecture seule) : permet à
// l'admin académique/Spelc de savoir si l'assistant a été configuré par
// l'admin général, sans exposer la clé elle-même.
router.get("/config", (_req, res) => {
  res.json({ configured: isMistralConfigured() });
});

router.put("/config", requireRole("admin_general"), (req, res) => {
  const apiKey = String(req.body?.apiKey ?? "").trim();
  if (!apiKey) {
    res.status(400).json({ error: "Clé API requise." });
    return;
  }
  saveMistralApiKey(apiKey);
  res.json({ ok: true });
});

function systemPromptFor(role: string, academie: string | null, spelc: string | null): string {
  const base =
    "Tu es l'assistant de l'application « Élections professionnelles 2026 » (scrutin CCMMEP et scrutins " +
    "académiques locaux). Tu réponds en français, de façon concise, en te basant EXCLUSIVEMENT sur les résultats " +
    "des outils mis à ta disposition — n'invente jamais de chiffre. Si une question sort du périmètre de " +
    "données auquel tu as accès, dis-le clairement plutôt que de deviner. Les taux de participation sont à " +
    "exprimer en pourcentage avec une décimale. Tu peux aussi consulter les documents déposés dans l'onglet " +
    "« Documents » : utilise lister_documents pour voir les titres disponibles, puis lire_document pour en lire " +
    "le contenu si la question porte dessus — certains types de fichiers (ex. images) n'ont pas de contenu " +
    "extractible, dis-le si lire_document l'indique.";

  if (role === "admin_general") {
    return `${base} Tu t'adresses à l'admin général : il a accès à l'ensemble des données (scrutin national CCMMEP, toutes les académies, tous les Spelcs, y compris les adhérents).`;
  }
  if (role === "admin_academique") {
    return `${base} Tu t'adresses à l'admin de l'académie « ${academie} ». Tu ne dois répondre qu'avec les données de cette académie (scrutin national filtré sur l'académie, et scrutin académique local) — jamais celles d'une autre académie, et jamais de données d'adhérents (propres aux Spelcs).`;
  }
  return `${base} Tu t'adresses à l'admin du Spelc « ${spelc} ». Tu ne dois répondre qu'avec les données de ce Spelc (participation de ses adhérents et non-adhérents au scrutin national et local) — jamais celles d'un autre Spelc ou d'une autre académie.`;
}

router.post("/", async (req, res) => {
  if (!isMistralConfigured()) {
    res.status(400).json({ error: "L'assistant n'est pas encore configuré (clé API Mistral manquante)." });
    return;
  }
  const incoming = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const messages: ChatMessage[] = incoming
    .filter((m: unknown): m is { role: string; content: string } => {
      const msg = m as { role?: unknown; content?: unknown };
      return (msg.role === "user" || msg.role === "assistant") && typeof msg.content === "string";
    })
    .slice(-20)
    .map((m: { role: string; content: string }) => ({
      role: m.role as "user" | "assistant",
      content: m.content.slice(0, 4000),
    }));

  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    res.status(400).json({ error: "Un message utilisateur est requis." });
    return;
  }

  const user = req.user!;
  const tools = buildToolsForRole(user.role);
  const system: ChatMessage = { role: "system", content: systemPromptFor(user.role, user.academie, user.spelc) };

  try {
    const reply = await chatWithTools([system, ...messages], tools, (name, args) => executeTool(name, args, user));
    res.json({ reply });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

export default router;
