import ExcelJS from "exceljs";
import type { ScrutinDetailResult, ScrutinStats } from "../services/stats.js";
import { SCRUTINS } from "./scrutins.js";

function addSyntheseRows(sheet: ExcelJS.Worksheet, label: string, stats: ScrutinStats): void {
  const rows: [string, string | number][] = [
    [`${label} — Inscrits`, stats.inscrits],
    [`${label} — Votants`, stats.votants],
    [`${label} — Taux de participation`, stats.taux],
    [`${label} — Adhérents inscrits`, stats.adherentsInscrits],
    [`${label} — Adhérents votants`, stats.adherentsVotants],
    [`${label} — Taux de participation (adhérents)`, stats.adherentsTaux],
  ];
  for (const [rowLabel, value] of rows) {
    const row = sheet.addRow([rowLabel, value]);
    row.font = { name: "Arial" };
    row.getCell(1).font = { name: "Arial", bold: true };
    if (rowLabel.includes("Taux")) row.getCell(2).numFmt = "0.0%";
  }
}

/**
 * Classeur Excel du détail par établissement de l'onglet "Scrutin" (bouton
 * "Export Excel") : une ligne de synthèse globale par scrutin ("le CCM" et
 * "la CCM"), puis une ligne d'en-tête par établissement (niveau 0) suivie
 * d'une ligne par électeur (niveau 1, repliable via le plan Excel natif —
 * "+"/"-" dans la marge), avec un statut et un émargement par scrutin —
 * même hiérarchie établissement -> électeur que le tableau de l'application.
 */
export function buildScrutinDetailWorkbook(data: ScrutinDetailResult): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();

  const syntheseSheet = wb.addWorksheet("Synthèse");
  syntheseSheet.columns = [{ width: 42 }, { width: 16 }];
  addSyntheseRows(syntheseSheet, SCRUTINS[0].label, data.global.scrutin1);
  syntheseSheet.addRow([]);
  addSyntheseRows(syntheseSheet, SCRUTINS[1].label, data.global.scrutin2);

  const sheet = wb.addWorksheet("Détail par établissement", {
    properties: { outlineLevelRow: 1, outlineProperties: { summaryBelow: false, summaryRight: false } },
    views: [{ state: "frozen", ySplit: 1 }],
  });

  const headers = ["Établissement", "Nom", "Prénom", "Statut (le CCM)", "Émargement (le CCM)", "Statut (la CCM)", "Émargement (la CCM)", "Adhérent"];
  const headerRow = sheet.addRow(headers);
  headerRow.font = { name: "Arial", bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
  });
  sheet.columns = [
    { width: 42 },
    { width: 22 },
    { width: 18 },
    { width: 14 },
    { width: 20 },
    { width: 14 },
    { width: 20 },
    { width: 12 },
  ];

  function statutLabel(e: { votant: number } | null): string {
    return e == null ? "Non inscrit" : e.votant ? "Votant" : "Non votant";
  }
  function emargementLabel(e: { dateEmargement: string | null } | null): string {
    return e?.dateEmargement ? new Date(e.dateEmargement).toLocaleString("fr-FR") : "";
  }

  for (const group of data.etablissements) {
    const etabRow = sheet.addRow([
      `${group.etablissement} (le CCM : ${(group.scrutin1.taux * 100).toFixed(1)} % — la CCM : ${(group.scrutin2.taux * 100).toFixed(1)} %)`,
    ]);
    etabRow.font = { name: "Arial", bold: true };
    etabRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };

    for (const r of group.rows) {
      const detailRow = sheet.addRow([
        "",
        r.nom,
        r.prenom,
        statutLabel(r.scrutin1),
        emargementLabel(r.scrutin1),
        statutLabel(r.scrutin2),
        emargementLabel(r.scrutin2),
        r.isAdherent ? "Adhérent" : "Non adhérent",
      ]);
      detailRow.outlineLevel = 1;
      detailRow.font = { name: "Arial" };
    }
  }

  return wb;
}
