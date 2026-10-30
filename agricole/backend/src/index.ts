import express from "express";
import cors from "cors";
import path from "node:path";
import dns from "node:dns";
import { fileURLToPath } from "node:url";
import { migrate } from "./db/index.js";

/**
 * Certains réseaux Docker annoncent une route IPv6 non fonctionnelle : sans
 * ceci, une requête vers un hôte externe (ex. api.brevo.com) tente d'abord
 * IPv6, attend l'expiration de cette tentative avant de retomber sur IPv4.
 */
dns.setDefaultResultOrder("ipv4first");
import { refreshPendingRelanceTracking } from "./services/relanceTracking.js";
import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";
import importsRoutes from "./routes/imports.js";
import adherentsRoutes from "./routes/adherents.js";
import statsRoutes from "./routes/stats.js";
import brevoRoutes from "./routes/brevo.js";
import { UPLOADS_DIR } from "./lib/uploads.js";

migrate();

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Pictogrammes réseaux sociaux des mails de relance, servis en fichiers réels
// à une URL publique absolue (voir lib/socialLinks.ts).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use("/api/assets", express.static(path.resolve(__dirname, "../assets")));

// Logo uploadé par l'administrateur, stocké dans le volume persistant.
app.use("/api/uploads/logos", express.static(UPLOADS_DIR));

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/imports", importsRoutes);
app.use("/api/adherents", adherentsRoutes);
app.use("/api/stats", statsRoutes);
app.use("/api/brevo", brevoRoutes);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Erreur interne du serveur." });
});

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`API élections professionnelles agricoles démarrée sur le port ${port}`);
});

/**
 * Statut de livraison et clics des relances : jamais connus au moment de
 * l'envoi (Brevo les publie de façon asynchrone), donc sondés en
 * arrière-plan à intervalle régulier.
 */
const RELANCE_POLL_INTERVAL_MS = 5 * 60 * 1000;
setInterval(() => {
  refreshPendingRelanceTracking().catch((err) => {
    console.error("Échec du sondage périodique des statuts de relance:", err);
  });
}, RELANCE_POLL_INTERVAL_MS);
