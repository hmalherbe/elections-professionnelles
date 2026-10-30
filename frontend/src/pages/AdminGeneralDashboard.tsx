import { Fragment, useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CamembertCard } from "../components/CamembertCard";
import { Card } from "../components/Card";
import { Ccm2022MapPanel } from "../components/Ccm2022MapPanel";
import { ChatAssistantPanel } from "../components/ChatAssistantPanel";
import { CourbeCard } from "../components/CourbeCard";
import { DocumentsPanel } from "../components/DocumentsPanel";
import { FileUploadCard } from "../components/FileUploadCard";
import { PivotTree } from "../components/PivotTree";
import { ScrutinsTab } from "../components/ScrutinsTab";
import { api } from "../lib/api";
import { CATEGORICAL } from "../lib/colors";
import type { AcademieNode, AcademieScrutin, CourbePoint, ImportRecord, ManagedUser, RelanceDailyPoint } from "../lib/types";

const TABS = [
  "Descriptif applicatif",
  "Vue nationale",
  "Résultats CCM 2022",
  "Scrutins",
  "Imports",
  "Electeurs académiques",
  "Fichier électeur",
  "Statistiques relances",
  "Utilisateurs",
  "Adhérents",
  "Référentiels",
  "Documents",
  "Assistant IA",
  "Paramètres",
] as const;
type Tab = (typeof TABS)[number];

export function AdminGeneralDashboard() {
  const [tab, setTab] = useState<Tab>("Vue nationale");

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              tab === t ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-100"
            } border border-slate-200`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Descriptif applicatif" && <DescriptifApplicatifTab />}
      {tab === "Vue nationale" && <VueNationale />}
      {tab === "Résultats CCM 2022" && <Ccm2022MapPanel />}
      {tab === "Scrutins" && <ScrutinsTab scope="national" />}
      {tab === "Imports" && <ImportsPanel />}
      {tab === "Electeurs académiques" && <ElecteursAcademiquesPanel />}
      {tab === "Fichier électeur" && <FichierElecteurPanel />}
      {tab === "Statistiques relances" && <StatistiquesRelancesPanel />}
      {tab === "Utilisateurs" && <UsersPanel />}
      {tab === "Adhérents" && <AdherentsAdminPanel />}
      {tab === "Référentiels" && <ReferentielsPanel />}
      {tab === "Documents" && <DocumentsAdminPanel />}
      {tab === "Assistant IA" && <ChatAssistantPanel />}
      {tab === "Paramètres" && <ParametresPanel />}
    </div>
  );
}

/**
 * Clé API Brevo unique, partagée par tous les syndicats adhérents pour
 * leurs campagnes de relance mail/SMS (voir services/brevo.ts côté
 * backend) — remplace l'ancienne clé configurée individuellement par
 * chaque admin Spelc.
 */
function ParametresPanel() {
  const [configured, setConfigured] = useState(false);
  const [maskedKey, setMaskedKey] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  function refresh() {
    api
      .get<{ configured: boolean; maskedKey: string | null }>("/admin/brevo-settings")
      .then((r) => {
        setConfigured(r.configured);
        setMaskedKey(r.maskedKey);
      });
  }
  useEffect(refresh, []);

  async function save() {
    setMessage(null);
    try {
      await api.put<{ configured: boolean; maskedKey: string | null }>("/admin/brevo-settings", { apiKey });
      setApiKey("");
      setMessage("Clé enregistrée.");
      refresh();
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <Card
        title="Clé API Brevo"
        subtitle={
          (configured ? `Configurée (${maskedKey}). ` : "Non configurée. ") +
          "Clé unique, utilisée pour les campagnes de relance mail/SMS de tous les syndicats adhérents."
        }
      >
        <div className="flex gap-2">
          <input
            type="password"
            placeholder="Clé API Brevo"
            className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <button
            disabled={!apiKey}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            onClick={save}
          >
            Enregistrer
          </button>
        </div>
        {message && <p className="mt-2 text-sm text-slate-600">{message}</p>}
      </Card>
    </div>
  );
}

/** Note de synthèse de l'application (fonctionnalités par profil, stack technique,
 * schéma de base de données) — page HTML statique servie telle quelle, éditée en
 * dehors du code source de l'application. */
function DescriptifApplicatifTab() {
  return (
    <iframe
      src="/descriptif-applicatif.html"
      title="Descriptif applicatif"
      className="h-[calc(100vh-180px)] w-full rounded-md border border-slate-200"
    />
  );
}

/** Une seule arborescence (scope="general") : une seule copie physique, jamais
 * dupliquée par académie, diffusée en lecture seule à toutes les académies —
 * ancienne UI de ciblage par académie (cases à cocher, copie physique par
 * académie cochée) supprimée : tous les documents déposés ici sont désormais
 * automatiquement diffusés à toutes les académies, ce qui évitait surtout de
 * saturer le disque du serveur avec des copies multiples de gros fichiers
 * (photos, archives). Pas de Spelc ici : la partie Spelc n'a plus d'onglet
 * Documents. */
function DocumentsAdminPanel() {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-700">Documents</h3>
        <p className="text-xs text-slate-500">
          Une seule copie, jamais dupliquée — ces documents sont diffusés en lecture seule à toutes les académies.
        </p>
      </div>
      <DocumentsPanel general />
    </div>
  );
}

function VueNationale() {
  const [tree, setTree] = useState<AcademieNode[]>([]);
  const [camembert, setCamembert] = useState({ votants: 0, nonVotants: 0 });
  const [courbe, setCourbe] = useState<CourbePoint[]>([]);

  useEffect(() => {
    api.get<{ tree: AcademieNode[] }>("/stats/participation-tree").then((r) => setTree(r.tree));
    api.get<{ votants: number; nonVotants: number }>("/stats/camembert?scope=national").then(setCamembert);
    api.get<{ points: CourbePoint[] }>("/stats/courbe?scope=national").then((r) => setCourbe(r.points));
  }, []);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <CamembertCard title="Participation CCMMEP (national)" votants={camembert.votants} nonVotants={camembert.nonVotants} />
        <CourbeCard title="Courbe de participation cumulée — CCMMEP" points={courbe} />
      </div>
      <PivotTree tree={tree} />
    </div>
  );
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function ImportsPanel() {
  const [imports, setImports] = useState<ImportRecord[]>([]);
  const [snapshotDate, setSnapshotDate] = useState(todayIso());

  function refresh() {
    api.get<{ imports: ImportRecord[] }>("/imports").then((r) => setImports(r.imports));
  }
  useEffect(refresh, []);

  async function handleDelete(id: number) {
    if (!confirm("Supprimer cet import et tous les émargements associés ?")) return;
    await api.delete(`/imports/${id}`);
    refresh();
  }

  return (
    <div className="space-y-4">
      <FileUploadCard
        title="Import quotidien CCMMEP"
        subtitle="Fichier JSON des émargements du scrutin national (champs : nom, prenom, dateEmargement, corps, affectation, referenceBulletin)."
        accept="application/json"
        extraFields={
          <div>
            <label className="mr-2 text-xs font-medium text-slate-500">Journée du scrutin représentée :</label>
            <input
              type="date"
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
              value={snapshotDate}
              onChange={(e) => setSnapshotDate(e.target.value)}
            />
          </div>
        }
        onUpload={async (file) => {
          const fd = new FormData();
          fd.append("file", file);
          fd.append("snapshotDate", snapshotDate);
          const res = await api.upload<{ rowCount: number; votants: number }>("/imports/ccmmep", fd);
          refresh();
          return `${res.rowCount} lignes importées, ${res.votants} votants.`;
        }}
      />
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        Les fichiers JSON <strong>1er et 2nd degré des scrutins académiques</strong> se déposent normalement depuis le
        tableau de bord de l'admin académique concerné, onglet « Imports ». Le tableau ci-dessous permet de le faire
        ici aussi, académie par académie, en cas de besoin (admin académique indisponible, dépôt centralisé...).
        L'historique plus bas liste tous les imports, nationaux et académiques confondus.
      </div>
      <AcademiqueImportsPanel />
      <Card title="Historique des imports">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
              <th className="py-2 pr-4">Date</th>
              <th className="px-4 py-2">Périmètre</th>
              <th className="px-4 py-2">Académie</th>
              <th className="px-4 py-2">Degré</th>
              <th className="px-4 py-2">Fichier</th>
              <th className="px-4 py-2">Lignes</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {imports.map((imp) => (
              <tr key={imp.id} className="border-b border-slate-100">
                <td className="py-1.5 pr-4">{imp.snapshot_date}</td>
                <td className="px-4 py-1.5">{imp.scope === "national" ? "National" : "Académique"}</td>
                <td className="px-4 py-1.5">{imp.academie ?? "—"}</td>
                <td className="px-4 py-1.5">{imp.degre ?? "—"}</td>
                <td className="px-4 py-1.5 text-slate-500">{imp.filename ?? "—"}</td>
                <td className="px-4 py-1.5 text-slate-500">{imp.row_count}</td>
                <td className="px-4 py-1.5 text-right">
                  {imp.scope === "academique" && (
                    <button className="text-xs text-red-600 hover:underline" onClick={() => handleDelete(imp.id)}>
                      Supprimer
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

type ImportStatus = { type: "ok" | "error"; message: string };

/**
 * Permet à l'admin général de déposer, pour n'importe quelle académie, les
 * fichiers JSON d'émargements académiques (1er/2nd degré), sans passer par
 * le compte de l'admin académique concerné. Les boutons sont étiquetés avec
 * le vrai nom du scrutin (CCMA/CCMI/CCMD...) de chaque académie — voir
 * ref_academie_scrutins.
 */
function AcademiqueImportsPanel() {
  const [rows, setRows] = useState<AcademieScrutin[]>([]);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<Record<string, ImportStatus>>({});

  useEffect(() => {
    api.get<{ academieScrutins: AcademieScrutin[] }>("/admin/reference/academie-scrutins").then((r) => setRows(r.academieScrutins));
  }, []);

  async function handleUpload(academie: string, degre: "1D" | "2D", file: File) {
    const key = `${academie}-${degre}`;
    setBusy((b) => ({ ...b, [key]: true }));
    setStatus((s) => {
      const next = { ...s };
      delete next[key];
      return next;
    });
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("degre", degre);
      fd.append("academie", academie);
      const res = await api.upload<{
        rowCount: number;
        votants: number;
        crossDegreDuplicates?: { nom: string; prenom: string }[];
      }>("/imports/academique", fd);
      let message = `${res.rowCount} lignes importées, ${res.votants} votants.`;
      if (res.crossDegreDuplicates?.length) {
        message += ` Attention : ${res.crossDegreDuplicates.length} doublon(s) 1er/2nd degré.`;
      }
      setStatus((s) => ({ ...s, [key]: { type: "ok", message } }));
    } catch (err) {
      setStatus((s) => ({ ...s, [key]: { type: "error", message: (err as Error).message } }));
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  }

  if (rows.length === 0) return null;

  return (
    <Card
      title="Import académique, académie par académie"
      subtitle="Fichier JSON des émargements du scrutin 1er ou 2nd degré (mêmes champs que le fichier CCMMEP), journée du jour."
    >
      <div className="max-h-96 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
              <th className="py-2 pr-4">Académie</th>
              <th className="px-4 py-2">1er degré</th>
              <th className="px-4 py-2">2nd degré</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.academie} className="border-b border-slate-100 align-top">
                <td className="py-2 pr-4 font-medium text-slate-700">{r.academie}</td>
                <td className="px-4 py-2">
                  <ImportCell
                    label={r.type1d || "1er degré"}
                    busy={!!busy[`${r.academie}-1D`]}
                    status={status[`${r.academie}-1D`]}
                    onFile={(file) => handleUpload(r.academie, "1D", file)}
                  />
                </td>
                <td className="px-4 py-2">
                  <ImportCell
                    label={r.type2d || "2nd degré"}
                    busy={!!busy[`${r.academie}-2D`]}
                    status={status[`${r.academie}-2D`]}
                    onFile={(file) => handleUpload(r.academie, "2D", file)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ImportCell({
  label,
  busy,
  status,
  onFile,
}: {
  label: string;
  busy: boolean;
  status?: ImportStatus;
  onFile: (file: File) => void;
}) {
  return (
    <div className="min-w-[180px] space-y-1">
      <label className="block text-xs font-medium text-slate-500">{label}</label>
      <input
        type="file"
        accept="application/json"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
        className="block w-full text-xs text-slate-600 file:mr-2 file:rounded-md file:border-0 file:bg-emerald-600 file:px-2 file:py-1 file:text-xs file:font-medium file:text-white hover:file:bg-emerald-700"
      />
      {busy && <p className="text-xs text-slate-400">Import en cours…</p>}
      {status && (
        <p className={`whitespace-pre-line text-xs ${status.type === "ok" ? "text-emerald-600" : "text-red-600"}`}>
          {status.message}
        </p>
      )}
    </div>
  );
}

interface ElecteursAcademiquesResponse {
  academies: { academie: string; degre1D: number; degre2D: number }[];
  skippedSansAcademie: number;
}

function ElecteursAcademiquesPanel() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ElecteursAcademiquesResponse | null>(null);

  async function charger() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.post<ElecteursAcademiquesResponse>("/imports/electeurs-academiques", {});
      setResult(res);
      const total = res.academies.reduce((sum, a) => sum + a.degre1D + a.degre2D, 0);
      let summary = `${total} électeur(s) répartis sur ${res.academies.length} académie(s).`;
      if (res.skippedSansAcademie > 0) {
        summary += ` ${res.skippedSansAcademie} électeur(s) du fichier national ignoré(s) (académie non identifiable à partir de leur adresse).`;
      }
      setMessage(summary);
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function supprimer() {
    if (!confirm("Supprimer les électeurs académiques générés à partir du fichier national ? Cette action est irréversible.")) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.delete<{ importsDeleted: number; emargementsDeleted: number }>("/imports/electeurs-academiques");
      setResult(null);
      setMessage(`${res.emargementsDeleted} électeur(s) supprimé(s) (${res.importsDeleted} import(s)).`);
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        Solution provisoire en attendant l'ouverture des vrais portails académiques (décembre) : répartit les
        électeurs du fichier national CCMMEP déjà importé dans leur académie (via leur département) et leur
        attribue un degré (1er ou 2nd) d'après le nom de leur établissement (« COLLEGE »/« LYCEE » → 2nd degré,
        « ECOLE » → 1er degré, sinon tirage aléatoire faute de règle plus précise). Chaque chargement remplace
        entièrement le jeu précédent.
      </div>
      <Card title="Électeurs académiques">
        <div className="flex flex-wrap items-center gap-3">
          <button
            disabled={busy}
            onClick={charger}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {busy ? "Chargement en cours…" : "Charger les électeurs des académies"}
          </button>
          <button
            disabled={busy}
            onClick={supprimer}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            Supprimer les électeurs académiques
          </button>
        </div>
        {message && <p className="mt-3 text-sm text-slate-600">{message}</p>}
        {result && result.academies.length > 0 && (
          <div className="mt-4 max-h-96 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                  <th className="py-2 pr-4">Académie</th>
                  <th className="px-4 py-2">1er degré</th>
                  <th className="px-4 py-2">2nd degré</th>
                  <th className="px-4 py-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {result.academies.map((a) => (
                  <tr key={a.academie} className="border-b border-slate-100">
                    <td className="py-1.5 pr-4">{a.academie}</td>
                    <td className="px-4 py-1.5 text-slate-500">{a.degre1D}</td>
                    <td className="px-4 py-1.5 text-slate-500">{a.degre2D}</td>
                    <td className="px-4 py-1.5 font-medium text-slate-700">{a.degre1D + a.degre2D}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

interface ScrapingPreview {
  format: "json" | "text";
  itemCount?: number;
  fields?: string[];
  sample?: unknown;
  length?: number;
  preview?: string;
  /** URL réellement interceptée (requête JSON interne de la page du
   * portail), utile pour reproduire l'appel exact ailleurs en cas de souci. */
  sourceUrl?: string;
}

/**
 * Portail ÉLECTEURS (distinct des portails de gestion CCMMEP/académiques,
 * onglet Imports) : protégé par un captcha à chaque connexion, donc pas de
 * login automatisé possible ici. La session (cookies/stockage) est obtenue
 * hors ligne via le script local fourni (connexion manuelle, captcha
 * résolu à la main), puis importée ci-dessous pour que la récupération du
 * fichier, elle, reste automatisable (voir services/electeursScraping.ts).
 */
function FichierElecteurPanel() {
  const [configured, setConfigured] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [fileUrl, setFileUrl] = useState("");
  const [sessionFileName, setSessionFileName] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<unknown>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ScrapingPreview | null>(null);

  function refresh() {
    api
      .get<{ configured: boolean; fileUrl: string | null; updatedAt: string | null }>("/scraping/electeurs/config")
      .then((r) => {
        setConfigured(r.configured);
        setUpdatedAt(r.updatedAt);
        if (r.fileUrl) setFileUrl(r.fileUrl);
      });
  }
  useEffect(refresh, []);

  async function handleSessionFile(file: File) {
    setSaveMsg(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      setSessionState(parsed);
      setSessionFileName(file.name);
    } catch (err) {
      setSaveMsg(`Fichier de session invalide (JSON attendu) : ${(err as Error).message}`);
    }
  }

  async function saveConfig() {
    setSaveMsg(null);
    if (!fileUrl && !sessionState) {
      setSaveMsg("Renseignez l'URL du fichier et/ou importez un fichier de session.");
      return;
    }
    try {
      // L'URL et la session s'enregistrent indépendamment : changer l'une ne
      // doit pas obliger à ré-uploader l'autre si elle est encore valide.
      await api.put("/scraping/electeurs/config", {
        fileUrl: fileUrl || undefined,
        sessionState: sessionState ?? undefined,
      });
      setSaveMsg("Configuration enregistrée.");
      setSessionFileName(null);
      setSessionState(null);
      refresh();
    } catch (err) {
      setSaveMsg((err as Error).message);
    }
  }

  async function runFetch() {
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const res = await api.post<ScrapingPreview>("/scraping/electeurs/run", {});
      setPreview(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        Le portail électeurs impose un captcha à chaque connexion : aucun login automatisé n'est possible ici. La
        session doit être obtenue une fois (ou à chaque expiration) via le script local fourni — vous vous
        connectez normalement dans un vrai navigateur, captcha compris, puis le script exporte la session dans un
        fichier à importer ci-dessous. La récupération du fichier des électeurs, elle, reste ensuite automatisable
        tant que la session est valide.
      </div>
      <Card
        title="Session du portail électeurs"
        subtitle={configured ? `Configurée${updatedAt ? ` (mise à jour le ${new Date(updatedAt).toLocaleString("fr-FR")})` : ""}.` : "Non configurée."}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-500">URL du fichier des électeurs</label>
            <input
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              placeholder="https://portail-electeurs-exemple.fr/electeurs.json"
              value={fileUrl}
              onChange={(e) => setFileUrl(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-500">
              1. Choisir le fichier <code>session-electeurs.json</code> exporté par le script local
            </label>
            <input
              type="file"
              accept="application/json"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleSessionFile(file);
              }}
            />
            {sessionFileName && (
              <p className="mt-1 text-xs font-medium text-emerald-700">
                ✓ Fichier chargé : {sessionFileName} — cliquez maintenant sur « Enregistrer la configuration »
                ci-dessous pour l'envoyer au serveur.
              </p>
            )}
          </div>
        </div>
        <button
          className={`mt-3 rounded-md px-3 py-1.5 text-sm font-medium text-white ${
            sessionState ? "animate-pulse bg-emerald-600 hover:bg-emerald-700" : "bg-slate-800 hover:bg-slate-900"
          }`}
          onClick={saveConfig}
        >
          2. Enregistrer la configuration
        </button>
        {saveMsg && <p className="mt-2 text-sm text-slate-600">{saveMsg}</p>}
      </Card>

      <Card title="Récupération du fichier">
        <button
          disabled={!configured || busy}
          onClick={runFetch}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {busy ? "Récupération en cours…" : "Récupérer le fichier"}
        </button>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        {preview?.sourceUrl && (
          <p className="mt-3 text-xs text-slate-500">
            URL réellement interceptée : <code className="break-all">{preview.sourceUrl}</code>
          </p>
        )}
        {preview && preview.format === "json" && (
          <div className="mt-4 space-y-2">
            {preview.itemCount !== undefined && (
              <p className="text-sm text-slate-700">
                Fichier JSON reconnu : <strong>{preview.itemCount}</strong> ligne(s).
              </p>
            )}
            {preview.fields && (
              <p className="text-sm text-slate-700">
                Champs détectés : <code className="text-xs">{preview.fields.join(", ") || "(aucun)"}</code>
              </p>
            )}
            <div>
              <p className="text-xs font-medium text-slate-500">Aperçu (3 premières lignes) :</p>
              <pre className="mt-1 max-h-96 overflow-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">
                {JSON.stringify(preview.sample, null, 2)}
              </pre>
            </div>
          </div>
        )}
        {preview && preview.format === "text" && (
          <div className="mt-4 space-y-2">
            <p className="text-sm text-amber-700">
              Le contenu récupéré n'est pas du JSON reconnu ({preview.length} caractères) — extrait ci-dessous. Si ça
              ressemble à une page de connexion, la session a probablement expiré : relancez le script local.
            </p>
            <pre className="mt-1 max-h-96 overflow-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">
              {preview.preview}
            </pre>
          </div>
        )}
      </Card>
    </div>
  );
}

interface DaySpelcRow extends RelanceDailyPoint {
  total: number;
}

interface DayGroup {
  date: string;
  mailEnvoyes: number;
  smsEnvoyes: number;
  total: number;
  spelcs: DaySpelcRow[];
}

interface RelanceCumulPoint {
  date: string;
  mailCumul: number;
  smsCumul: number;
}

function formatJour(date: string): string {
  return date.slice(8, 10) + "/" + date.slice(5, 7);
}

const TOUS_SPELC = "__tous__";

/**
 * Nombre de relances mail/SMS envoyées par jour et par Spelc (relances
 * réelles uniquement, hors envois de test — voir
 * services/relanceTracking.ts getRelanceDailyStatsAll). Le tableau est
 * hiérarchique (jour -> détail par Spelc, cliquer pour déplier) ; les deux
 * graphiques affichent soit le cumul national, soit un Spelc choisi dans le
 * sélecteur — un histogramme avec une série par Spelc (40+) ne serait pas
 * lisible.
 */
function StatistiquesRelancesPanel() {
  const [rows, setRows] = useState<RelanceDailyPoint[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [selectedSpelc, setSelectedSpelc] = useState(TOUS_SPELC);
  const [smsQuotas, setSmsQuotas] = useState<{ spelc: string; credits: number }[]>([]);

  useEffect(() => {
    api.get<{ rows: RelanceDailyPoint[] }>("/admin/relance-stats").then((r) => setRows(r.rows));
    api.get<{ rows: { spelc: string; credits: number }[] }>("/admin/sms-quotas").then((r) => setSmsQuotas(r.rows));
  }, []);

  function toggle(date: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }

  const spelcs = Array.from(new Set(rows.map((r) => r.spelc))).sort((a, b) => a.localeCompare(b));

  const dayGroups: DayGroup[] = (() => {
    const byDate = new Map<string, DaySpelcRow[]>();
    for (const r of rows) {
      const list = byDate.get(r.date) ?? [];
      list.push({ ...r, total: r.mailEnvoyes + r.smsEnvoyes });
      byDate.set(r.date, list);
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, spelcRows]) => {
        const sorted = [...spelcRows].sort((a, b) => a.spelc.localeCompare(b.spelc));
        const mailEnvoyes = sorted.reduce((s, r) => s + r.mailEnvoyes, 0);
        const smsEnvoyes = sorted.reduce((s, r) => s + r.smsEnvoyes, 0);
        return { date, mailEnvoyes, smsEnvoyes, total: mailEnvoyes + smsEnvoyes, spelcs: sorted };
      });
  })();

  const totalMail = dayGroups.reduce((s, d) => s + d.mailEnvoyes, 0);
  const totalSms = dayGroups.reduce((s, d) => s + d.smsEnvoyes, 0);

  // Série quotidienne pour les graphiques : agrégée nationalement, ou
  // filtrée sur le Spelc sélectionné.
  const chartData =
    selectedSpelc === TOUS_SPELC
      ? dayGroups.map((d) => ({ date: d.date, mailEnvoyes: d.mailEnvoyes, smsEnvoyes: d.smsEnvoyes }))
      : rows
          .filter((r) => r.spelc === selectedSpelc)
          .map((r) => ({ date: r.date, mailEnvoyes: r.mailEnvoyes, smsEnvoyes: r.smsEnvoyes }))
          .sort((a, b) => a.date.localeCompare(b.date));

  const cumulData: RelanceCumulPoint[] = chartData.reduce<RelanceCumulPoint[]>((acc, r) => {
    const prev = acc[acc.length - 1];
    acc.push({
      date: r.date,
      mailCumul: (prev?.mailCumul ?? 0) + r.mailEnvoyes,
      smsCumul: (prev?.smsCumul ?? 0) + r.smsEnvoyes,
    });
    return acc;
  }, []);

  const chartSubtitle = selectedSpelc === TOUS_SPELC ? "Tous les Spelc" : selectedSpelc;

  // Plafond de crédits SMS à afficher en ligne de référence sur l'histogramme
  // cumulatif : celui du Spelc sélectionné, ou la somme de tous les plafonds
  // configurés pour "Tous les Spelc" (quota national réparti). null si aucun
  // plafond n'est configuré pour la sélection courante — pas de ligne alors.
  const smsQuotaLine =
    selectedSpelc === TOUS_SPELC
      ? smsQuotas.length > 0
        ? smsQuotas.reduce((s, q) => s + q.credits, 0)
        : null
      : (smsQuotas.find((q) => q.spelc === selectedSpelc)?.credits ?? null);

  return (
    <div className="space-y-4">
      <Card
        title="Relances par jour et par Spelc"
        subtitle="Relances réelles uniquement (hors envois de test). Cliquez sur un jour pour voir le détail par Spelc."
      >
        {dayGroups.length === 0 ? (
          <p className="text-sm text-slate-400">Aucune relance envoyée pour le moment.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                  <th className="py-2 pr-4">Jour / Spelc</th>
                  <th className="px-4 py-2">Mails envoyés</th>
                  <th className="px-4 py-2">SMS envoyés</th>
                  <th className="px-4 py-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {dayGroups.map((d) => (
                  <Fragment key={d.date}>
                    <tr
                      className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                      onClick={() => toggle(d.date)}
                    >
                      <td className="py-1.5 pr-4 font-medium text-slate-800">
                        <span className="mr-1 inline-block w-3 text-slate-400">{open.has(d.date) ? "▾" : "▸"}</span>
                        {formatJour(d.date)}
                      </td>
                      <td className="px-4 py-1.5">{d.mailEnvoyes.toLocaleString("fr-FR")}</td>
                      <td className="px-4 py-1.5">{d.smsEnvoyes.toLocaleString("fr-FR")}</td>
                      <td className="px-4 py-1.5 font-medium text-slate-700">{d.total.toLocaleString("fr-FR")}</td>
                    </tr>
                    {open.has(d.date) &&
                      d.spelcs.map((s) => (
                        <tr key={d.date + s.spelc} className="border-b border-slate-50 bg-slate-50/60">
                          <td className="py-1 pl-8 pr-4 text-slate-600">{s.spelc}</td>
                          <td className="px-4 py-1 text-slate-500">{s.mailEnvoyes.toLocaleString("fr-FR")}</td>
                          <td className="px-4 py-1 text-slate-500">{s.smsEnvoyes.toLocaleString("fr-FR")}</td>
                          <td className="px-4 py-1 text-slate-500">{s.total.toLocaleString("fr-FR")}</td>
                        </tr>
                      ))}
                  </Fragment>
                ))}
                <tr className="border-t border-slate-200 bg-slate-50 font-medium text-slate-700">
                  <td className="py-1.5 pr-4">Total</td>
                  <td className="px-4 py-1.5">{totalMail.toLocaleString("fr-FR")}</td>
                  <td className="px-4 py-1.5">{totalSms.toLocaleString("fr-FR")}</td>
                  <td className="px-4 py-1.5">{(totalMail + totalSms).toLocaleString("fr-FR")}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div>
        <label className="text-xs font-medium text-slate-500">Graphiques pour :</label>
        <select
          className="ml-2 rounded-md border border-slate-300 px-2 py-1 text-sm"
          value={selectedSpelc}
          onChange={(e) => setSelectedSpelc(e.target.value)}
        >
          <option value={TOUS_SPELC}>Tous les Spelc</option>
          {spelcs.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <Card title="Histogramme des relances par jour" subtitle={chartSubtitle}>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tickFormatter={formatJour} tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip labelFormatter={(label) => `Jour du ${formatJour(String(label))}`} />
              <Legend />
              <Bar dataKey="mailEnvoyes" name="Mails" fill={CATEGORICAL[0]} />
              <Bar dataKey="smsEnvoyes" name="SMS" fill={CATEGORICAL[2]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        {chartData.length === 0 && <p className="text-sm text-slate-400">Aucune relance envoyée pour le moment.</p>}
      </Card>

      <Card title="Histogramme cumulatif des relances" subtitle={chartSubtitle}>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={cumulData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tickFormatter={formatJour} tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip labelFormatter={(label) => `Jour du ${formatJour(String(label))}`} />
              <Legend />
              <Bar dataKey="mailCumul" name="Mails (cumul)" fill={CATEGORICAL[0]} />
              <Bar dataKey="smsCumul" name="SMS (cumul)" fill={CATEGORICAL[2]} />
              {smsQuotaLine !== null && (
                <ReferenceLine
                  y={smsQuotaLine}
                  stroke={CATEGORICAL[3]}
                  strokeDasharray="6 3"
                  strokeWidth={2}
                  label={{
                    value: `Quota SMS : ${smsQuotaLine.toLocaleString("fr-FR")}`,
                    position: "insideTopRight",
                    fontSize: 11,
                    fill: CATEGORICAL[3],
                  }}
                />
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
        {cumulData.length === 0 && <p className="text-sm text-slate-400">Aucune relance envoyée pour le moment.</p>}
      </Card>
    </div>
  );
}

function UsersPanel() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [academies, setAcademies] = useState<string[]>([]);
  const [spelcs, setSpelcs] = useState<string[]>([]);
  const [form, setForm] = useState({
    email: "",
    password: "",
    role: "admin_academique",
    academie: "",
    spelc: "",
    nom: "",
    prenom: "",
  });
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    api.get<{ users: ManagedUser[] }>("/admin/users").then((r) => setUsers(r.users));
  }
  useEffect(() => {
    refresh();
    api.get<{ academies: string[] }>("/admin/reference/academies").then((r) => setAcademies(r.academies));
    api.get<{ spelcs: { spelc: string }[] }>("/admin/reference/spelcs").then((r) => setSpelcs(r.spelcs.map((s) => s.spelc)));
  }, []);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/admin/users", {
        email: form.email,
        password: form.password,
        role: form.role,
        academie: form.role === "admin_academique" ? form.academie : undefined,
        spelc: form.role === "admin_spelc" ? form.spelc : undefined,
        nom: form.nom || undefined,
        prenom: form.prenom || undefined,
      });
      setForm({ email: "", password: "", role: "admin_academique", academie: "", spelc: "", nom: "", prenom: "" });
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <Card title="Créer un compte administrateur">
        <form onSubmit={createUser} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <input
            placeholder="Nom"
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={form.nom}
            onChange={(e) => setForm({ ...form, nom: e.target.value })}
          />
          <input
            placeholder="Prénom"
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={form.prenom}
            onChange={(e) => setForm({ ...form, prenom: e.target.value })}
          />
          <input
            required
            type="email"
            placeholder="Email"
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <input
            required
            type="password"
            placeholder="Mot de passe"
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <select
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            <option value="admin_academique">Admin académique</option>
            <option value="admin_spelc">Admin Spelc</option>
            <option value="admin_general">Admin général</option>
          </select>
          {form.role === "admin_academique" && (
            <select
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              value={form.academie}
              onChange={(e) => setForm({ ...form, academie: e.target.value })}
            >
              <option value="">Académie…</option>
              {academies.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          )}
          {form.role === "admin_spelc" && (
            <select
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              value={form.spelc}
              onChange={(e) => setForm({ ...form, spelc: e.target.value })}
            >
              <option value="">Spelc…</option>
              {spelcs.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
          <button className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">
            Créer
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </Card>

      <Card title="Comptes existants">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
              <th className="py-2 pr-4">Nom</th>
              <th className="px-4 py-2">Prénom</th>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Rôle</th>
              <th className="px-4 py-2">Périmètre</th>
              <th className="px-4 py-2">Mot de passe</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-slate-100">
                <td className="py-1.5 pr-4">{u.nom ?? "—"}</td>
                <td className="px-4 py-1.5">{u.prenom ?? "—"}</td>
                <td className="px-4 py-1.5">{u.email}</td>
                <td className="px-4 py-1.5">{u.role}</td>
                <td className="px-4 py-1.5 text-slate-500">{u.academie ?? u.spelc ?? "—"}</td>
                <td className="px-4 py-1.5">
                  {u.must_change_password ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                      À changer
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </td>
                <td className="px-4 py-1.5 text-right">
                  {u.role !== "admin_general" && (
                    <button
                      className="text-xs text-red-600 hover:underline"
                      onClick={async () => {
                        await api.delete(`/admin/users/${u.id}`);
                        refresh();
                      }}
                    >
                      Supprimer
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <FileUploadCard
        title="Importer des admins Spelc / académiques (CSV ou Excel)"
        subtitle={
          "Mot de passe attribué à chaque compte créé : \"ElectionsCCM2026\" (à changer à la première connexion). " +
          "Les Spelc/académies doivent déjà exister dans les référentiels (onglet Référentiels)."
        }
        expectedColumns={["type_admin (spelc|academique)", "nom", "prenom", "email", "spelc", "academie"]}
        accept=".csv,.xlsx"
        onUpload={async (file) => {
          const fd = new FormData();
          fd.append("file", file);
          const res = await api.upload<{ created: number; errors: { row: number; message: string }[] }>(
            "/admin/users/import",
            fd
          );
          refresh();
          const summary = `${res.created} compte(s) créé(s).`;
          if (res.errors.length > 0) {
            const errorLines = res.errors.map((e) => `Ligne ${e.row} : ${e.message}`);
            throw new Error(`${summary}\n${errorLines.join("\n")}`);
          }
          return summary;
        }}
      />
    </div>
  );
}

function AdherentsAdminPanel() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <FileUploadCard
        title="Importer tous les adhérents (tous les Spelcs)"
        subtitle="Remplace entièrement la liste de chaque Spelc mentionné dans le fichier (les Spelcs absents du fichier ne sont pas touchés)."
        expectedColumns={["spelc", "nom", "prenom", "mail", "mobile"]}
        accept=".csv,.xlsx"
        onUpload={async (file) => {
          const fd = new FormData();
          fd.append("file", file);
          const res = await api.upload<{ spelcsProcessed: number; totalAdherents: number; errors: { row: number; message: string }[] }>(
            "/adherents/import-all",
            fd
          );
          const summary = `${res.spelcsProcessed} Spelc(s) mis à jour, ${res.totalAdherents} adhérent(s) importé(s).`;
          if (res.errors.length > 0) {
            const errorLines = res.errors.map((e) => `Ligne ${e.row} : ${e.message}`);
            throw new Error(`${summary}\n${errorLines.join("\n")}`);
          }
          return summary;
        }}
      />
      <Card title="Supprimer tous les adhérents">
        <p className="mb-3 text-sm text-slate-500">
          Supprime la liste d'adhérents de tous les Spelcs, sans exception. Action irréversible.
        </p>
        <button
          disabled={busy}
          onClick={async () => {
            if (!confirm("Supprimer tous les adhérents de tous les Spelcs ? Cette action est irréversible.")) return;
            setBusy(true);
            setMessage(null);
            try {
              const res = await api.delete<{ deleted: number }>("/adherents/all");
              setMessage(`${res.deleted} adhérent(s) supprimé(s).`);
            } catch (err) {
              setMessage((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
        >
          {busy ? "Suppression en cours…" : "Supprimer tous les adhérents"}
        </button>
        {message && <p className="mt-2 text-sm text-slate-600">{message}</p>}
      </Card>
    </div>
  );
}

function ReferentielsPanel() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <FileUploadCard
        title="Départements / Spelc / Académies"
        subtitle="Fichier Excel de correspondance. 1re ligne = en-têtes (peu importe leur libellé, seul l'ordre des colonnes compte). Département sur 2 chiffres (971/972/973/974/976/978 pour les DOM)."
        expectedColumns={["Département", "Spelc de rattachement", "Académie"]}
        accept=".xlsx"
        onUpload={async (file) => {
          const fd = new FormData();
          fd.append("file", file);
          const res = await api.upload<{ departements: number; spelcs: number }>("/admin/reference/departements", fd);
          return `${res.departements} départements, ${res.spelcs} Spelcs chargés.`;
        }}
      />
      <FileUploadCard
        title="Scrutins académiques"
        subtitle="Types CCMI/CCMA/CCMD/CCML par académie. 1re ligne = en-têtes, une seule feuille prise en compte."
        expectedColumns={["Académie", "Type scrutin 1er degré", "Type scrutin 2nd degré"]}
        accept=".xlsx"
        onUpload={async (file) => {
          const fd = new FormData();
          fd.append("file", file);
          const res = await api.upload<{ count: number }>("/admin/reference/academie-scrutins", fd);
          return `${res.count} académies chargées.`;
        }}
      />
      <FileUploadCard
        title="Crédits SMS par Spelc"
        subtitle="Plafond de crédits SMS réparti par Spelc (colonne B = nom du Spelc, colonne D = crédits alloués). Une fois le plafond atteint (crédits cumulés utilisés par le Spelc), ses campagnes SMS sont bloquées."
        expectedColumns={["(A) Départements", "(B) Syndicats adhérents", "(C) Nombre de cotisation", "(D) Crédits SMS"]}
        accept=".xlsx"
        onUpload={async (file) => {
          const fd = new FormData();
          fd.append("file", file);
          const res = await api.upload<{ count: number }>("/admin/reference/sms-quota", fd);
          return `${res.count} Spelc(s) chargé(s).`;
        }}
      />
    </div>
  );
}
