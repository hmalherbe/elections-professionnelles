import { useEffect, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CamembertCard } from "../components/CamembertCard";
import { CATEGORICAL } from "../lib/colors";
import { Card } from "../components/Card";
import { CourbeCard } from "../components/CourbeCard";
import { EtablissementsTab } from "../components/EtablissementsTab";
import { FileUploadCard } from "../components/FileUploadCard";
import { ScopeToggle } from "../components/ScopeToggle";
import { ScrutinsTab } from "../components/ScrutinsTab";
import { api, qs } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { CourbePoint } from "../lib/types";

const TABS = ["Vue Spelc", "Scrutins", "Participation par établissement", "Adhérents", "Brevo"] as const;
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
      {tab === "Scrutins" && <ScrutinsTab scope={scope} spelc={spelc} allowAdherentFilter={scope === "academique"} />}
      {tab === "Participation par établissement" && <EtablissementsTab scope={scope} spelc={spelc} />}
      {tab === "Adhérents" && <AdherentsPanel spelc={spelc} />}
      {tab === "Brevo" && <BrevoPanel spelc={spelc} />}
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
        subtitle="Fichier Excel : nom, prénom, mail, numéro de mobile"
        accept=".xlsx"
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

  function refreshAll() {
    api.get<{ configured: boolean; maskedKey: string | null }>("/brevo/settings").then((r) => {
      setConfigured(r.configured);
      setMaskedKey(r.maskedKey);
    });
    api.get<{ subject: string; body: string }>(`/brevo/templates/email${qs({ spelc })}`).then(setEmailTemplate);
    api.get<{ body: string }>(`/brevo/templates/sms${qs({ spelc })}`).then(setSmsTemplate);
    api.get<{ rows: RelanceMail[] }>(`/brevo/tracking/mail${qs({ spelc })}`).then((r) => setMailRows(r.rows));
    api.get<{ rows: RelanceSms[] }>(`/brevo/tracking/sms${qs({ spelc })}`).then((r) => setSmsRows(r.rows));
  }
  useEffect(refreshAll, [spelc]);

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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card title="Modèle de mail de relance" subtitle="Champs : {{nom}} {{prenom}} {{scrutin}} · {{#if votant}}…{{else}}…{{/if}}">
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
        <Card title="Modèle de SMS de relance">
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

      <Card title="Envoyer une campagne de relance" subtitle="Ciblage : adhérents non-votants au scrutin local">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500">Tag de campagne</label>
            <input
              className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              value={campagneTag}
              onChange={(e) => setCampagneTag(e.target.value)}
            />
          </div>
          <button
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
            onClick={async () => {
              try {
                const res = await api.post<{ sent: number; errors: number; total: number }>("/brevo/campaigns/email", {
                  tag: campagneTag,
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
            className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900"
            onClick={async () => {
              try {
                const res = await api.post<{ sent: number; errors: number; total: number }>("/brevo/campaigns/sms", {
                  tag: campagneTag,
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
    </div>
  );
}
