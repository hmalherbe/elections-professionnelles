import { useEffect, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CamembertCard } from "../components/CamembertCard";
import { Card } from "../components/Card";
import { CourbeCard } from "../components/CourbeCard";
import { EtablissementsTab } from "../components/EtablissementsTab";
import { FileUploadCard } from "../components/FileUploadCard";
import { LogoUploadCard } from "../components/LogoUploadCard";
import { SocialLinksEditor } from "../components/SocialLinksEditor";
import { api, qs } from "../lib/api";
import { CATEGORICAL } from "../lib/colors";
import { SCRUTINS, type ScrutinDef } from "../lib/scrutins";
import type { SocialLinks } from "../lib/socialLinks";
import type {
  Adherent,
  BrevoPlanEntry,
  CourbePoint,
  ImportRecord,
  MailSeriesPoint,
  ManagedUser,
  RelanceTrackingRow,
} from "../lib/types";

const TABS = ["Vue d'ensemble", "Participation par établissement", "Imports", "Adhérents", "Relances adhérents", "Comptes administrateurs"] as const;
type Tab = (typeof TABS)[number];

export function Dashboard() {
  const [tab, setTab] = useState<Tab>("Vue d'ensemble");

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium ${
              tab === t ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-100"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Vue d'ensemble" && <VueEnsemble />}
      {tab === "Participation par établissement" && <ParticipationPanel />}
      {tab === "Imports" && <ImportsPanel />}
      {tab === "Adhérents" && <AdherentsPanel />}
      {tab === "Relances adhérents" && <RelancesPanel />}
      {tab === "Comptes administrateurs" && <ComptesPanel />}
    </div>
  );
}

function ScrutinToggle({ value, onChange }: { value: ScrutinDef; onChange: (s: ScrutinDef) => void }) {
  return (
    <div className="mb-4 flex gap-2">
      {SCRUTINS.map((s) => (
        <button
          key={s.code}
          onClick={() => onChange(s)}
          className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
            value.code === s.code ? "border-emerald-600 bg-emerald-50 text-emerald-700" : "border-slate-300 text-slate-600 hover:bg-slate-100"
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

function VueEnsemble() {
  const [scrutin, setScrutin] = useState<ScrutinDef>(SCRUTINS[0]);
  const [camembert, setCamembert] = useState({ votants: 0, nonVotants: 0 });
  const [courbe, setCourbe] = useState<CourbePoint[]>([]);

  useEffect(() => {
    api.get<{ votants: number; nonVotants: number }>(`/stats/camembert${qs({ scrutin: scrutin.code })}`).then(setCamembert);
    api.get<{ points: CourbePoint[] }>(`/stats/courbe${qs({ scrutin: scrutin.code })}`).then((r) => setCourbe(r.points));
  }, [scrutin]);

  return (
    <div>
      <ScrutinToggle value={scrutin} onChange={setScrutin} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <CamembertCard title={`Participation — ${scrutin.label}`} votants={camembert.votants} nonVotants={camembert.nonVotants} />
        <CourbeCard title="Courbe de participation cumulée" points={courbe} />
      </div>
    </div>
  );
}

function ParticipationPanel() {
  const [scrutin, setScrutin] = useState<ScrutinDef>(SCRUTINS[0]);
  return (
    <div>
      <ScrutinToggle value={scrutin} onChange={setScrutin} />
      <EtablissementsTab scrutin={scrutin.code} />
    </div>
  );
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function ImportsPanel() {
  const [imports, setImports] = useState<ImportRecord[]>([]);
  const [snapshotDates, setSnapshotDates] = useState<Record<string, string>>({
    scrutin1: todayIso(),
    scrutin2: todayIso(),
  });

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
      {SCRUTINS.map((s) => (
        <FileUploadCard
          key={s.code}
          title={`Import quotidien — ${s.label}`}
          subtitle="Fichier JSON des émargements (champs : nom, prenom, dateEmargement, corps, affectation, referenceBulletin)."
          accept="application/json"
          extraFields={
            <div>
              <label className="mr-2 text-xs font-medium text-slate-500">Journée du scrutin représentée :</label>
              <input
                type="date"
                className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                value={snapshotDates[s.code]}
                onChange={(e) => setSnapshotDates((d) => ({ ...d, [s.code]: e.target.value }))}
              />
            </div>
          }
          onUpload={async (file) => {
            const fd = new FormData();
            fd.append("file", file);
            fd.append("snapshotDate", snapshotDates[s.code]);
            const res = await api.upload<{ rowCount: number; votants: number }>(`/imports/${s.code}`, fd);
            refresh();
            return `${res.rowCount} lignes importées, ${res.votants} votants.`;
          }}
        />
      ))}
      <Card title="Historique des imports">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
              <th className="py-2 pr-4">Date</th>
              <th className="px-4 py-2">Scrutin</th>
              <th className="px-4 py-2">Fichier</th>
              <th className="px-4 py-2">Lignes</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {imports.map((imp) => (
              <tr key={imp.id} className="border-b border-slate-100">
                <td className="py-1.5 pr-4">{imp.snapshot_date}</td>
                <td className="px-4 py-1.5">{SCRUTINS.find((s) => s.code === imp.scrutin)?.label ?? imp.scrutin}</td>
                <td className="px-4 py-1.5 text-slate-500">{imp.filename}</td>
                <td className="px-4 py-1.5 text-slate-500">{imp.row_count}</td>
                <td className="px-4 py-1.5 text-right">
                  <button className="text-xs text-red-600 hover:underline" onClick={() => handleDelete(imp.id)}>
                    Supprimer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {imports.length === 0 && <p className="py-4 text-sm text-slate-400">Aucun import pour le moment.</p>}
      </Card>
    </div>
  );
}

function AdherentsPanel() {
  const [adherents, setAdherents] = useState<Adherent[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  function refresh() {
    api.get<{ adherents: Adherent[] }>("/adherents").then((r) => setAdherents(r.adherents));
  }
  useEffect(refresh, []);

  async function handleDeleteAll() {
    if (!confirm("Supprimer tous les adhérents ? Cette action est irréversible.")) return;
    const res = await api.delete<{ deleted: number }>("/adherents/all");
    setMessage(`${res.deleted} adhérent(s) supprimé(s).`);
    refresh();
  }

  return (
    <div className="space-y-4">
      <FileUploadCard
        title="Import du fichier global des adhérents"
        subtitle="Remplace intégralement la liste précédente — à déposer une seule fois avant le début des élections."
        expectedColumns={["nom", "prenom", "mail", "etablissement"]}
        accept=".csv,.xlsx"
        onUpload={async (file) => {
          const fd = new FormData();
          fd.append("file", file);
          const res = await api.upload<{ count: number }>("/adherents/import", fd);
          refresh();
          return `${res.count} adhérent(s) importé(s).`;
        }}
      />
      <Card title={`Adhérents (${adherents.length})`}>
        <div className="mb-2 flex items-center gap-2">
          <button className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50" onClick={handleDeleteAll}>
            Supprimer tous les adhérents
          </button>
          {message && <span className="text-sm text-slate-600">{message}</span>}
        </div>
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="py-2 pr-4">Nom</th>
                <th className="px-4 py-2">Prénom</th>
                <th className="px-4 py-2">Mail</th>
                <th className="px-4 py-2">Établissement</th>
              </tr>
            </thead>
            <tbody>
              {adherents.map((a) => (
                <tr key={a.id} className="border-b border-slate-100">
                  <td className="py-1.5 pr-4">{a.nom}</td>
                  <td className="px-4 py-1.5">{a.prenom}</td>
                  <td className="px-4 py-1.5 text-slate-500">{a.mail ?? "—"}</td>
                  <td className="px-4 py-1.5 text-slate-500">{a.etablissement ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {adherents.length === 0 && <p className="py-4 text-sm text-slate-400">Aucun adhérent importé pour le moment.</p>}
        </div>
      </Card>
    </div>
  );
}

function RelancesPanel() {
  const [brevoConfigured, setBrevoConfigured] = useState(false);
  const [maskedKey, setMaskedKey] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [brevoMsg, setBrevoMsg] = useState<string | null>(null);
  const [orgSettings, setOrgSettings] = useState<{ logoPath: string | null; socialLinks: SocialLinks; testEmail: string | null }>({
    logoPath: null,
    socialLinks: {},
    testEmail: null,
  });
  const [testEmailInput, setTestEmailInput] = useState("");
  const [testSaved, setTestSaved] = useState<string | null>(null);

  const [template, setTemplate] = useState({ subject: "", body: "" });
  const [templateMsg, setTemplateMsg] = useState<string | null>(null);
  const [campagneTag, setCampagneTag] = useState("relance-1");
  const [testMode, setTestMode] = useState(false);
  const [testLimit, setTestLimit] = useState(3);
  const [plan, setPlan] = useState<BrevoPlanEntry[] | null>(null);
  const [preview, setPreview] = useState<{ recipients: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testBusy, setTestBusy] = useState(false);

  const [mailRows, setMailRows] = useState<MailSeriesPoint[]>([]);
  const [trackingRows, setTrackingRows] = useState<RelanceTrackingRow[]>([]);
  const [trackingLoadedAt, setTrackingLoadedAt] = useState<Date | null>(null);
  const [trackingChecking, setTrackingChecking] = useState(false);

  function refreshBrevoSettings() {
    api.get<{ configured: boolean; maskedKey: string | null }>("/admin/brevo-settings").then((r) => {
      setBrevoConfigured(r.configured);
      setMaskedKey(r.maskedKey);
    });
  }
  function refreshOrgSettings() {
    api
      .get<{ logoPath: string | null; socialLinks: SocialLinks; testEmail: string | null }>("/admin/org-settings")
      .then((r) => {
        setOrgSettings(r);
        setTestEmailInput(r.testEmail ?? "");
      });
  }
  function refreshTemplate() {
    api.get<{ subject: string; body: string }>("/brevo/templates/email").then(setTemplate);
  }
  function refreshCredits() {
    api
      .get<{ plan: BrevoPlanEntry[] }>("/brevo/account")
      .then((res) => setPlan(res.plan))
      .catch(() => setPlan(null));
  }
  function reloadTracking() {
    api.get<{ rows: RelanceTrackingRow[] }>("/brevo/relance-tracking").then((r) => {
      setTrackingRows(r.rows);
      setTrackingLoadedAt(new Date());
    });
    api.get<{ rows: MailSeriesPoint[] }>("/brevo/tracking/mail").then((r) => setMailRows(r.rows));
  }

  useEffect(() => {
    refreshBrevoSettings();
    refreshOrgSettings();
    refreshTemplate();
    refreshCredits();
    reloadTracking();
    const id = setInterval(reloadTracking, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    api
      .get<{ recipients: number }>(`/brevo/campaigns/preview${qs({ testMode: testMode ? "true" : undefined, testLimit: String(testLimit) })}`)
      .then(setPreview)
      .catch(() => setPreview(null));
  }, [testMode, testLimit]);

  const mailCredits = plan?.find((p) => p.type === "sendLimit" || p.creditsType === "sendLimit")?.credits ?? null;

  async function sendTest() {
    setTestBusy(true);
    setTestMsg(null);
    try {
      const res = await api.post<{ sent: number; errors: number; errorMessage: string | null }>("/brevo/templates/email/test", template);
      setTestMsg(res.sent > 0 ? "Mail de test envoyé." : `Échec de l'envoi : ${res.errorMessage ?? "raison inconnue."}`);
    } catch (err) {
      setTestMsg((err as Error).message);
    } finally {
      setTestBusy(false);
      reloadTracking();
      refreshCredits();
    }
  }

  return (
    <div className="space-y-4">
      <Card title="Paramètres Brevo" subtitle={brevoConfigured ? `Clé configurée (${maskedKey}).` : "Clé API Brevo non configurée."}>
        <div className="flex flex-wrap items-end gap-2">
          <input
            type="password"
            placeholder="Nouvelle clé API Brevo"
            className="w-64 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
          />
          <button
            className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900"
            onClick={async () => {
              setBrevoMsg(null);
              try {
                await api.put("/admin/brevo-settings", { apiKey: apiKeyInput });
                setApiKeyInput("");
                setBrevoMsg("Clé enregistrée.");
                refreshBrevoSettings();
              } catch (err) {
                setBrevoMsg((err as Error).message);
              }
            }}
          >
            Enregistrer la clé
          </button>
          {brevoMsg && <span className="text-sm text-slate-600">{brevoMsg}</span>}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <LogoUploadCard
          title="Logo (entête des mails)"
          currentLogo={orgSettings.logoPath}
          onSave={async (dataUri) => {
            await api.put("/admin/org-settings", { logoDataUri: dataUri });
            refreshOrgSettings();
          }}
        />
        <SocialLinksEditor
          value={orgSettings.socialLinks}
          onSave={async (links) => {
            await api.put("/admin/org-settings", { socialLinks: links });
            refreshOrgSettings();
          }}
        />
      </div>

      <Card title="Mail de test" subtitle="Utilisé pour les envois de test (modèle et campagnes), à la place des vrais adhérents.">
        <div className="flex flex-wrap items-end gap-2">
          <input
            type="email"
            placeholder="moi@exemple.fr"
            className="w-64 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={testEmailInput}
            onChange={(e) => setTestEmailInput(e.target.value)}
          />
          <button
            className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900"
            onClick={async () => {
              await api.put("/admin/org-settings", { testEmail: testEmailInput });
              setTestSaved("Enregistré.");
              setTimeout(() => setTestSaved(null), 2000);
            }}
          >
            Enregistrer
          </button>
          {testSaved && <span className="text-sm text-emerald-600">{testSaved}</span>}
        </div>
      </Card>

      <Card
        title="Modèle de mail de relance"
        subtitle={
          "Champs : {{nom}} {{prenom}} · {{scrutin1_non_votant}} {{scrutin2_non_votant}} · {{logo}} {{reseaux_sociaux}} · " +
          "{{#if expr}}…{{else}}…{{/if}} avec expr combinant and/or/not(...), ex. \"scrutin1_non_votant and not(scrutin2_non_votant)\""
        }
      >
        <div className="mb-2 flex gap-2">
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            onClick={refreshTemplate}
          >
            Charger le modèle
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            onClick={async () => {
              setTemplateMsg(null);
              try {
                await api.put("/brevo/templates/email", template);
                setTemplateMsg("Modèle enregistré.");
              } catch (err) {
                setTemplateMsg((err as Error).message);
              }
            }}
          >
            Enregistrer comme modèle
          </button>
          {templateMsg && <span className="self-center text-sm text-slate-600">{templateMsg}</span>}
        </div>
        <input
          className="mb-2 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          placeholder="Objet du mail"
          value={template.subject}
          onChange={(e) => setTemplate({ ...template, subject: e.target.value })}
        />
        <textarea
          className="h-40 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          placeholder="Bonjour {{prenom}}, ..."
          value={template.body}
          onChange={(e) => setTemplate({ ...template, body: e.target.value })}
        />
      </Card>

      <Card title="Envoyer une campagne de relance" subtitle="Ciblage : adhérents non-votants à au moins un des 2 scrutins.">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500">Tag de campagne</label>
            <input
              className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              value={campagneTag}
              onChange={(e) => setCampagneTag(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 pb-1.5 text-sm text-slate-600">
            <input type="checkbox" checked={testMode} onChange={(e) => setTestMode(e.target.checked)} />
            Mode test
          </label>
        </div>

        {preview && mailCredits !== null && preview.recipients > mailCredits && (
          <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2">
            <p className="text-sm text-red-700">
              Crédit insuffisant — {preview.recipients} destinataire(s) ciblé(s), mais seulement{" "}
              {mailCredits.toLocaleString("fr-FR")} crédit(s) mail restant(s). Rachetez des crédits avant l'envoi.
            </p>
          </div>
        )}

        {testMode && (
          <div className="mt-3 grid grid-cols-1 gap-3 rounded-md border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs text-amber-800">
              En mode test, les mails sont envoyés au mail de test configuré ci-dessus (pas aux vrais adhérents), avec le
              contenu personnalisé des N premiers adhérents ciblés.
            </p>
            <div className="max-w-[10rem]">
              <label className="block text-xs font-medium text-slate-500">Nombre de mails à envoyer</label>
              <input
                type="number"
                min={1}
                max={20}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                value={testLimit}
                onChange={(e) => setTestLimit(Number(e.target.value))}
              />
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
            onClick={async () => {
              try {
                await api.put("/brevo/templates/email", template);
                const res = await api.post<{ sent: number; errors: number; total: number }>("/brevo/campaigns/email", {
                  tag: campagneTag,
                  testMode,
                  testLimit,
                });
                setMessage(`Mails : ${res.sent}/${res.total} envoyés, ${res.errors} erreurs.`);
                reloadTracking();
                refreshCredits();
              } catch (err) {
                setMessage((err as Error).message);
              }
            }}
          >
            Envoyer les mails
          </button>
          <button
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-60"
            disabled={testBusy}
            onClick={sendTest}
          >
            {testBusy ? "Envoi…" : "Mail de test"}
          </button>
        </div>
        {message && <p className="mt-2 text-sm text-slate-600">{message}</p>}
        {testMsg && <p className="mt-1 text-sm text-slate-600">{testMsg}</p>}
      </Card>

      <Card title="Courbe de suivi des mails">
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={mailRows}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="total_envoye" name="Envoyés" stroke={CATEGORICAL[0]} strokeWidth={2} />
              <Line type="monotone" dataKey="mails_lus" name="Lus" stroke={CATEGORICAL[4]} strokeWidth={2} />
              <Line type="monotone" dataKey="liens_clique" name="Cliqués" stroke={CATEGORICAL[2]} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card
        title="Suivi détaillé des relances, par personne"
        subtitle={`${trackingRows.length} envois récents${trackingLoadedAt ? ` · dernière mise à jour ${trackingLoadedAt.toLocaleTimeString("fr-FR")}` : ""}`}
      >
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            onClick={reloadTracking}
          >
            Actualiser
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-60"
            disabled={trackingChecking}
            onClick={async () => {
              setTrackingChecking(true);
              try {
                await api.post("/brevo/relance-tracking/refresh", {});
                reloadTracking();
              } finally {
                setTrackingChecking(false);
              }
            }}
          >
            {trackingChecking ? "Vérification…" : "Vérifier les statuts Brevo"}
          </button>
          <button
            type="button"
            className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
            onClick={async () => {
              if (!window.confirm("Effacer tout le suivi détaillé des relances ? Cette action est irréversible.")) return;
              await api.delete("/brevo/relance-tracking");
              reloadTracking();
            }}
          >
            Effacer le suivi
          </button>
        </div>
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="py-2 pr-4">Horodatage</th>
                <th className="px-4 py-2">Campagne</th>
                <th className="px-4 py-2">Nom</th>
                <th className="px-4 py-2">Prénom</th>
                <th className="px-4 py-2">Contact</th>
                <th className="px-4 py-2">Statut</th>
                <th className="px-4 py-2">Clic</th>
              </tr>
            </thead>
            <tbody>
              {trackingRows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="py-1.5 pr-4 text-slate-500">{new Date(r.created_at.replace(" ", "T") + "Z").toLocaleString("fr-FR")}</td>
                  <td className="px-4 py-1.5 text-slate-500">
                    {r.campagne_tag}
                    {Boolean(r.test_mode) && <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">test</span>}
                  </td>
                  <td className="px-4 py-1.5">{r.nom}</td>
                  <td className="px-4 py-1.5">{r.prenom}</td>
                  <td className="px-4 py-1.5 text-slate-500">{r.contact}</td>
                  <td className="px-4 py-1.5">
                    {r.statusLabel === "ok" ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">OK</span>
                    ) : (
                      <span className="cursor-help rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700" title={r.error_message ?? "Échec de l'envoi."}>
                        Échec
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-1.5">
                    {r.clicked ? (
                      <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700">Oui</span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Non</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {trackingRows.length === 0 && <p className="py-4 text-sm text-slate-400">Aucune relance envoyée pour le moment.</p>}
        </div>
      </Card>
    </div>
  );
}

function ComptesPanel() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [form, setForm] = useState({ email: "", password: "", nom: "", prenom: "" });
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    api.get<{ users: ManagedUser[] }>("/admin/users").then((r) => setUsers(r.users));
  }
  useEffect(refresh, []);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/admin/users", form);
      setForm({ email: "", password: "", nom: "", prenom: "" });
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <Card title="Créer un compte administrateur">
        <form onSubmit={createUser} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
          <button className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">Créer</button>
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
                <td className="px-4 py-1.5">
                  {u.must_change_password ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">À changer</span>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </td>
                <td className="px-4 py-1.5 text-right">
                  <button
                    className="text-xs text-red-600 hover:underline"
                    onClick={async () => {
                      await api.delete(`/admin/users/${u.id}`);
                      refresh();
                    }}
                  >
                    Supprimer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
