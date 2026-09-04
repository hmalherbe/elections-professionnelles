import { useEffect, useState } from "react";
import { CamembertCard } from "../components/CamembertCard";
import { Card } from "../components/Card";
import { CourbeCard } from "../components/CourbeCard";
import { EtablissementsTab } from "../components/EtablissementsTab";
import { FileUploadCard } from "../components/FileUploadCard";
import { PivotTree } from "../components/PivotTree";
import { ScrutinsTab } from "../components/ScrutinsTab";
import { api } from "../lib/api";
import type { AcademieNode, CourbePoint, ImportRecord, ManagedUser } from "../lib/types";

const TABS = [
  "Vue nationale",
  "Scrutins",
  "Participation par académie",
  "Imports",
  "Utilisateurs",
  "Référentiels",
  "PSA",
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
      {tab === "Scrutins" && <ScrutinsTab scope="national" />}
      {tab === "Participation par académie" && <EtablissementsTab scope="national" />}
      {tab === "Imports" && <ImportsPanel />}
      {tab === "Utilisateurs" && <UsersPanel />}
      {tab === "Référentiels" && <ReferentielsPanel />}
      {tab === "PSA" && <PsaPanel />}
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

function ImportsPanel() {
  const [imports, setImports] = useState<ImportRecord[]>([]);

  function refresh() {
    api.get<{ imports: ImportRecord[] }>("/imports").then((r) => setImports(r.imports));
  }
  useEffect(refresh, []);

  return (
    <div className="space-y-4">
      <FileUploadCard
        title="Import quotidien CCMMEP"
        subtitle="Fichier JSON des émargements du scrutin national (champs : nom, prenom, dateEmargement, corps, affectation, referenceBulletin)."
        accept="application/json"
        onUpload={async (file) => {
          const fd = new FormData();
          fd.append("file", file);
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
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function UsersPanel() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [academies, setAcademies] = useState<string[]>([]);
  const [spelcs, setSpelcs] = useState<string[]>([]);
  const [form, setForm] = useState({ email: "", password: "", role: "admin_academique", academie: "", spelc: "" });
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
      });
      setForm({ email: "", password: "", role: "admin_academique", academie: "", spelc: "" });
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
              <th className="py-2 pr-4">Email</th>
              <th className="px-4 py-2">Rôle</th>
              <th className="px-4 py-2">Périmètre</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-slate-100">
                <td className="py-1.5 pr-4">{u.email}</td>
                <td className="px-4 py-1.5">{u.role}</td>
                <td className="px-4 py-1.5 text-slate-500">{u.academie ?? u.spelc ?? "—"}</td>
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

function PsaPanel() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [summary, setSummary] = useState<{
    totalPsa: number;
    votedNational: number;
    votedLocal: number;
    tauxNational: number;
    tauxLocal: number;
  } | null>(null);

  async function launch() {
    setBusy(true);
    setResult(null);
    try {
      const run = await api.post<{ runId: number; count: number }>("/psa/simulate", {});
      const results = await api.get<{ summary: typeof summary }>(`/psa/runs/${run.runId}/results`);
      setSummary(results.summary);
      setResult(`Simulation terminée : ${run.count} émargements générés pour la journée PSA.`);
    } catch (err) {
      setResult((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
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
  );
}
