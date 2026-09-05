import express from "express";
import cors from "cors";
import { migrate } from "./db/index.js";
import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";
import importsRoutes from "./routes/imports.js";
import adherentsRoutes from "./routes/adherents.js";
import statsRoutes from "./routes/stats.js";
import brevoRoutes from "./routes/brevo.js";
import psaRoutes from "./routes/psa.js";
import scrapingRoutes from "./routes/scraping.js";

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

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Erreur interne du serveur." });
});

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`API élections professionnelles démarrée sur le port ${port}`);
});
