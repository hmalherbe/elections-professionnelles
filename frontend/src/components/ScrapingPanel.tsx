import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Card } from "./Card";

interface ScrapingConfigResponse {
  configured: boolean;
  portalUrl?: string;
  username?: string;
  fileUrl1?: string;
  fileUrl2?: string | null;
  usernameSelector?: string | null;
  passwordSelector?: string | null;
  submitSelector?: string | null;
}

/**
 * Récupération automatique (scraping Playwright, en arrière-plan) des
 * fichiers JSON depuis le portail de gestion. Un seul composant pour les
 * deux cas : national (1 fichier) et académique (1er + 2nd degré).
 */
// Faux portail de test (service mock-portal, voir docker-compose.yml) : mêmes
// valeurs par défaut pour le national et les scrutins académiques, à remplacer
// par les vraies URLs une fois les portails réels ouverts en décembre.
const DEFAULT_PORTAL_URL = "http://mock-portal:8081/login";
const DEFAULT_FILE_URLS: Record<"national" | "academique", { url1: string; url2: string }> = {
  national: { url1: "http://mock-portal:8081/ccmmep.json", url2: "" },
  academique: { url1: "http://mock-portal:8081/academie/1d.json", url2: "http://mock-portal:8081/academie/2d.json" },
};

export function ScrapingPanel({ mode }: { mode: "national" | "academique" }) {
  const [configured, setConfigured] = useState(false);
  const [portalUrl, setPortalUrl] = useState(DEFAULT_PORTAL_URL);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fileUrl1, setFileUrl1] = useState(DEFAULT_FILE_URLS[mode].url1);
  const [fileUrl2, setFileUrl2] = useState(DEFAULT_FILE_URLS[mode].url2);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [usernameSelector, setUsernameSelector] = useState("");
  const [passwordSelector, setPasswordSelector] = useState("");
  const [submitSelector, setSubmitSelector] = useState("");
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function refresh() {
    api.get<ScrapingConfigResponse>("/scraping/config").then((r) => {
      setConfigured(r.configured);
      if (r.configured) {
        setPortalUrl(r.portalUrl ?? "");
        setUsername(r.username ?? "");
        setFileUrl1(r.fileUrl1 ?? "");
        setFileUrl2(r.fileUrl2 ?? "");
        setUsernameSelector(r.usernameSelector ?? "");
        setPasswordSelector(r.passwordSelector ?? "");
        setSubmitSelector(r.submitSelector ?? "");
      }
    });
  }
  useEffect(refresh, []);

  async function saveConfig() {
    setSavedMessage(null);
    try {
      await api.put("/scraping/config", {
        portalUrl,
        username,
        password: password || undefined,
        fileUrl1,
        fileUrl2: mode === "academique" ? fileUrl2 : undefined,
        usernameSelector: usernameSelector || undefined,
        passwordSelector: passwordSelector || undefined,
        submitSelector: submitSelector || undefined,
      });
      setPassword("");
      setSavedMessage("Configuration enregistrée.");
      refresh();
    } catch (err) {
      setSavedMessage((err as Error).message);
    }
  }

  async function runScraping() {
    setBusy(true);
    setRunMessage(null);
    try {
      const res = await api.post<Record<string, { rowCount: number; votants: number }>>("/scraping/run", {});
      const parts = Object.entries(res).map(([key, r]) => `${key} : ${r.rowCount} lignes, ${r.votants} votants`);
      setRunMessage(parts.join(" · "));
    } catch (err) {
      setRunMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Récupération automatique (scraping)"
      subtitle={
        mode === "national"
          ? "Se connecte au portail de gestion CCMMEP et récupère le fichier national, sans navigateur visible."
          : "Se connecte au portail académique et récupère les fichiers 1er et 2nd degré, sans navigateur visible."
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-slate-500">URL de la page de connexion</label>
          <input
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            placeholder="https://portail-exemple.fr/login"
            value={portalUrl}
            onChange={(e) => setPortalUrl(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500">Identifiant</label>
          <input
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500">
            Mot de passe {configured && <span className="text-slate-400">(laisser vide pour ne pas changer)</span>}
          </label>
          <input
            type="password"
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className={mode === "academique" ? "" : "sm:col-span-2"}>
          <label className="block text-xs font-medium text-slate-500">
            URL du fichier{mode === "academique" ? " — 1er degré" : ""}
          </label>
          <input
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            placeholder="https://portail-exemple.fr/ccmmep.json"
            value={fileUrl1}
            onChange={(e) => setFileUrl1(e.target.value)}
          />
        </div>
        {mode === "academique" && (
          <div>
            <label className="block text-xs font-medium text-slate-500">URL du fichier — 2nd degré</label>
            <input
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              placeholder="https://portail-exemple.fr/academie/2d.json"
              value={fileUrl2}
              onChange={(e) => setFileUrl2(e.target.value)}
            />
          </div>
        )}
      </div>

      <button
        type="button"
        className="mt-2 text-xs text-slate-500 underline hover:text-slate-700"
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? "Masquer les options avancées" : "Options avancées (sélecteurs du formulaire)"}
      </button>
      {showAdvanced && (
        <div className="mt-2 grid grid-cols-1 gap-3 rounded-md bg-slate-50 p-3 sm:grid-cols-3">
          <p className="text-xs text-slate-500 sm:col-span-3">
            À renseigner uniquement si le formulaire de connexion du vrai portail diffère du cas standard (champ
            identifiant nommé "username", mot de passe "password", bouton de type "submit"). Laisser vide sinon.
          </p>
          <div>
            <label className="block text-xs font-medium text-slate-500">Sélecteur CSS — identifiant</label>
            <input
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              placeholder='input[name="username"]'
              value={usernameSelector}
              onChange={(e) => setUsernameSelector(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500">Sélecteur CSS — mot de passe</label>
            <input
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              placeholder='input[name="password"]'
              value={passwordSelector}
              onChange={(e) => setPasswordSelector(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500">Sélecteur CSS — bouton de connexion</label>
            <input
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              placeholder='button[type="submit"]'
              value={submitSelector}
              onChange={(e) => setSubmitSelector(e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          onClick={saveConfig}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900"
        >
          Enregistrer la configuration
        </button>
        <button
          disabled={!configured || busy}
          onClick={runScraping}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {busy ? "Récupération en cours…" : "Récupérer le(s) fichier(s) maintenant"}
        </button>
      </div>
      {savedMessage && <p className="mt-2 text-sm text-slate-600">{savedMessage}</p>}
      {runMessage && <p className="mt-2 text-sm text-slate-600">{runMessage}</p>}
    </Card>
  );
}
