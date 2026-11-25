import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CamembertCard } from "../components/CamembertCard";
import { Card } from "../components/Card";
import { CourbeCard } from "../components/CourbeCard";
import { EtablissementsTab } from "../components/EtablissementsTab";
import { FileUploadCard } from "../components/FileUploadCard";
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
      <FuzzyMatchQueuePanel />
      <UnmatchedAdherentsPanel />
    </div>
  );
}

interface FuzzyMatch {
  id: number;
  adherentNom: string;
  adherentPrenom: string;
  candidateNom: string;
  candidatePrenom: string;
  status: "en_attente" | "valide" | "rejete";
  createdAt: string;
  reviewedAt: string | null;
}

/**
 * File de validation des rapprochements approximatifs (nom/prénom proches
 * mais pas identiques) proposés entre un adhérent et une identité des
 * émargements — voir services/fuzzyMatching.ts côté serveur. Une suggestion
 * n'est jamais appliquée toute seule : il faut la valider ou la rejeter
 * explicitement ici.
 */
function FuzzyMatchQueuePanel() {
  const [matches, setMatches] = useState<FuzzyMatch[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function refresh() {
    api.get<{ matches: FuzzyMatch[] }>(`/adherents/fuzzy-matches${qs({ status: "en_attente" })}`).then((r) => setMatches(r.matches));
  }
  useEffect(refresh, []);

  async function search() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.post<{ created: number; unmatchedExamined: number }>("/adherents/fuzzy-matches/refresh");
      setMessage(
        res.created > 0
          ? `${res.created} nouvelle(s) suggestion(s) trouvée(s) (sur ${res.unmatchedExamined} adhérent(s) non retrouvé(s) examiné(s)).`
          : `Aucune nouvelle suggestion (sur ${res.unmatchedExamined} adhérent(s) non retrouvé(s) examiné(s)).`
      );
      refresh();
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function review(id: number, status: "valide" | "rejete") {
    await api.put(`/adherents/fuzzy-matches/${id}`, { status });
    refresh();
  }

  return (
    <Card
      title={`Rapprochements approximatifs à valider (${matches.length})`}
      subtitle="Adhérents non retrouvés par correspondance exacte, mais dont le nom et le prénom sont très proches d'une personne des émargements — à valider ou rejeter explicitement."
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-60"
          disabled={busy}
          onClick={search}
        >
          {busy ? "Recherche en cours…" : "Rechercher des rapprochements"}
        </button>
        {message && <span className="text-sm text-slate-600">{message}</span>}
      </div>
      <div className="max-h-96 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
              <th className="py-2 pr-4">Adhérent</th>
              <th className="px-4 py-2">Trouvé dans les émargements</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {matches.map((m) => (
              <tr key={m.id} className="border-b border-slate-100">
                <td className="py-1.5 pr-4">
                  {m.adherentPrenom} {m.adherentNom}
                </td>
                <td className="px-4 py-1.5 font-medium text-amber-700">
                  {m.candidatePrenom} {m.candidateNom}
                </td>
                <td className="px-4 py-1.5 text-right">
                  <button
                    className="mr-2 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                    onClick={() => review(m.id, "valide")}
                  >
                    Valider
                  </button>
                  <button
                    className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100"
                    onClick={() => review(m.id, "rejete")}
                  >
                    Rejeter
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {matches.length === 0 && (
          <p className="py-4 text-sm text-slate-400">Aucun rapprochement en attente. Cliquez sur « Rechercher des rapprochements » pour en chercher.</p>
        )}
      </div>
    </Card>
  );
}

interface UnmatchedAdherent {
  id: number;
  nom: string;
  prenom: string;
  status: "aucun_candidat" | "ambigu" | "a_rafraichir" | "en_attente" | "valide" | "rejete";
  candidats: string[];
}

const UNMATCHED_STATUS_LABELS: Record<UnmatchedAdherent["status"], string> = {
  aucun_candidat: "Aucun candidat proche",
  ambigu: "Ambigu (plusieurs candidats)",
  a_rafraichir: "Candidat unique (cliquez sur « Rechercher des rapprochements »)",
  en_attente: "En attente de validation",
  valide: "Validé",
  rejete: "Rejeté",
};

/**
 * Détail nommé des adhérents derrière le compteur "adhérent(s) non
 * retrouvé(s) examiné(s)" du panneau ci-dessus — la file de validation ne
 * montre que ceux qui ont exactement un candidat proche ; ce panneau montre
 * aussi pourquoi les autres n'y figurent pas (ambigu, ou aucun candidat).
 * Chargé à la demande (liste potentiellement longue).
 */
function UnmatchedAdherentsPanel() {
  const [adherents, setAdherents] = useState<UnmatchedAdherent[] | null>(null);
  const [electeurs, setElecteurs] = useState<{ nom: string; prenom: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"tous" | UnmatchedAdherent["status"]>("tous");
  const [selection, setSelection] = useState<Record<number, string>>({});
  const [associating, setAssociating] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [adherentsRes, electeursRes] = await Promise.all([
        api.get<{ adherents: UnmatchedAdherent[] }>("/adherents/fuzzy-matches/unmatched"),
        api.get<{ electeurs: { nom: string; prenom: string }[] }>("/adherents/electeurs"),
      ]);
      setAdherents(adherentsRes.adherents);
      setElecteurs(electeursRes.electeurs);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const electeurByLabel = useMemo(() => {
    const map = new Map<string, { nom: string; prenom: string }>();
    for (const e of electeurs) map.set(`${e.prenom} ${e.nom}`, e);
    return map;
  }, [electeurs]);

  async function associer(adherentId: number) {
    const electeur = electeurByLabel.get(selection[adherentId] ?? "");
    if (!electeur) return;
    setAssociating(adherentId);
    try {
      await api.post("/adherents/fuzzy-matches/manual", {
        adherentId,
        candidateNom: electeur.nom,
        candidatePrenom: electeur.prenom,
      });
      await load();
      setSelection((prev) => ({ ...prev, [adherentId]: "" }));
    } finally {
      setAssociating(null);
    }
  }

  const filtered = adherents?.filter((a) => filter === "tous" || a.status === filter) ?? [];

  return (
    <Card
      title="Détail des adhérents non retrouvés"
      subtitle="Qui sont les adhérents sans correspondance exacte dans les émargements, et pourquoi (le cas échéant) aucune suggestion ne leur a été proposée."
    >
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {adherents === null ? (
        <button
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-60"
          disabled={loading}
          onClick={load}
        >
          {loading ? "Chargement…" : "Afficher le détail"}
        </button>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-600">
              {filtered.length} / {adherents.length} adhérent(s)
            </span>
            <select
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
              value={filter}
              onChange={(e) => setFilter(e.target.value as "tous" | UnmatchedAdherent["status"])}
            >
              <option value="tous">Tous les statuts</option>
              <option value="aucun_candidat">Aucun candidat proche</option>
              <option value="ambigu">Ambigu</option>
              <option value="a_rafraichir">Candidat unique (à rafraîchir)</option>
              <option value="en_attente">En attente de validation</option>
              <option value="valide">Validé</option>
              <option value="rejete">Rejeté</option>
            </select>
            <button
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-60"
              disabled={loading}
              onClick={load}
            >
              {loading ? "Chargement…" : "Rafraîchir"}
            </button>
          </div>
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                  <th className="py-2 pr-4">Adhérent</th>
                  <th className="px-4 py-2">Statut</th>
                  <th className="px-4 py-2">Candidat(s) proche(s)</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => (
                  <tr key={a.id} className="border-b border-slate-100">
                    <td className="py-1.5 pr-4">
                      {a.prenom} {a.nom}
                    </td>
                    <td className="px-4 py-1.5">{UNMATCHED_STATUS_LABELS[a.status]}</td>
                    <td className="px-4 py-1.5">
                      <div className="text-slate-500">{a.candidats.join(", ") || "—"}</div>
                      <div className="mt-1 flex items-center gap-1.5">
                        <input
                          list="electeurs-datalist"
                          className="w-48 rounded-md border border-slate-300 px-2 py-1 text-xs"
                          placeholder="Rapprocher manuellement…"
                          value={selection[a.id] ?? ""}
                          onChange={(e) => setSelection((prev) => ({ ...prev, [a.id]: e.target.value }))}
                        />
                        <button
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                          disabled={associating === a.id || !electeurByLabel.has(selection[a.id] ?? "")}
                          onClick={() => associer(a.id)}
                        >
                          {associating === a.id ? "…" : "Associer"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && <p className="py-4 text-sm text-slate-400">Aucun adhérent pour ce filtre.</p>}
          </div>
          <datalist id="electeurs-datalist">
            {electeurs.map((e) => (
              <option key={`${e.nom}|${e.prenom}`} value={`${e.prenom} ${e.nom}`} />
            ))}
          </datalist>
        </>
      )}
    </Card>
  );
}

function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4" onClick={onClose}>
      <div
        className={`max-h-[85vh] w-full overflow-auto rounded-lg bg-white p-6 shadow-lg ${wide ? "max-w-2xl" : "max-w-lg"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button type="button" className="text-slate-400 hover:text-slate-600" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function RelancesPanel() {
  const [brevoConfigured, setBrevoConfigured] = useState(false);
  const [maskedKey, setMaskedKey] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [brevoMsg, setBrevoMsg] = useState<string | null>(null);
  const [orgSettings, setOrgSettings] = useState<{ socialLinks: SocialLinks; testEmail: string | null }>({
    socialLinks: {},
    testEmail: null,
  });
  const [testEmailInput, setTestEmailInput] = useState("");
  const [testSaved, setTestSaved] = useState<string | null>(null);

  const [template, setTemplate] = useState({ subject: "", body: "" });
  const [templateMsg, setTemplateMsg] = useState<string | null>(null);
  const [emailPreview, setEmailPreview] = useState<{ label: string; subject: string; html: string }[] | null>(null);
  const [emailPreviewIndex, setEmailPreviewIndex] = useState(0);
  const [emailPreviewBusy, setEmailPreviewBusy] = useState(false);
  const [emailPreviewError, setEmailPreviewError] = useState<string | null>(null);
  const [showLexique, setShowLexique] = useState(false);
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
      .get<{ socialLinks: SocialLinks; testEmail: string | null }>("/admin/org-settings")
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

  async function previewEmail() {
    setEmailPreviewBusy(true);
    setEmailPreviewError(null);
    try {
      const res = await api.post<{ cases: { label: string; subject: string; html: string }[] }>("/brevo/templates/email/preview", template);
      setEmailPreviewIndex(0);
      setEmailPreview(res.cases);
    } catch (err) {
      setEmailPreviewError((err as Error).message);
    } finally {
      setEmailPreviewBusy(false);
    }
  }

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

      <SocialLinksEditor
        value={orgSettings.socialLinks}
        onSave={async (links) => {
          await api.put("/admin/org-settings", { socialLinks: links });
          refreshOrgSettings();
        }}
      />

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
          "Champs : {{nom}} {{prenom}} · {{scrutin1_non_votant}} {{scrutin2_non_votant}} · {{logo_spelc}} {{logo_rugby}} {{reseaux_sociaux}} · {{lien_desinscription}} · " +
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
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-60"
            disabled={emailPreviewBusy}
            onClick={previewEmail}
          >
            {emailPreviewBusy ? "Aperçu…" : "Aperçu"}
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            onClick={() => setShowLexique(true)}
          >
            Lexique des champs dynamiques
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

      {emailPreview && (
        <Modal title="Aperçu du mail" onClose={() => setEmailPreview(null)} wide>
          {emailPreview.length > 1 && (
            <div className="mb-3 flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2 py-1.5">
              <button
                type="button"
                className="rounded px-2 py-1 text-slate-500 hover:bg-slate-200 disabled:opacity-30"
                disabled={emailPreviewIndex === 0}
                onClick={() => setEmailPreviewIndex((i) => Math.max(0, i - 1))}
                aria-label="Cas précédent"
              >
                ←
              </button>
              <p className="text-center text-xs font-medium text-slate-600">{emailPreview[emailPreviewIndex].label}</p>
              <button
                type="button"
                className="rounded px-2 py-1 text-slate-500 hover:bg-slate-200 disabled:opacity-30"
                disabled={emailPreviewIndex === emailPreview.length - 1}
                onClick={() => setEmailPreviewIndex((i) => Math.min(emailPreview.length - 1, i + 1))}
                aria-label="Cas suivant"
              >
                →
              </button>
            </div>
          )}
          <p className="mb-2 text-sm font-medium text-slate-700">Objet : {emailPreview[emailPreviewIndex].subject}</p>
          <div className="rounded-md border border-slate-200" dangerouslySetInnerHTML={{ __html: emailPreview[emailPreviewIndex].html }} />
        </Modal>
      )}
      {emailPreviewError && (
        <Modal title="Aperçu du mail" onClose={() => setEmailPreviewError(null)}>
          <p className="text-sm text-red-600">{emailPreviewError}</p>
        </Modal>
      )}
      {showLexique && (
        <Modal title="Lexique des champs dynamiques" onClose={() => setShowLexique(false)} wide>
          <dl className="space-y-3 text-sm">
            {[
              { field: "{{nom}}", desc: "Nom de famille de l'adhérent." },
              { field: "{{prenom}}", desc: "Prénom de l'adhérent." },
              {
                field: "{{scrutin1_non_votant}}",
                desc: `Vrai si l'adhérent n'a pas encore voté au scrutin « ${SCRUTINS[0].label} ». À utiliser dans une condition {{#if ...}} (voir plus bas) — n'affiche rien par lui-même.`,
              },
              {
                field: "{{scrutin2_non_votant}}",
                desc: `Vrai si l'adhérent n'a pas encore voté au scrutin « ${SCRUTINS[1].label} ». Même usage que ci-dessus.`,
              },
              { field: "{{logo_spelc}}", desc: "Insère le logo du Spelc fédéral (image fixe, 200×200), centré en haut du mail." },
              { field: "{{logo_rugby}}", desc: "Insère la bannière de campagne (image fixe, pleine largeur)." },
              {
                field: "{{reseaux_sociaux}}",
                desc: "Insère les icônes des réseaux sociaux configurés ci-dessus (ceux cochés avec une adresse renseignée), en pied de mail.",
              },
              {
                field: "{{lien_desinscription}}",
                desc: "Insère le lien de désinscription : un clic désinscrit définitivement l'adresse mail des relances (voir la carte Désinscriptions plus bas).",
              },
              {
                field: "{{#if expression}}…{{else}}…{{/if}}",
                desc: "Affiche un contenu différent selon une condition. L'expression peut combiner scrutin1_non_votant et scrutin2_non_votant avec and / or / not(...), ex. \"scrutin1_non_votant and not(scrutin2_non_votant)\". Le bloc {{else}} est facultatif.",
              },
            ].map((item) => (
              <div key={item.field}>
                <dt className="font-mono text-xs font-semibold text-slate-800">{item.field}</dt>
                <dd className="mt-0.5 text-slate-600">{item.desc}</dd>
              </div>
            ))}
          </dl>
        </Modal>
      )}

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
      <DesinscriptionsPanel />
    </div>
  );
}

interface OptOutRow {
  contact: string;
  createdAt: string;
}

/**
 * Adresses mail désinscrites via le lien {{lien_desinscription}} des mails
 * de relance (voir routes/unsubscribe.ts côté serveur) — plus jamais
 * contactées tant qu'elles figurent ici. "Réinscrire" permet de corriger une
 * désinscription faite par erreur.
 */
function DesinscriptionsPanel() {
  const [rows, setRows] = useState<OptOutRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  function refresh() {
    api.get<{ optouts: OptOutRow[] }>("/brevo/optout").then((r) => setRows(r.optouts));
  }
  useEffect(refresh, []);

  async function reinscrire(contact: string) {
    await api.delete(`/brevo/optout${qs({ contact })}`);
    setMessage(`${contact} réinscrit(e).`);
    refresh();
  }

  return (
    <Card title={`Désinscriptions (${rows.length})`} subtitle="Adresses ayant cliqué sur le lien de désinscription d'un mail de relance.">
      {message && <p className="mb-2 text-sm text-slate-600">{message}</p>}
      <div className="max-h-96 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
              <th className="py-2 pr-4">Contact</th>
              <th className="px-4 py-2">Désinscrit le</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.contact} className="border-b border-slate-100">
                <td className="py-1.5 pr-4">{r.contact}</td>
                <td className="px-4 py-1.5 text-slate-500">{new Date(r.createdAt.replace(" ", "T") + "Z").toLocaleString("fr-FR")}</td>
                <td className="px-4 py-1.5 text-right">
                  <button
                    className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100"
                    onClick={() => reinscrire(r.contact)}
                  >
                    Réinscrire
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="py-4 text-sm text-slate-400">Aucune désinscription pour le moment.</p>}
      </div>
    </Card>
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
