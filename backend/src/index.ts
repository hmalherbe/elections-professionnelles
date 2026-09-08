import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "./db/index.js";
import { refreshPendingRelanceTracking } from "./services/relanceTracking.js";
import { startScrapingScheduler } from "./services/scrapingScheduler.js";
import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";
import importsRoutes from "./routes/imports.js";
import adherentsRoutes from "./routes/adherents.js";
import statsRoutes from "./routes/stats.js";
import brevoRoutes from "./routes/brevo.js";
import psaRoutes from "./routes/psa.js";
import scrapingRoutes from "./routes/scraping.js";
import chatRoutes from "./routes/chat.js";
import documentsRoutes from "./routes/documents.js";
import documentFoldersRoutes from "./routes/documentFolders.js";
import { UPLOADS_DIR } from "./lib/uploads.js";

migrate();

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Pictogrammes réseaux sociaux des mails de relance : servis en fichiers
// réels à une URL publique absolue (voir lib/socialLinks.ts) plutôt qu'en
// data URI, que de nombreux clients mail (Gmail, Outlook.com...) bloquent.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use("/api/assets", express.static(path.resolve(__dirname, "../assets")));

// Logos uploadés par les admins (PSA / Spelc) : mêmes raisons que ci-dessus,
// mais stockés dans le volume persistant (voir lib/uploads.ts) puisqu'il
// s'agit de contenu généré à l'exécution, pas d'un fichier versionné.
app.use("/api/uploads/logos", express.static(UPLOADS_DIR));

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/imports", importsRoutes);
app.use("/api/adherents", adherentsRoutes);
app.use("/api/stats", statsRoutes);
app.use("/api/brevo", brevoRoutes);
app.use("/api/psa", psaRoutes);
app.use("/api/scraping", scrapingRoutes);
app.use("/api/chat", chatRoutes);
// Monté avant documentsRoutes : /folders, /zip et /zip-import sont des chemins
// littéraux plus spécifiques que /:id de documentsRoutes, mais on garde cet
// ordre pour lever toute ambiguïté de résolution de route.
app.use("/api/documents", documentFoldersRoutes);
app.use("/api/documents", documentsRoutes);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Erreur interne du serveur." });
});

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`API élections professionnelles démarrée sur le port ${port}`);
});

/**
 * Statut de livraison et clics des relances : jamais connus au moment de
 * l'envoi (Brevo les publie de façon asynchrone), donc sondés en arrière-plan
 * à intervalle régulier plutôt qu'une seule fois. Ne bloque jamais le serveur
 * ni ne le fait planter en cas d'erreur réseau (ex. clé API invalide).
 */
const RELANCE_POLL_INTERVAL_MS = 5 * 60 * 1000;
setInterval(() => {
  refreshPendingRelanceTracking().catch((err) => {
    console.error("Échec du sondage périodique des statuts de relance:", err);
  });
}, RELANCE_POLL_INTERVAL_MS);

startScrapingScheduler();
