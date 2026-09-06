import express from "express";
import cors from "cors";
import { migrate } from "./db/index.js";
import { refreshPendingRelanceTracking } from "./services/relanceTracking.js";
import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";
import importsRoutes from "./routes/imports.js";
import adherentsRoutes from "./routes/adherents.js";
import statsRoutes from "./routes/stats.js";
import brevoRoutes from "./routes/brevo.js";
import psaRoutes from "./routes/psa.js";
import scrapingRoutes from "./routes/scraping.js";
import chatRoutes from "./routes/chat.js";

migrate();

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/imports", importsRoutes);
app.use("/api/adherents", adherentsRoutes);
app.use("/api/stats", statsRoutes);
app.use("/api/brevo", brevoRoutes);
app.use("/api/psa", psaRoutes);
app.use("/api/scraping", scrapingRoutes);
app.use("/api/chat", chatRoutes);

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
