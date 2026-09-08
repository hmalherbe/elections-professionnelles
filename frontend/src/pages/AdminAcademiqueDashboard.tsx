import { useEffect, useState } from "react";
import { CamembertCard } from "../components/CamembertCard";
import { Card } from "../components/Card";
import { Ccm2022ResultsTab } from "../components/Ccm2022ResultsTab";
import { ChatAssistantPanel } from "../components/ChatAssistantPanel";
import { CourbeCard } from "../components/CourbeCard";
import { DocumentsPanel } from "../components/DocumentsPanel";
import { EtablissementsTab } from "../components/EtablissementsTab";
import { FileUploadCard } from "../components/FileUploadCard";
import { ScopeToggle } from "../components/ScopeToggle";
import { ScrapingPanel } from "../components/ScrapingPanel";
import { ScrutinsTab } from "../components/ScrutinsTab";
import { api, qs } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { CourbePoint, ImportRecord } from "../lib/types";

const TABS = ["Vue académie", "Résultats 2022", "Scrutins", "Participation par établissement", "Imports", "Documents", "Assistant IA"] as const;
type Tab = (typeof TABS)[number];

export function AdminAcademiqueDashboard() {
  const { user } = useAuth();
  const academie = user!.academie!;
  const [tab, setTab] = useState<Tab>("Vue académie");
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
        {tab !== "Imports" && tab !== "Résultats 2022" && <ScopeToggle scope={scope} onChange={setScope} />}
      </div>

      {tab === "Vue académie" && <VueAcademie academie={academie} scope={scope} />}
      {tab === "Résultats 2022" && <Ccm2022ResultsTab mode="academie" value={academie} />}
      {tab === "Scrutins" && <ScrutinsTab scope={scope} academie={academie} />}
      {tab === "Participation par établissement" && <EtablissementsTab scope={scope} academie={academie} />}
      {tab === "Imports" && <ImportsPanel academie={academie} />}
      {tab === "Documents" && <DocumentsTab academie={academie} />}
      {tab === "Assistant IA" && <ChatAssistantPanel />}
    </div>
  );
}

/** Deux arborescences en lecture seule, gérées par l'admin général : celle
 * propre à cette académie, et l'arborescence commune (une seule copie,
 * partagée par toutes les académies — voir DocumentsPanel). */
function DocumentsTab({ academie }: { academie: string }) {
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-700">Documents communs à toutes les académies</h3>
        <DocumentsPanel general readOnly />
      </div>
      <div className="space-y-4 border-t border-slate-200 pt-6">
        <h3 className="text-sm font-semibold text-slate-700">Documents de l'académie</h3>
        <DocumentsPanel academie={academie} readOnly />
      </div>
    </div>
  );
}

function VueAcademie({ academie, scope }: { academie: string; scope: "national" | "academique" }) {
  const [camembert, setCamembert] = useState({ votants: 0, nonVotants: 0 });
  const [courbe, setCourbe] = useState<CourbePoint[]>([]);

  useEffect(() => {
    api.get<{ votants: number; nonVotants: number }>(`/stats/camembert${qs({ scope, academie })}`).then(setCamembert);
    api.get<{ points: CourbePoint[] }>(`/stats/courbe${qs({ scope, academie })}`).then((r) => setCourbe(r.points));
  }, [scope, academie]);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <CamembertCard title={`Participation — académie de ${academie}`} votants={camembert.votants} nonVotants={camembert.nonVotants} />
      <CourbeCard title="Courbe de participation cumulée" points={courbe} />
    </div>
  );
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function ImportsPanel({ academie }: { academie: string }) {
  const [degre, setDegre] = useState<"1D" | "2D">("1D");
  const [snapshotDate, setSnapshotDate] = useState(todayIso());
  const [imports, setImports] = useState<ImportRecord[]>([]);
  const [degreFilter, setDegreFilter] = useState<"" | "1D" | "2D">("");

  function refresh() {
    api.get<{ imports: ImportRecord[] }>("/imports").then((r) => setImports(r.imports.filter((i) => i.scope === "academique")));
  }
  useEffect(refresh, []);

  async function handleDelete(id: number) {
    if (!confirm("Supprimer cet import et tous les émargements associés ?")) return;
    await api.delete(`/imports/${id}`);
    refresh();
  }

  return (
    <div className="space-y-4">
      <ScrapingPanel mode="academique" imports={imports} onImported={refresh} />
      <FileUploadCard
        title={`Import quotidien — scrutin académique (${academie})`}
        subtitle="Fichier JSON des émargements du scrutin 1er ou 2nd degré (mêmes champs que le fichier CCMMEP : nom, prenom, dateEmargement, corps, affectation). Choisissez le bon degré ci-dessous avant de sélectionner le fichier."
        accept="application/json"
        extraFields={
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <label className="mr-2 text-xs font-medium text-slate-500">Degré :</label>
              <select
                className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                value={degre}
                onChange={(e) => setDegre(e.target.value as "1D" | "2D")}
              >
                <option value="1D">1er degré</option>
                <option value="2D">2nd degré</option>
              </select>
            </div>
            <div>
              <label className="mr-2 text-xs font-medium text-slate-500">Journée du scrutin représentée :</label>
              <input
                type="date"
                className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                value={snapshotDate}
                onChange={(e) => setSnapshotDate(e.target.value)}
              />
            </div>
          </div>
        }
        onUpload={async (file) => {
          const fd = new FormData();
          fd.append("file", file);
          fd.append("degre", degre);
          fd.append("academie", academie);
          fd.append("snapshotDate", snapshotDate);
          const res = await api.upload<{
            rowCount: number;
            votants: number;
            crossDegreDuplicates?: { nom: string; prenom: string }[];
          }>("/imports/academique", fd);
          refresh();
          const base = `${res.rowCount} lignes importées, ${res.votants} votants.`;
          if (!res.crossDegreDuplicates?.length) return base;
          const names = res.crossDegreDuplicates.map((p) => `${p.prenom} ${p.nom}`).join(", ");
          return (
            `${base} Attention : ${res.crossDegreDuplicates.length} personne(s) présente(s) à la fois dans les ` +
            `fichiers 1er et 2nd degré (${names}) — vérifiez que ces deux fichiers ne se chevauchent pas.`
          );
        }}
      />
      <Card title="Historique des imports académiques">
        <div className="mb-3 flex items-center gap-2">
          <label className="text-xs font-medium text-slate-500">Filtrer par degré :</label>
          <select
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            value={degreFilter}
            onChange={(e) => setDegreFilter(e.target.value as "" | "1D" | "2D")}
          >
            <option value="">Tous</option>
            <option value="1D">1er degré</option>
            <option value="2D">2nd degré</option>
          </select>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
              <th className="py-2 pr-4">Date</th>
              <th className="px-4 py-2">Degré</th>
              <th className="px-4 py-2">Fichier</th>
              <th className="px-4 py-2">Lignes</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {imports
              .filter((imp) => !degreFilter || imp.degre === degreFilter)
              .map((imp) => (
              <tr key={imp.id} className="border-b border-slate-100">
                <td className="py-1.5 pr-4">{imp.snapshot_date}</td>
                <td className="px-4 py-1.5">{imp.degre}</td>
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
      </Card>
    </div>
  );
}
