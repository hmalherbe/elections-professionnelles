import { useEffect, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CamembertCard } from "../components/CamembertCard";
import { Card } from "../components/Card";
import { Ccm2022MapPanel } from "../components/Ccm2022MapPanel";
import { ChatAssistantPanel } from "../components/ChatAssistantPanel";
import { CourbeCard } from "../components/CourbeCard";
import { DocumentsPanel } from "../components/DocumentsPanel";
import { FileUploadCard } from "../components/FileUploadCard";
import { LogoUploadCard } from "../components/LogoUploadCard";
import { PivotTree } from "../components/PivotTree";
import { ScrapingPanel } from "../components/ScrapingPanel";
import { ScrutinsTab } from "../components/ScrutinsTab";
import { SocialLinksEditor } from "../components/SocialLinksEditor";
import { api } from "../lib/api";
import { CATEGORICAL } from "../lib/colors";
import type { AcademieNode, CourbePoint, ImportRecord, ManagedUser } from "../lib/types";
import type { SocialLinks } from "../lib/socialLinks";

const TABS = [
  "Vue nationale",
  "Résultats CCM 2022",
  "Scrutins",
  "Imports",
  "Electeurs académiques",
  "Utilisateurs",
  "Adhérents",
  "Référentiels",
  "Documents",
  "Assistant IA",
  "Journée des PSA le 16 septembre 2026",
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

      {tab === "Vue nationale" && <VueNationale />}
      {tab === "Résultats CCM 2022" && <Ccm2022MapPanel />}
      {tab === "Scrutins" && <ScrutinsTab scope="national" />}
      {tab === "Imports" && <ImportsPanel />}
      {tab === "Electeurs académiques" && <ElecteursAcademiquesPanel />}
      {tab === "Utilisateurs" && <UsersPanel />}
      {tab === "Adhérents" && <AdherentsAdminPanel />}
      {tab === "Référentiels" && <ReferentielsPanel />}
      {tab === "Documents" && <DocumentsAdminPanel />}
      {tab === "Assistant IA" && <ChatAssistantPanel />}
      {tab === "Journée des PSA le 16 septembre 2026" && <PsaPanel />}
    </div>
  );
}

/** Dépôt des documents pour une académie, choisie ci-dessous pour organiser son
 * arborescence — chaque dépôt peut aussi être diffusé vers d'autres académies
 * (ou toutes), voir le sélecteur de destinataires dans DocumentsPanel. La vue
 * académique affiche ensuite la même arborescence en lecture seule. Pas de
 * Spelc ici : la partie Spelc n'a plus d'onglet Documents. */
function DocumentsAdminPanel() {
  const [academies, setAcademies] = useState<string[]>([]);
  const [selected, setSelected] = useState("");

  useEffect(() => {
    api.get<{ academies: string[] }>("/admin/reference/academies").then((r) => setAcademies(r.academies));
  }, []);

  return (
    <div className="space-y-4">
      <Card
        title="Choisir l'académie"
        subtitle="Arborescence de dossiers à organiser. Lors du dépôt d'un document, vous pourrez choisir de le diffuser aussi vers d'autres académies, ou toutes."
      >
        <select
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">— Sélectionner —</option>
          {academies.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </Card>
      {selected && <DocumentsPanel key={selected} academie={selected} allAcademies={academies} />}
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
      <ScrapingPanel mode="national" imports={imports} onImported={refresh} />
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
        Les fichiers JSON <strong>1er et 2nd degré des scrutins académiques</strong> ne s'importent pas ici : chaque
        admin académique les dépose depuis son propre tableau de bord, onglet « Imports ». Cet onglet-ci est
        réservé au scrutin national CCMMEP. L'historique ci-dessous liste toutefois tous les imports, nationaux et
        académiques confondus.
      </div>
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
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
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
        title="Présidents des syndicats adhérents (PSA)"
        subtitle="Fichier Excel de la liste des PSA. 1re ligne = en-têtes. Remplace entièrement la liste précédente."
        expectedColumns={["Type scrutin (CCMI/CCMA…)", "Nom", "Prénom", "Email", "Mobile"]}
        accept=".xlsx"
        onUpload={async (file) => {
          const fd = new FormData();
          fd.append("file", file);
          const res = await api.upload<{ count: number }>("/admin/reference/psa", fd);
          return `${res.count} PSA chargés.`;
        }}
      />
    </div>
  );
}

const ELECTION_DATES = [
  "2026-12-03",
  "2026-12-04",
  "2026-12-05",
  "2026-12-06",
  "2026-12-07",
  "2026-12-08",
  "2026-12-09",
  "2026-12-10",
];

function formatDateFr(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

const ELECTIONS_SITE_URL = "https://electionsprofessionnelles.spelc.fr/";

const DEFAULT_PSA_EMAIL_TEMPLATE = {
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

const DEFAULT_PSA_SMS_TEMPLATE = {
  body:
    "Elections pro 2026 : {{prenom}}, pensez à voter" +
    "{{#if CCMMEP_non_votant and scrutin_local_non_votant}} au CCMMEP et au {{scrutin_local}}{{/if}}" +
    "{{#if CCMMEP_non_votant and not(scrutin_local_non_votant)}} au CCMMEP{{/if}}" +
    "{{#if not(CCMMEP_non_votant) and scrutin_local_non_votant}} au {{scrutin_local}}{{/if}} avant le 10/12.",
};

interface RelanceLogEntry {
  timestamp: string;
  type: "mail" | "sms";
  provider: string;
  scope: string;
  campagneTag: string;
  nom: string;
  prenom: string;
  contact: string;
  testMode: boolean;
  success: boolean;
  errorMessage: string | null;
  deliveryStatus: string | null;
  clicked: boolean;
  clickedAt: string | null;
  lastCheckedAt: string | null;
}

function PsaPanel() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [runId, setRunId] = useState<number | null>(null);
  const [logRefreshKey, setLogRefreshKey] = useState(0);
  const [summary, setSummary] = useState<{
    totalPsa: number;
    votedNational: number;
    votedLocal: number;
    tauxNational: number;
    tauxLocal: number;
  } | null>(null);

  useEffect(() => {
    api.get<{ runs: { id: number }[] }>("/psa/runs").then((r) => {
      const latest = r.runs[0];
      if (!latest) return;
      setRunId(latest.id);
      api
        .get<{ summary: typeof summary }>(`/psa/runs/${latest.id}/results`)
        .then((res) => setSummary(res.summary));
    });
  }, []);

  async function launch() {
    setBusy(true);
    setResult(null);
    try {
      const run = await api.post<{ runId: number; count: number }>("/psa/simulate", {});
      const results = await api.get<{ summary: typeof summary }>(`/psa/runs/${run.runId}/results`);
      setSummary(results.summary);
      setRunId(run.runId);
      setResult(`Simulation terminée : ${run.count} émargements générés pour la journée PSA.`);
    } catch (err) {
      setResult((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card
        title="Journée des présidents des syndicats adhérents (PSA)"
        subtitle="Génère une participation aléatoire aux scrutins CCMMEP et local pour chaque jour du 3 au 10 décembre 2026"
      >
        <button
          disabled={busy}
          onClick={launch}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {busy ? "Simulation en cours…" : "Lancer une simulation"}
        </button>
        {result && <p className="mt-3 text-sm text-slate-600">{result}</p>}
        {summary && (
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-md bg-slate-50 p-3">
              <p className="text-xs text-slate-500">PSA</p>
              <p className="text-lg font-semibold">{summary.totalPsa}</p>
            </div>
            <div className="rounded-md bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Votants CCMMEP</p>
              <p className="text-lg font-semibold">
                {summary.votedNational} ({(summary.tauxNational * 100).toFixed(0)}%)
              </p>
            </div>
            <div className="rounded-md bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Votants scrutin local</p>
              <p className="text-lg font-semibold">
                {summary.votedLocal} ({(summary.tauxLocal * 100).toFixed(0)}%)
              </p>
            </div>
          </div>
        )}
      </Card>

      <PsaBrevoSettings />
      <PsaTemplates />
      {runId && <PsaRelanceSection runId={runId} onSent={() => setLogRefreshKey((k) => k + 1)} />}
      <PsaRelanceCharts key={`charts-${logRefreshKey}`} />
      <RelanceLogPanel key={logRefreshKey} />
    </div>
  );
}

interface RelanceMail {
  date: string;
  total_envoye: number;
  erreurs_envoi: number;
  mails_lus: number;
  liens_clique: number;
}
/** Idem pour la courbe de suivi des SMS. */
interface RelanceSms {
  date: string;
  sms_envoyes: number;
  erreurs_envoi: number;
  sms_delivres: number;
  sms_rejetes: number;
}

/** Courbes de suivi des relances PSA (mails/SMS envoyés par jour), même principe que le tableau de bord Spelc. */
function PsaRelanceCharts() {
  const [mailRows, setMailRows] = useState<RelanceMail[]>([]);
  const [smsRows, setSmsRows] = useState<RelanceSms[]>([]);

  useEffect(() => {
    api.get<{ rows: RelanceMail[] }>("/psa/tracking/mail").then((r) => setMailRows(r.rows));
    api.get<{ rows: RelanceSms[] }>("/psa/tracking/sms").then((r) => setSmsRows(r.rows));
  }, []);

  return (
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
  );
}

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

function PsaBrevoSettings() {
  const [configured, setConfigured] = useState(false);
  const [maskedKey, setMaskedKey] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [plan, setPlan] = useState<BrevoPlanEntry[] | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [testEmail, setTestEmail] = useState("");
  const [testMobile, setTestMobile] = useState("");
  const [saved, setSaved] = useState<string | null>(null);

  function refresh() {
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
    api.get<{ testEmail: string | null; testMobile: string | null }>("/admin/test-settings").then((r) => {
      setTestEmail(r.testEmail ?? "");
      setTestMobile(r.testMobile ?? "");
    });
  }
  useEffect(refresh, []);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card
        title="Clé API Brevo (relances PSA)"
        subtitle={configured ? `Configurée (${maskedKey})` : "Non configurée — indépendante des clés des Spelcs"}
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
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
            onClick={async () => {
              await api.put("/brevo/settings", { apiKey });
              setApiKey("");
              refresh();
            }}
          >
            Enregistrer
          </button>
        </div>
        {configured && plan && plan.length > 0 && (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap gap-3">
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
        {planError && <p className="mt-2 text-sm text-red-600">{planError}</p>}
      </Card>

      <Card
        title="Mail / mobile de test (global)"
        subtitle="Utilisés partout où le mode test est activé : campagnes Brevo des Spelcs et relances PSA"
      >
        <div className="space-y-2">
          <div>
            <label className="block text-xs font-medium text-slate-500">Mail de test</label>
            <input
              type="email"
              placeholder="moi@exemple.fr"
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500">Mobile de test</label>
            <input
              type="tel"
              placeholder="06 00 00 00 00"
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              value={testMobile}
              onChange={(e) => setTestMobile(e.target.value)}
            />
          </div>
          <button
            className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900"
            onClick={async () => {
              await api.put("/admin/test-settings", { testEmail, testMobile });
              setSaved("Enregistré.");
              setTimeout(() => setSaved(null), 2000);
            }}
          >
            Enregistrer
          </button>
          {saved && <span className="ml-2 text-sm text-emerald-600">{saved}</span>}
        </div>
      </Card>
    </div>
  );
}

function PsaTemplates() {
  const [emailTemplate, setEmailTemplate] = useState({ subject: "", body: "" });
  const [smsTemplate, setSmsTemplate] = useState({ body: "" });
  const [branding, setBranding] = useState<{ logoDataUri: string | null; socialLinks: SocialLinks }>({
    logoDataUri: null,
    socialLinks: {},
  });
  const [testMailMsg, setTestMailMsg] = useState<string | null>(null);
  const [testSmsMsg, setTestSmsMsg] = useState<string | null>(null);
  const [testMailBusy, setTestMailBusy] = useState(false);
  const [testSmsBusy, setTestSmsBusy] = useState(false);

  useEffect(() => {
    api.get<{ subject: string; body: string }>("/psa/templates/email").then(setEmailTemplate);
    api.get<{ body: string }>("/psa/templates/sms").then(setSmsTemplate);
    api.get<{ logoDataUri: string | null; socialLinks: SocialLinks }>("/psa/branding").then(setBranding);
  }, []);

  async function sendTestMail() {
    setTestMailBusy(true);
    setTestMailMsg(null);
    try {
      const res = await api.post<{ sent: number; errors: number; errorMessage: string | null }>(
        "/psa/templates/email/test",
        emailTemplate
      );
      setTestMailMsg(res.sent > 0 ? "Mail de test envoyé." : `Échec de l'envoi : ${res.errorMessage ?? "raison inconnue."}`);
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
      const res = await api.post<{ sent: number; errors: number; errorMessage: string | null }>(
        "/psa/templates/sms/test",
        smsTemplate
      );
      setTestSmsMsg(res.sent > 0 ? "SMS de test envoyé." : `Échec de l'envoi : ${res.errorMessage ?? "raison inconnue."}`);
    } catch (err) {
      setTestSmsMsg((err as Error).message);
    } finally {
      setTestSmsBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <LogoUploadCard
          title="Logo (entête des mails PSA)"
          currentLogo={branding.logoDataUri}
          onSave={async (dataUri) => {
            await api.put("/psa/branding", { logoDataUri: dataUri });
            setBranding((b) => ({ ...b, logoDataUri: dataUri }));
          }}
        />
        <SocialLinksEditor
          value={branding.socialLinks}
          onSave={async (links) => {
            await api.put("/psa/branding", { socialLinks: links });
            setBranding((b) => ({ ...b, socialLinks: links }));
          }}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card
          title="Modèle de mail de relance PSA"
          subtitle={
            "Champs : {{nom}} {{prenom}} {{scrutin_local}} · {{CCMMEP_non_votant}} {{scrutin_local_non_votant}} · " +
            "{{logo}} {{reseaux_sociaux}} · {{#if expr}}…{{else}}…{{/if}} avec expr combinant and/or/not(...)"
          }
        >
          <button
            type="button"
            className="mb-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            onClick={() => setEmailTemplate(DEFAULT_PSA_EMAIL_TEMPLATE)}
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
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900"
              onClick={() => api.put("/psa/templates/email", emailTemplate)}
            >
              Enregistrer le modèle
            </button>
            <button
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-60"
              disabled={testMailBusy}
              onClick={sendTestMail}
            >
              {testMailBusy ? "Envoi…" : "Mail de test"}
            </button>
          </div>
          {testMailMsg && <p className="mt-1 text-xs text-slate-600">{testMailMsg}</p>}
        </Card>
        <Card
          title="Modèle de SMS de relance PSA"
          subtitle="Mêmes champs que le mail : {{nom}} {{prenom}} {{scrutin_local}} · {{CCMMEP_non_votant}} {{scrutin_local_non_votant}}"
        >
          <button
            type="button"
            className="mb-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            onClick={() => setSmsTemplate(DEFAULT_PSA_SMS_TEMPLATE)}
          >
            Charger le modèle prégarni
          </button>
          <textarea
            className="h-40 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            placeholder="{{prenom}}, pensez à voter au {{scrutin_local}} avant le 10/12."
            value={smsTemplate.body}
            onChange={(e) => setSmsTemplate({ body: e.target.value })}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900"
              onClick={() => api.put("/psa/templates/sms", { body: smsTemplate.body })}
            >
              Enregistrer le modèle
            </button>
            <button
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-60"
              disabled={testSmsBusy}
              onClick={sendTestSms}
            >
              {testSmsBusy ? "Envoi…" : "SMS de test"}
            </button>
          </div>
          {testSmsMsg && <p className="mt-1 text-xs text-slate-600">{testSmsMsg}</p>}
        </Card>
      </div>
    </div>
  );
}

function PsaRelanceSection({ runId, onSent }: { runId: number; onSent: () => void }) {
  const [mailDates, setMailDates] = useState<Set<string>>(new Set());
  const [smsDates, setSmsDates] = useState<Set<string>>(new Set());
  const [testMode, setTestMode] = useState(true);
  const [smsLimit, setSmsLimit] = useState(20);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function toggle(set: Set<string>, setter: (s: Set<string>) => void, date: string) {
    const next = new Set(set);
    if (next.has(date)) next.delete(date);
    else next.add(date);
    setter(next);
  }

  async function send() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.post<{ mailSent: number; mailErrors: number; smsSent: number; smsErrors: number }>(
        "/psa/relance",
        {
          runId,
          mailDates: Array.from(mailDates),
          smsDates: Array.from(smsDates),
          testMode,
          smsLimit,
        }
      );
      setMessage(
        `Mails : ${res.mailSent} envoyés / ${res.mailErrors} erreurs · SMS : ${res.smsSent} envoyés / ${res.smsErrors} erreurs.`
      );
      onSent();
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Relances PSA par date"
      subtitle="Cocher les jours où une relance aurait été envoyée aux PSA n'ayant pas encore voté à cette date (national et/ou local)"
    >
      <div className="space-y-3">
        <div>
          <p className="mb-1 text-xs font-medium text-slate-500">
            Pour chaque jour, cocher mail et/ou SMS (indépendamment l'un de l'autre)
          </p>
          <table className="text-sm text-slate-600">
            <thead>
              <tr className="text-xs font-medium text-slate-500">
                <th className="pr-4 text-left font-medium">Date</th>
                <th className="px-3 text-center font-medium">Mail</th>
                <th className="px-3 text-center font-medium">SMS</th>
              </tr>
            </thead>
            <tbody>
              {ELECTION_DATES.map((d) => (
                <tr key={d}>
                  <td className="pr-4 py-0.5">{formatDateFr(d)}</td>
                  <td className="px-3 py-0.5 text-center">
                    <input
                      type="checkbox"
                      checked={mailDates.has(d)}
                      onChange={() => toggle(mailDates, setMailDates, d)}
                    />
                  </td>
                  <td className="px-3 py-0.5 text-center">
                    <input
                      type="checkbox"
                      checked={smsDates.has(d)}
                      onChange={() => toggle(smsDates, setSmsDates, d)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={testMode} onChange={(e) => setTestMode(e.target.checked)} />
          Mode test (envoie au mail/mobile de test global plutôt qu'aux vrais PSA)
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
          <p className="mt-1 text-xs text-slate-500">
            Nombre max de SMS envoyés au total (toutes dates cochées confondues), pour ne pas consommer plus de
            crédits que prévu.
          </p>
        </div>
        <button
          disabled={busy || (mailDates.size === 0 && smsDates.size === 0)}
          onClick={send}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {busy ? "Envoi en cours…" : "Envoyer les relances"}
        </button>
        {message && <p className="text-sm text-slate-600">{message}</p>}
      </div>
    </Card>
  );
}

/** Actualisation automatique en tâche de fond : le statut final et les clics
 * n'arrivent jamais au moment de l'envoi (sondage Brevo côté serveur toutes
 * les 5 minutes), donc on relit régulièrement pour refléter la dernière
 * valeur connue sans que l'admin ait à cliquer sur "Actualiser". */
const RELANCE_AUTO_REFRESH_MS = 60_000;

function ClicBadge({ type, clicked }: { type: "mail" | "sms"; clicked: boolean }) {
  if (type === "sms") return <span className="text-xs text-slate-300">—</span>;
  return clicked ? (
    <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700">Oui</span>
  ) : (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Non</span>
  );
}

function StatutBadge({ success, errorMessage }: { success: boolean; errorMessage?: string | null }) {
  return success ? (
    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">OK</span>
  ) : (
    <span
      className="cursor-help rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700"
      title={errorMessage ?? "Échec de l'envoi (raison non disponible)."}
    >
      Échec
    </span>
  );
}

function RelanceLogPanel() {
  const [entries, setEntries] = useState<RelanceLogEntry[]>([]);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [checking, setChecking] = useState(false);

  function reload() {
    api
      .get<{ entries: RelanceLogEntry[] }>("/admin/relance-log?limit=300")
      .then((r) => {
        setEntries(r.entries);
        setLastLoadedAt(new Date());
      });
  }

  useEffect(() => {
    reload();
    const id = setInterval(reload, RELANCE_AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  async function checkNow() {
    setChecking(true);
    try {
      await api.post("/admin/relance-log/refresh", {});
      reload();
    } finally {
      setChecking(false);
    }
  }

  return (
    <Card
      title="Journal des relances"
      subtitle={`${entries.length} envois récents (mails et SMS, Spelcs et PSA)${
        lastLoadedAt ? ` · dernière mise à jour ${lastLoadedAt.toLocaleTimeString("fr-FR")}` : ""
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
          onClick={reload}
        >
          Actualiser
        </button>
        <button
          type="button"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-60"
          disabled={checking}
          onClick={checkNow}
          title="Interroge Brevo maintenant pour les statuts et clics en attente, au lieu d'attendre le prochain sondage automatique (toutes les 5 minutes)."
        >
          {checking ? "Vérification…" : "Vérifier les statuts Brevo"}
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
              <th className="px-4 py-2">Périmètre</th>
              <th className="px-4 py-2">Campagne</th>
              <th className="px-4 py-2">Nom</th>
              <th className="px-4 py-2">Prénom</th>
              <th className="px-4 py-2">Contact</th>
              <th className="px-4 py-2">Statut</th>
              <th className="px-4 py-2">Clic</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="py-1.5 pr-4 text-slate-500">{new Date(e.timestamp).toLocaleString("fr-FR")}</td>
                <td className="px-4 py-1.5">{e.type === "mail" ? "Mail" : "SMS"}</td>
                <td className="px-4 py-1.5">
                  {e.scope}
                  {e.testMode && <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">test</span>}
                </td>
                <td className="px-4 py-1.5 text-slate-500">{e.campagneTag}</td>
                <td className="px-4 py-1.5">{e.nom}</td>
                <td className="px-4 py-1.5">{e.prenom}</td>
                <td className="px-4 py-1.5 text-slate-500">{e.contact}</td>
                <td className="px-4 py-1.5">
                  <StatutBadge success={e.success} errorMessage={e.errorMessage} />
                </td>
                <td className="px-4 py-1.5">
                  <ClicBadge type={e.type} clicked={e.clicked} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {entries.length === 0 && <p className="py-4 text-sm text-slate-400">Aucune relance envoyée pour le moment.</p>}
      </div>
    </Card>
  );
}
