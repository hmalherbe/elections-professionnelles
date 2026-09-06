/**
 * Faux portail de gestion CCMMEP/académique, utilisé uniquement pour
 * tester le scraping Playwright avant l'ouverture des vrais portails en
 * décembre. Reproduit le minimum réaliste : une page de connexion HTML
 * (formulaire identifiant/mot de passe), une session par cookie, et des
 * fichiers JSON protégés derrière l'authentification.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");

const PORT = process.env.PORT || 8081;
const USERNAME = process.env.PORTAL_USERNAME || "test";
const PASSWORD = process.env.PORTAL_PASSWORD || "test";
const SESSION_COOKIE = "portal_session";

const sessions = new Set();

const app = express();
app.use(express.urlencoded({ extended: false }));

function isAuthenticated(req) {
  const token = req.headers.cookie
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  return Boolean(token && sessions.has(token));
}

function requireAuth(req, res, next) {
  if (!isAuthenticated(req)) {
    res.redirect("/login");
    return;
  }
  next();
}

app.get("/login", (req, res) => {
  const error = req.query.error
    ? '<p style="color:#b91c1c">Identifiant ou mot de passe incorrect.</p>'
    : "";
  res.type("html").send(`
    <!doctype html>
    <html lang="fr">
    <head><meta charset="utf-8"><title>Portail de gestion (test)</title></head>
    <body style="font-family: sans-serif; max-width: 360px; margin: 80px auto;">
      <h1>Portail de gestion (environnement de test)</h1>
      ${error}
      <form method="POST" action="/login">
        <div style="margin-bottom: 12px;">
          <label>Identifiant<br><input type="text" name="username" autocomplete="username"></label>
        </div>
        <div style="margin-bottom: 12px;">
          <label>Mot de passe<br><input type="password" name="password" autocomplete="current-password"></label>
        </div>
        <button type="submit">Se connecter</button>
      </form>
    </body>
    </html>
  `);
});

app.post("/login", (req, res) => {
  const { username, password } = req.body ?? {};
  if (username === USERNAME && password === PASSWORD) {
    const token = crypto.randomBytes(24).toString("hex");
    sessions.add(token);
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${token}; HttpOnly; Path=/`);
    res.redirect("/");
    return;
  }
  res.redirect("/login?error=1");
});

app.get("/logout", (req, res) => {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0`);
  res.redirect("/login");
});

app.get("/", requireAuth, (_req, res) => {
  res.type("html").send(`
    <!doctype html>
    <html lang="fr">
    <head><meta charset="utf-8"><title>Portail de gestion (test)</title></head>
    <body style="font-family: sans-serif; max-width: 480px; margin: 80px auto;">
      <h1>Fichiers disponibles</h1>
      <ul>
        <li><a id="ccmmep-link" href="/ccmmep.json">Fichier CCMMEP national</a></li>
        <li><a id="academie-1d-link" href="/academie/1d.json">Fichier académique — 1er degré</a></li>
        <li><a id="academie-2d-link" href="/academie/2d.json">Fichier académique — 2nd degré</a></li>
        <li><a id="academie-scrutin-link" href="/academie/scrutin">Scrutin académique (menu déroulant)</a></li>
      </ul>
      <p><a href="/logout">Se déconnecter</a></p>
    </body>
    </html>
  `);
});

/**
 * Simule le cas — anticipé, réel portail non encore ouvert — d'un portail
 * qui n'expose PAS deux URL distinctes par degré mais UNE seule page avec
 * un menu déroulant pour choisir le scrutin (CCMI/CCMA), le fichier étant
 * ensuite livré comme un vrai téléchargement (Content-Disposition) suite à
 * la soumission du formulaire.
 */
app.get("/academie/scrutin", requireAuth, (_req, res) => {
  res.type("html").send(`
    <!doctype html>
    <html lang="fr">
    <head><meta charset="utf-8"><title>Scrutin académique (test)</title></head>
    <body style="font-family: sans-serif; max-width: 480px; margin: 80px auto;">
      <h1>Choix du scrutin</h1>
      <form method="GET" action="/academie/scrutin/download">
        <label>Scrutin<br>
          <select name="type" id="scrutin-select">
            <option value="1D">1er degré (CCMI)</option>
            <option value="2D">2nd degré (CCMA)</option>
          </select>
        </label>
        <p><button type="submit" id="scrutin-download">Télécharger le fichier JSON</button></p>
      </form>
    </body>
    </html>
  `);
});

app.get("/academie/scrutin/download", requireAuth, (req, res) => {
  const type = req.query.type === "2D" ? "2D" : "1D";
  const filename = type === "2D" ? "academie-2d.json" : "academie-1d.json";
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.type("application/json").send(fs.readFileSync(path.join(__dirname, "data", filename), "utf-8"));
});

function serveJson(filename) {
  return (req, res) => {
    res.type("application/json").send(fs.readFileSync(path.join(__dirname, "data", filename), "utf-8"));
  };
}

app.get("/ccmmep.json", requireAuth, serveJson("ccmmep.json"));
app.get("/academie/1d.json", requireAuth, serveJson("academie-1d.json"));
app.get("/academie/2d.json", requireAuth, serveJson("academie-2d.json"));

app.listen(PORT, () => {
  console.log(`Faux portail de test démarré sur le port ${PORT}`);
});
