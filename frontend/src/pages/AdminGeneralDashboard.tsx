import { useEffect, useState } from "react";
import { CamembertCard } from "../components/CamembertCard";
import { Card } from "../components/Card";
import { Ccm2022MapPanel } from "../components/Ccm2022MapPanel";
import { ChatAssistantPanel } from "../components/ChatAssistantPanel";
import { CourbeCard } from "../components/CourbeCard";
import { DocumentsPanel } from "../components/DocumentsPanel";
import { FileUploadCard } from "../components/FileUploadCard";
import { PivotTree } from "../components/PivotTree";
import { ScrapingPanel } from "../components/ScrapingPanel";
import { ScrutinsTab } from "../components/ScrutinsTab";
import { api } from "../lib/api";
import type { AcademieNode, CourbePoint, ImportRecord, ManagedUser } from "../lib/types";

const TABS = [
  "Descriptif applicatif",
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
      {tab === "Utilisateurs" && <UsersPanel />}
      {tab === "Adhérents" && <AdherentsAdminPanel />}
      {tab === "Référentiels" && <ReferentielsPanel />}
      {tab === "Documents" && <DocumentsAdminPanel />}
      {tab === "Assistant IA" && <ChatAssistantPanel />}
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
    </div>
  );
}
