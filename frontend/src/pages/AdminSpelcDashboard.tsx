import { useEffect, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CamembertCard } from "../components/CamembertCard";
import { CATEGORICAL } from "../lib/colors";
import { Card } from "../components/Card";
import { Ccm2022ResultsTab } from "../components/Ccm2022ResultsTab";
import { ChatAssistantPanel } from "../components/ChatAssistantPanel";
import { CourbeCard } from "../components/CourbeCard";
import { EtablissementsTab } from "../components/EtablissementsTab";
import { FileUploadCard } from "../components/FileUploadCard";
import { LogoUploadCard } from "../components/LogoUploadCard";
import { ScopeToggle } from "../components/ScopeToggle";
import { ScrutinsTab } from "../components/ScrutinsTab";
import { SocialLinksEditor } from "../components/SocialLinksEditor";
import { api, qs } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { CourbePoint } from "../lib/types";
import type { SocialLinks } from "../lib/socialLinks";

const TABS = ["Vue Spelc", "Résultats 2022", "Scrutins", "Participation par établissement", "Adhérents", "Brevo", "Assistant"] as const;
type Tab = (typeof TABS)[number];

export function AdminSpelcDashboard() {
  const { user } = useAuth();
  const spelc = user!.spelc!;
  const [tab, setTab] = useState<Tab>("Vue Spelc");
  const [scope, setScope] = useState<"national" | "academique">("academique");

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
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
        {(tab === "Vue Spelc" || tab === "Scrutins" || tab === "Participation par établissement") && (
          <ScopeToggle scope={scope} onChange={setScope} />
        )}
      </div>

      {tab === "Vue Spelc" && <VueSpelc spelc={spelc} scope={scope} />}
      {tab === "Résultats 2022" && <Ccm2022ResultsTab mode="spelc" value={spelc} />}
      {tab === "Scrutins" && <ScrutinsTab scope={scope} spelc={spelc} allowAdherentFilter={scope === "academique"} />}
      {tab === "Participation par établissement" && <EtablissementsTab scope={scope} spelc={spelc} />}
      {tab === "Adhérents" && <AdherentsPanel spelc={spelc} />}
      {tab === "Brevo" && <BrevoPanel spelc={spelc} />}
      {tab === "Assistant" && <ChatAssistantPanel />}
    </div>
  );
}

function VueSpelc({ spelc, scope }: { spelc: string; scope: "national" | "academique" }) {
  const [camembert, setCamembert] = useState({ votants: 0, nonVotants: 0 });
  const [courbe, setCourbe] = useState<CourbePoint[]>([]);

  useEffect(() => {
    api.get<{ votants: number; nonVotants: number }>(`/stats/camembert${qs({ scope, spelc })}`).then(setCamembert);
    api.get<{ points: CourbePoint[] }>(`/stats/courbe${qs({ scope, spelc })}`).then((r) => setCourbe(r.points));
  }, [scope, spelc]);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <CamembertCard title={`Participation — Spelc ${spelc}`} votants={camembert.votants} nonVotants={camembert.nonVotants} />
      <CourbeCard title="Courbe de participation cumulée" points={courbe} />
    </div>
  );
}

interface Adherent {
  id: number;
  nom: string;
  prenom: string;
  mail: string | null;
  mobile: string | null;
}

function AdherentsPanel({ spelc }: { spelc: string }) {
  const [adherents, setAdherents] = useState<Adherent[]>([]);

  function refresh() {
    api.get<{ adherents: Adherent[] }>(`/adherents${qs({ spelc })}`).then((r) => setAdherents(r.adherents));
  }
  useEffect(refresh, [spelc]);

  return (
    <div className="space-y-4">
      <FileUploadCard
        title="Import des adhérents"
        subtitle="Fichier CSV ou Excel, 1re ligne = en-têtes. Remplace entièrement la liste précédente pour ce Spelc."
        expectedColumns={["Nom", "Prénom", "Mail", "Numéro de mobile"]}
        accept=".csv,.xlsx"
        onUpload={async (file) => {
          const fd = new FormData();
          fd.append("file", file);
          const res = await api.upload<{ count: number }>("/adherents/upload", fd);
          refresh();
          return `${res.count} adhérents importés.`;
        }}
      />
      <Card title="Adhérents" subtitle={`${adherents.length} adhérents`}>
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="py-2 pr-4">Nom</th>
                <th className="px-4 py-2">Prénom</th>
                <th className="px-4 py-2">Mail</th>
                <th className="px-4 py-2">Mobile</th>
              </tr>
            </thead>
            <tbody>
              {adherents.map((a) => (
                <tr key={a.id} className="border-b border-slate-100">
                  <td className="py-1.5 pr-4">{a.nom}</td>
                  <td className="px-4 py-1.5">{a.prenom}</td>
                  <td className="px-4 py-1.5 text-slate-500">{a.mail ?? "—"}</td>
                  <td className="px-4 py-1.5 text-slate-500">{a.mobile ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

interface RelanceMail {
  id: number;
  date: string;
  campagne_tag: string;
  total_envoye: number;
  erreurs_envoi: number;
  mails_lus: number;
  liens_clique: number;
}
interface RelanceSms {
  id: number;
  date: string;
  campagne_tag: string;
  sms_envoyes: number;
  erreurs_envoi: number;
  sms_delivres: number;
  sms_rejetes: number;
  statut_global: string;
}

interface RelanceTrackingRow {
  id: number;
  created_at: string;
  type: "mail" | "sms";
  campagne_tag: string;
  nom: string;
  prenom: string;
  contact: string;
  test_mode: number;
  clicked: number;
  last_checked_at: string | null;
  statusLabel: "ok" | "echec" | "en_attente";
}

const ELECTIONS_SITE_URL = "https://electionsprofessionnelles.spelc.fr/";

const DEFAULT_EMAIL_TEMPLATE = {
  subject: "Rappel : votez aux élections professionnelles 2026",
  body:
    "{{logo}}" +
    "Bonjour {{prenom}} {{nom}},\n\n" +
    "merci de voter aux élections professionnelles" +
    "{{#if CCMMEP_non_votant and scrutin_local_non_votant}} aux scrutins CCMMEP et {{scrutin_local}}{{/if}}" +
    "{{#if CCMMEP_non_votant and not(scrutin_local_non_votant)}} au scrutin CCMMEP{{/if}}" +
    "{{#if not(CCMMEP_non_votant) and scrutin_local_non_votant}} au scrutin {{scrutin_local}}{{/if}}." +
    `\n\nPour consulter le site des élections : <a href="${ELECTIONS_SITE_URL}">${ELECTIONS_SITE_URL}</a>` +
    "{{reseaux_sociaux}}",
};

const DEFAULT_SMS_TEMPLATE = {
  body:
    "Elections pro 2026 : {{prenom}}, pensez à voter" +
    "{{#if CCMMEP_non_votant and scrutin_local_non_votant}} au CCMMEP et au {{scrutin_local}}{{/if}}" +
    "{{#if CCMMEP_non_votant and not(scrutin_local_non_votant)}} au CCMMEP{{/if}}" +
    "{{#if not(CCMMEP_non_votant) and scrutin_local_non_votant}} au {{scrutin_local}}{{/if}} avant le 10/12.",
};

interface BrevoPlanEntry {
  type: string;
  credits: number;
  creditsType: string;
}

function creditLabel(type: string): string {
  return type.toLowerCase().includes("sms") ? "Crédit SMS" : "Crédit mails";
}

const BREVO_SMS_BILLING_URL = "https://app.sendinblue.com/billing/addon/customize/sms";
const SMS_CREDIT_LOW_THRESHOLD = 50;

function findSmsCredits(plan: BrevoPlanEntry[] | null): number | null {
  return plan?.find((p) => p.type.toLowerCase().includes("sms"))?.credits ?? null;
}

function BrevoPanel({ spelc }: { spelc: string }) {
  const [configured, setConfigured] = useState(false);
  const [maskedKey, setMaskedKey] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [emailTemplate, setEmailTemplate] = useState({ subject: "", body: "" });
  const [smsTemplate, setSmsTemplate] = useState({ body: "" });
  const [mailRows, setMailRows] = useState<RelanceMail[]>([]);
  const [smsRows, setSmsRows] = useState<RelanceSms[]>([]);
  const [campagneTag, setCampagneTag] = useState("relance-1");
  const [message, setMessage] = useState<string | null>(null);
  const [plan, setPlan] = useState<BrevoPlanEntry[] | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [testMode, setTestMode] = useState(false);
  const [testMailLimit, setTestMailLimit] = useState(3);
  const [smsLimit, setSmsLimit] = useState(20);
  const [spelcSettings, setSpelcSettings] = useState<{
    logoDataUri: string | null;
    socialLinks: SocialLinks;
    testEmail: string | null;
    testMobile: string | null;
  }>({ logoDataUri: null, socialLinks: {}, testEmail: null, testMobile: null });
  const [ownTestEmail, setOwnTestEmail] = useState("");
  const [ownTestMobile, setOwnTestMobile] = useState("");
  const [ownTestSaved, setOwnTestSaved] = useState<string | null>(null);
  const [testMailMsg, setTestMailMsg] = useState<string | null>(null);
  const [testSmsMsg, setTestSmsMsg] = useState<string | null>(null);
  const [testMailBusy, setTestMailBusy] = useState(false);
  const [testSmsBusy, setTestSmsBusy] = useState(false);
  const [trackingRows, setTrackingRows] = useState<RelanceTrackingRow[]>([]);
  const [trackingLoadedAt, setTrackingLoadedAt] = useState<Date | null>(null);
  const [trackingChecking, setTrackingChecking] = useState(false);

  function reloadTracking() {
    api
      .get<{ rows: RelanceTrackingRow[] }>(`/brevo/relance-tracking${qs({ spelc })}`)
      .then((r) => {
        setTrackingRows(r.rows);
        setTrackingLoadedAt(new Date());
      });
  }
  // Le statut final et les clics n'arrivent jamais au moment de l'envoi
  // (sondage Brevo côté serveur toutes les 5 minutes) : on relit régulièrement
  // pour refléter la dernière valeur connue sans action de l'admin.
  useEffect(() => {
    reloadTracking();
    const id = setInterval(reloadTracking, 60_000);
    return () => clearInterval(id);
  }, [spelc]);

  async function checkTrackingNow() {
    setTrackingChecking(true);
    try {
      await api.post("/brevo/relance-tracking/refresh", { spelc });
      reloadTracking();
    } finally {
      setTrackingChecking(false);
    }
  }

  function refreshAll() {
    api.get<{ configured: boolean; maskedKey: string | null }>("/brevo/settings").then((r) => {
      setConfigured(r.configured);
      setMaskedKey(r.maskedKey);
      if (r.configured) {
        api
          .get<{ plan: BrevoPlanEntry[] }>("/brevo/account")
          .then((res) => {
            setPlan(res.plan);
            setPlanError(null);
          })
          .catch((err) => {
            setPlan(null);
            setPlanError((err as Error).message);
          });
      }
    });
    api.get<{ subject: string; body: string }>(`/brevo/templates/email${qs({ spelc })}`).then(setEmailTemplate);
    api.get<{ body: string }>(`/brevo/templates/sms${qs({ spelc })}`).then(setSmsTemplate);
    api.get<{ rows: RelanceMail[] }>(`/brevo/tracking/mail${qs({ spelc })}`).then((r) => setMailRows(r.rows));
    api.get<{ rows: RelanceSms[] }>(`/brevo/tracking/sms${qs({ spelc })}`).then((r) => setSmsRows(r.rows));
    api
      .get<{ logoDataUri: string | null; socialLinks: SocialLinks; testEmail: string | null; testMobile: string | null }>(
        `/brevo/spelc-settings${qs({ spelc })}`
      )
      .then((r) => {
        setSpelcSettings(r);
        setOwnTestEmail(r.testEmail ?? "");
        setOwnTestMobile(r.testMobile ?? "");
      });
  }
  useEffect(refreshAll, [spelc]);

  async function sendTestMail() {
    setTestMailBusy(true);
    setTestMailMsg(null);
    try {
      const res = await api.post<{ sent: number; errors: number }>("/brevo/templates/email/test", {
        spelc,
        ...emailTemplate,
      });
      setTestMailMsg(res.sent > 0 ? "Mail de test envoyé." : "Échec de l'envoi.");
    } catch (err) {
      setTestMailMsg((err as Error).message);
    } finally {
      setTestMailBusy(false);
    }
  }

  async function sendTestSms() {
    setTestSmsBusy(true);
    setTestSmsMsg(null);
    try {
      const res = await api.post<{ sent: number; errors: number }>("/brevo/templates/sms/test", {
        spelc,
        body: smsTemplate.body,
      });
      setTestSmsMsg(res.sent > 0 ? "SMS de test envoyé." : "Échec de l'envoi.");
    } catch (err) {
      setTestSmsMsg((err as Error).message);
    } finally {
      setTestSmsBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card title="Clé API Brevo" subtitle={configured ? `Configurée (${maskedKey})` : "Non configurée"}>
        <div className="flex gap-2">
          <input
            type="password"
            placeholder="Clé API Brevo"
            className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <button
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
            onClick={async () => {
              await api.put("/brevo/settings", { apiKey });
              setApiKey("");
              refreshAll();
            }}
          >
            Enregistrer
          </button>
        </div>
      </Card>

      {configured && (
        <Card title="Crédits Brevo restants">
          {plan && plan.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-4">
                {plan.map((p, i) => (
                  <div key={i} className="rounded-md bg-slate-50 px-3 py-2">
                    <p className="text-xs text-slate-500">{creditLabel(p.type)}</p>
                    <p className="text-lg font-semibold text-slate-800">{p.credits.toLocaleString("fr-FR")}</p>
                  </div>
                ))}
              </div>
              {(() => {
                const smsCredits = findSmsCredits(plan);
                return smsCredits !== null && smsCredits < SMS_CREDIT_LOW_THRESHOLD ? (
                  <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    Crédit SMS faible ({smsCredits.toLocaleString("fr-FR")}) : pensez à en racheter avant vos
                    prochaines relances.
                  </p>
                ) : null;
              })()}
              <a
                href={BREVO_SMS_BILLING_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-block rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
              >
                Acheter des crédits SMS (Brevo) ↗
              </a>
            </div>
          )}
          {plan && plan.length === 0 && (
            <p className="text-sm text-slate-400">
              Le compte Brevo n'expose aucune information de crédit (offre par abonnement sans quota affiché par
              l'API).
            </p>
          )}
          {planError && <p className="text-sm text-red-600">{planError}</p>}
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <LogoUploadCard
          title="Logo (entête des mails)"
          currentLogo={spelcSettings.logoDataUri}
          onSave={async (dataUri) => {
            await api.put("/brevo/spelc-settings", { spelc, logoDataUri: dataUri });
            setSpelcSettings((s) => ({ ...s, logoDataUri: dataUri }));
          }}
        />
        <SocialLinksEditor
          value={spelcSettings.socialLinks}
          onSave={async (links) => {
            await api.put("/brevo/spelc-settings", { spelc, socialLinks: links });
            setSpelcSettings((s) => ({ ...s, socialLinks: links }));
          }}
        />
      </div>

      <Card
        title="Mail / mobile de test de ce Spelc"
        subtitle="Prioritaires sur le mail/mobile de test global de l'admin général pour les campagnes de ce Spelc (laisser vide pour utiliser le réglage global)."
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-slate-500">Mail de test</label>
            <input
              type="email"
              placeholder="moi@exemple.fr"
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              value={ownTestEmail}
              onChange={(e) => setOwnTestEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500">Mobile de test</label>
            <input
              type="tel"
              placeholder="06 00 00 00 00"
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              value={ownTestMobile}
              onChange={(e) => setOwnTestMobile(e.target.value)}
            />
          </div>
        </div>
        <button
          className="mt-2 rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900"
          onClick={async () => {
            await api.put("/brevo/spelc-settings", { spelc, testEmail: ownTestEmail, testMobile: ownTestMobile });
            setSpelcSettings((s) => ({ ...s, testEmail: ownTestEmail, testMobile: ownTestMobile }));
            setOwnTestSaved("Enregistré.");
            setTimeout(() => setOwnTestSaved(null), 2000);
          }}
        >
          Enregistrer
        </button>
        {ownTestSaved && <span className="ml-2 text-sm text-emerald-600">{ownTestSaved}</span>}
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card
          title="Modèle de mail de relance"
          subtitle={
            "Champs : {{nom}} {{prenom}} {{scrutin_local}} · {{CCMMEP_non_votant}} {{scrutin_local_non_votant}} · " +
            "{{logo}} {{reseaux_sociaux}} · {{#if expr}}…{{else}}…{{/if}} avec expr combinant and/or/not(...), ex. " +
            "\"CCMMEP_non_votant and not(scrutin_local_non_votant)\""
          }
        >
          <button
            type="button"
            className="mb-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            onClick={() => setEmailTemplate(DEFAULT_EMAIL_TEMPLATE)}
          >
            Charger le modèle prégarni
          </button>
          <input
            className="mb-2 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            placeholder="Objet du mail"
            value={emailTemplate.subject}
            onChange={(e) => setEmailTemplate({ ...emailTemplate, subject: e.target.value })}
          />
          <textarea
            className="h-40 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            placeholder="Bonjour {{prenom}}, ..."
            value={emailTemplate.body}
            onChange={(e) => setEmailTemplate({ ...emailTemplate, body: e.target.value })}
          />
          <button
            className="mt-2 rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900"
            onClick={() => api.put("/brevo/templates/email", { spelc, ...emailTemplate })}
          >
            Enregistrer le modèle
          </button>
        </Card>
        <Card
          title="Modèle de SMS de relance"
          subtitle="Mêmes champs que le mail : {{nom}} {{prenom}} {{scrutin_local}} · {{CCMMEP_non_votant}} {{scrutin_local_non_votant}}"
        >
          <button
            type="button"
            className="mb-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            onClick={() => setSmsTemplate(DEFAULT_SMS_TEMPLATE)}
          >
            Charger le modèle prégarni
          </button>
          <textarea
            className="h-40 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            placeholder="{{prenom}}, pensez à voter au {{scrutin}} avant le 10/12."
            value={smsTemplate.body}
            onChange={(e) => setSmsTemplate({ body: e.target.value })}
          />
          <button
            className="mt-2 rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900"
            onClick={() => api.put("/brevo/templates/sms", { spelc, body: smsTemplate.body })}
          >
            Enregistrer le modèle
          </button>
        </Card>
      </div>

      <Card
        title="Envoyer une campagne de relance"
        subtitle="Ciblage : adhérents non-votants au scrutin local"
      >
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
          <div>
            <label className="block text-xs font-medium text-slate-500">Limite d'envoi SMS</label>
            <input
              type="number"
              min={1}
              max={500}
              className="mt-1 w-32 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              value={smsLimit}
              onChange={(e) => setSmsLimit(Number(e.target.value))}
            />
          </div>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          La limite d'envoi SMS s'applique aussi bien en mode test qu'en envoi réel, pour ne pas consommer plus de
          crédits que prévu.
        </p>

        {testMode && (
          <div className="mt-3 grid grid-cols-1 gap-3 rounded-md border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs text-amber-800">
              En mode test, les mails/SMS sont envoyés au mail/mobile de test configuré par l'admin général (pas aux
              vrais adhérents), en utilisant le contenu personnalisé des N premiers adhérents ciblés — utile pour
              vérifier le rendu du modèle sans consommer de crédits sur de vraies personnes.
            </p>
            <div className="max-w-[10rem]">
              <label className="block text-xs font-medium text-slate-500">Nombre de mails à envoyer</label>
              <input
                type="number"
                min={1}
                max={20}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                value={testMailLimit}
                onChange={(e) => setTestMailLimit(Number(e.target.value))}
              />
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
            onClick={async () => {
              try {
                const res = await api.post<{ sent: number; errors: number; total: number }>("/brevo/campaigns/email", {
                  tag: campagneTag,
                  testMode,
                  testLimit: testMailLimit,
                });
                setMessage(`Mails : ${res.sent}/${res.total} envoyés, ${res.errors} erreurs.`);
                refreshAll();
              } catch (err) {
                setMessage((err as Error).message);
              }
            }}
          >
            Envoyer les mails
          </button>
          <button
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-60"
            disabled={testMailBusy}
            onClick={sendTestMail}
          >
            {testMailBusy ? "Envoi…" : "Mail de test"}
          </button>
          <button
            className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900"
            onClick={async () => {
              try {
                const res = await api.post<{ sent: number; errors: number; total: number }>("/brevo/campaigns/sms", {
                  tag: campagneTag,
                  testMode,
                  smsLimit,
                });
                setMessage(`SMS : ${res.sent}/${res.total} envoyés, ${res.errors} erreurs.`);
                refreshAll();
              } catch (err) {
                setMessage((err as Error).message);
              }
            }}
          >
            Envoyer les SMS
          </button>
          <button
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-60"
            disabled={testSmsBusy}
            onClick={sendTestSms}
          >
            {testSmsBusy ? "Envoi…" : "SMS de test"}
          </button>
          <button
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            onClick={async () => {
              try {
                await api.post("/brevo/tracking/sync", { tag: campagneTag });
                refreshAll();
              } catch (err) {
                setMessage((err as Error).message);
              }
            }}
          >
            Synchroniser les statistiques Brevo
          </button>
        </div>
        {message && <p className="mt-2 text-sm text-slate-600">{message}</p>}
        {testMailMsg && <p className="mt-1 text-sm text-slate-600">{testMailMsg}</p>}
        {testSmsMsg && <p className="mt-1 text-sm text-slate-600">{testSmsMsg}</p>}
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
        <Card title="Courbe de suivi des SMS">
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={smsRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="sms_envoyes" name="Envoyés" stroke={CATEGORICAL[0]} strokeWidth={2} />
                <Line type="monotone" dataKey="sms_delivres" name="Délivrés" stroke={CATEGORICAL[4]} strokeWidth={2} />
                <Line type="monotone" dataKey="sms_rejetes" name="Rejetés" stroke={CATEGORICAL[3]} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card title="Suivi des relances mail">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="py-2 pr-4">Date</th>
                <th className="px-4 py-2">Campagne</th>
                <th className="px-4 py-2">Envoyés</th>
                <th className="px-4 py-2">Erreurs</th>
                <th className="px-4 py-2">Lus</th>
                <th className="px-4 py-2">Cliqués</th>
              </tr>
            </thead>
            <tbody>
              {mailRows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="py-1.5 pr-4">{r.date}</td>
                  <td className="px-4 py-1.5">{r.campagne_tag}</td>
                  <td className="px-4 py-1.5">{r.total_envoye}</td>
                  <td className="px-4 py-1.5">{r.erreurs_envoi}</td>
                  <td className="px-4 py-1.5">{r.mails_lus}</td>
                  <td className="px-4 py-1.5">{r.liens_clique}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Suivi des relances SMS">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="py-2 pr-4">Date</th>
                <th className="px-4 py-2">Campagne</th>
                <th className="px-4 py-2">Envoyés</th>
                <th className="px-4 py-2">Erreurs</th>
                <th className="px-4 py-2">Délivrés</th>
                <th className="px-4 py-2">Rejetés</th>
              </tr>
            </thead>
            <tbody>
              {smsRows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="py-1.5 pr-4">{r.date}</td>
                  <td className="px-4 py-1.5">{r.campagne_tag}</td>
                  <td className="px-4 py-1.5">{r.sms_envoyes}</td>
                  <td className="px-4 py-1.5">{r.erreurs_envoi}</td>
                  <td className="px-4 py-1.5">{r.sms_delivres}</td>
                  <td className="px-4 py-1.5">{r.sms_rejetes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card
        title="Suivi détaillé des relances, par personne"
        subtitle={`${trackingRows.length} envois récents${
          trackingLoadedAt ? ` · dernière mise à jour ${trackingLoadedAt.toLocaleTimeString("fr-FR")}` : ""
        }`}
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
            onClick={checkTrackingNow}
            title="Interroge Brevo maintenant pour les statuts et clics en attente, au lieu d'attendre le prochain sondage automatique (toutes les 5 minutes)."
          >
            {trackingChecking ? "Vérification…" : "Vérifier les statuts Brevo"}
          </button>
          <span className="text-xs text-slate-400">
            Le statut final et les clics ne sont jamais immédiats : mis à jour automatiquement toutes les 5 minutes.
          </span>
        </div>
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="py-2 pr-4">Horodatage</th>
                <th className="px-4 py-2">Type</th>
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
                  <td className="py-1.5 pr-4 text-slate-500">{new Date(r.created_at).toLocaleString("fr-FR")}</td>
                  <td className="px-4 py-1.5">
                    {r.type === "mail" ? "Mail" : "SMS"}
                    {Boolean(r.test_mode) && (
                      <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">test</span>
                    )}
                  </td>
                  <td className="px-4 py-1.5 text-slate-500">{r.campagne_tag}</td>
                  <td className="px-4 py-1.5">{r.nom}</td>
                  <td className="px-4 py-1.5">{r.prenom}</td>
                  <td className="px-4 py-1.5 text-slate-500">{r.contact}</td>
                  <td className="px-4 py-1.5">
                    {r.statusLabel === "ok" ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">OK</span>
                    ) : (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">Échec</span>
                    )}
                  </td>
                  <td className="px-4 py-1.5">
                    {r.type === "sms" ? (
                      <span className="text-xs text-slate-300">—</span>
                    ) : r.clicked ? (
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
