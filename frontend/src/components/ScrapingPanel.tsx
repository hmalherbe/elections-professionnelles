import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Card } from "./Card";
import type { ImportRecord } from "../lib/types";

interface ScrapingConfigResponse {
  configured: boolean;
  portalUrl?: string;
  username?: string;
  fileUrl1?: string;
  fileUrl2?: string | null;
  usernameSelector?: string | null;
  passwordSelector?: string | null;
  submitSelector?: string | null;
  scrutinPageUrl?: string | null;
  scrutinSelector?: string | null;
  scrutinValue1D?: string | null;
  scrutinValue2D?: string | null;
  downloadTriggerSelector?: string | null;
  scheduleTimes?: string[];
}

const MAX_SCHEDULE_TIMES = 3;

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

function formatImportDate(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

/** Le dernier import (manuel ou par scraping) le plus récent d'une liste, ou null si aucun. */
function lastImport(imports: ImportRecord[]): ImportRecord | null {
  if (imports.length === 0) return null;
  return imports.reduce((latest, imp) => (imp.imported_at > latest.imported_at ? imp : latest), imports[0]);
}

function describeImport(imp: ImportRecord): string {
  return `${formatImportDate(imp.imported_at)} — ${imp.row_count} électeur(s), ${imp.votants ?? 0} votant(s)`;
}

export function ScrapingPanel({
  mode,
  imports,
  onImported,
}: {
  mode: "national" | "academique";
  /** Historique des imports (national et académique confondus) : sert à afficher la date du dernier téléchargement. */
  imports: ImportRecord[];
  /** Appelé après un scraping réussi, pour que le parent rafraîchisse son historique des imports. */
  onImported?: () => void;
}) {
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
  const [useScrutinSelector, setUseScrutinSelector] = useState(false);
  const [scrutinPageUrl, setScrutinPageUrl] = useState(
    mode === "academique" ? "http://mock-portal:8081/academie/scrutin" : ""
  );
  const [scrutinSelector, setScrutinSelector] = useState(mode === "academique" ? "#scrutin-select" : "");
  const [scrutinValue1D, setScrutinValue1D] = useState(mode === "academique" ? "1D" : "");
  const [scrutinValue2D, setScrutinValue2D] = useState(mode === "academique" ? "2D" : "");
  const [downloadTriggerSelector, setDownloadTriggerSelector] = useState(
    mode === "academique" ? "#scrutin-download" : ""
  );
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scheduleTimes, setScheduleTimes] = useState<string[]>(["", "", ""]);
  const [scheduleMessage, setScheduleMessage] = useState<string | null>(null);
  const [scheduleBusy, setScheduleBusy] = useState(false);

  function refresh() {
    api.get<ScrapingConfigResponse>("/scraping/config").then((r) => {
      setConfigured(r.configured);
      const times = r.scheduleTimes ?? [];
      setScheduleTimes(Array.from({ length: MAX_SCHEDULE_TIMES }, (_, i) => times[i] ?? ""));
      if (r.configured) {
        setPortalUrl(r.portalUrl ?? "");
        setUsername(r.username ?? "");
        setFileUrl1(r.fileUrl1 ?? "");
        setFileUrl2(r.fileUrl2 ?? "");
        setUsernameSelector(r.usernameSelector ?? "");
        setPasswordSelector(r.passwordSelector ?? "");
        setSubmitSelector(r.submitSelector ?? "");
        setUseScrutinSelector(Boolean(r.scrutinSelector));
        setScrutinPageUrl(r.scrutinPageUrl ?? "");
        setScrutinSelector(r.scrutinSelector ?? "");
        setScrutinValue1D(r.scrutinValue1D ?? "");
        setScrutinValue2D(r.scrutinValue2D ?? "");
        setDownloadTriggerSelector(r.downloadTriggerSelector ?? "");
      } else {
        // Tant qu'aucune configuration réelle n'a été enregistrée (mode
        // test contre le faux portail mock-portal), on pré-remplit
        // l'identifiant et le mot de passe pour éviter d'aller les chercher
        // dans le .env à chaque essai.
        api
          .get<{ username: string; password: string }>("/scraping/test-credentials")
          .then((creds) => {
            setUsername(creds.username);
            setPassword(creds.password);
          })
          .catch(() => {});
      }
    });
  }
  useEffect(refresh, []);

  async function saveConfig() {
    setSavedMessage(null);
    try {
      const useScrutin = mode === "academique" && useScrutinSelector;
      await api.put("/scraping/config", {
        portalUrl,
        username,
        password: password || undefined,
        fileUrl1,
        fileUrl2: mode === "academique" && !useScrutin ? fileUrl2 : undefined,
        usernameSelector: usernameSelector || undefined,
        passwordSelector: passwordSelector || undefined,
        submitSelector: submitSelector || undefined,
        scrutinPageUrl: useScrutin ? scrutinPageUrl || undefined : undefined,
        scrutinSelector: useScrutin ? scrutinSelector || undefined : undefined,
        scrutinValue1D: useScrutin ? scrutinValue1D || undefined : undefined,
        scrutinValue2D: useScrutin ? scrutinValue2D || undefined : undefined,
        downloadTriggerSelector: useScrutin ? downloadTriggerSelector || undefined : undefined,
      });
      setPassword("");
      setSavedMessage("Configuration enregistrée.");
      refresh();
    } catch (err) {
      setSavedMessage((err as Error).message);
    }
  }

  async function saveSchedule() {
    setScheduleBusy(true);
    setScheduleMessage(null);
    try {
      const times = scheduleTimes.filter(Boolean);
      await api.put("/scraping/schedule", { times });
      setScheduleMessage(
        times.length > 0
          ? `Scraping automatique programmé à ${times.join(", ")} (heure de Paris).`
          : "Scraping automatique désactivé."
      );
    } catch (err) {
      setScheduleMessage((err as Error).message);
    } finally {
      setScheduleBusy(false);
    }
  }

  async function runScraping() {
    setBusy(true);
    setRunMessage(null);
    try {
      const res = await api.post<
        Record<string, { rowCount: number; votants: number } | { nom: string; prenom: string }[] | undefined>
      >("/scraping/run", {});
      const { crossDegreDuplicates, ...results } = res;
      const parts = Object.entries(results).map(
        ([key, r]) => `${key} : ${(r as { rowCount: number }).rowCount} lignes, ${(r as { votants: number }).votants} votants`
      );
      let message = parts.join(" · ");
      if (Array.isArray(crossDegreDuplicates) && crossDegreDuplicates.length > 0) {
        const names = crossDegreDuplicates.map((p) => `${p.prenom} ${p.nom}`).join(", ");
        message += ` — Attention : ${crossDegreDuplicates.length} personne(s) présente(s) dans les deux fichiers (${names}), vérifiez qu'ils ne se chevauchent pas.`;
      }
      setRunMessage(message);
      onImported?.();
    } catch (err) {
      setRunMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const lastDownloadLabel =
    mode === "national"
      ? (() => {
          const last = lastImport(imports.filter((i) => i.scope === "national"));
          return last ? `Dernier téléchargement : ${describeImport(last)}.` : "Aucun téléchargement pour l'instant.";
        })()
      : (() => {
          const last1D = lastImport(imports.filter((i) => i.degre === "1D"));
          const last2D = lastImport(imports.filter((i) => i.degre === "2D"));
          if (!last1D && !last2D) return "Aucun téléchargement pour l'instant.";
          return (
            `Dernier téléchargement — 1er degré : ${last1D ? describeImport(last1D) : "jamais"}` +
            ` · 2nd degré : ${last2D ? describeImport(last2D) : "jamais"}.`
          );
        })();

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
        {!(mode === "academique" && useScrutinSelector) && (
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
        )}
        {mode === "academique" && !useScrutinSelector && (
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

      {mode === "academique" && (
        <div className="mt-3">
          <label className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <input
              type="checkbox"
              checked={useScrutinSelector}
              onChange={(e) => setUseScrutinSelector(e.target.checked)}
            />
            Le portail n'a qu'une seule page avec un menu déroulant pour choisir le scrutin (CCMI/CCMA), plutôt que
            deux URL distinctes
          </label>
          {useScrutinSelector && (
            <div className="mt-2 grid grid-cols-1 gap-3 rounded-md bg-slate-50 p-3 sm:grid-cols-2">
              <p className="text-xs text-slate-500 sm:col-span-2">
                Après connexion, la page ci-dessous est ouverte une fois par degré : le menu déroulant est réglé sur
                chaque valeur, puis le fichier est récupéré — qu'il soit livré par téléchargement classique ou par
                une requête JSON en arrière-plan. Les sélecteurs et valeurs exacts se trouvent en inspectant le vrai
                portail une fois ouvert (clic droit → Inspecter sur le menu et le bouton).
              </p>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-500">URL de la page du scrutin</label>
                <input
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  placeholder="https://portail-exemple.fr/academie/scrutin"
                  value={scrutinPageUrl}
                  onChange={(e) => setScrutinPageUrl(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500">Sélecteur CSS — menu déroulant</label>
                <input
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  placeholder='select[name="type"]'
                  value={scrutinSelector}
                  onChange={(e) => setScrutinSelector(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500">
                  Sélecteur CSS — bouton de téléchargement (si nécessaire)
                </label>
                <input
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  placeholder="#scrutin-download"
                  value={downloadTriggerSelector}
                  onChange={(e) => setDownloadTriggerSelector(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500">Valeur du menu — 1er degré (CCMI)</label>
                <input
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  placeholder="1D"
                  value={scrutinValue1D}
                  onChange={(e) => setScrutinValue1D(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500">Valeur du menu — 2nd degré (CCMA)</label>
                <input
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  placeholder="2D"
                  value={scrutinValue2D}
                  onChange={(e) => setScrutinValue2D(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>
      )}

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
      <p className="mt-2 text-xs text-slate-500">{lastDownloadLabel}</p>
      {savedMessage && <p className="mt-2 text-sm text-slate-600">{savedMessage}</p>}
      {runMessage && <p className="mt-2 text-sm text-slate-600">{runMessage}</p>}

      <div className="mt-4 border-t border-slate-200 pt-3">
        <p className="text-sm font-medium text-slate-700">Horaires automatiques</p>
        <p className="mt-1 text-xs text-slate-500">
          Jusqu'à 3 horaires par jour (heure de Paris) pour déclencher automatiquement la récupération
          {mode === "academique"
            ? " des fichiers 1er et 2nd degré (mêmes horaires pour les deux scrutins)."
            : " du fichier national."}{" "}
          Laisser un champ vide pour ne pas l'utiliser.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {scheduleTimes.map((t, i) => (
            <input
              key={i}
              type="time"
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              value={t}
              onChange={(e) => {
                const next = [...scheduleTimes];
                next[i] = e.target.value;
                setScheduleTimes(next);
              }}
            />
          ))}
          <button
            disabled={!configured || scheduleBusy}
            onClick={saveSchedule}
            className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-60"
          >
            Enregistrer les horaires
          </button>
        </div>
        {scheduleMessage && <p className="mt-2 text-sm text-slate-600">{scheduleMessage}</p>}
      </div>
    </Card>
  );
}
