import ExcelJS from "exceljs";
import type { ScrutinDetailResult } from "../services/stats.js";

/**
 * Classeur Excel du détail par établissement de l'onglet "Scrutin" (bouton
 * "Export Excel") : une ligne de synthèse globale, puis une ligne d'en-tête
 * par établissement (niveau 0) suivie d'une ligne par électeur (niveau 1,
 * repliable via le plan Excel natif — "+"/"-" dans la marge), même
 * hiérarchie établissement -> électeur que le tableau de l'application.
 */
export function buildScrutinDetailWorkbook(data: ScrutinDetailResult): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();

  const syntheseSheet = wb.addWorksheet("Synthèse");
  syntheseSheet.columns = [{ width: 32 }, { width: 16 }];
  const syntheseRows: [string, string | number][] = [
    ["Inscrits", data.global.inscrits],
    ["Votants", data.global.votants],
    ["Taux de participation", data.global.taux],
    ["Adhérents inscrits", data.global.adherentsInscrits],
    ["Adhérents votants", data.global.adherentsVotants],
    ["Taux de participation (adhérents)", data.global.adherentsTaux],
  ];
  for (const [label, value] of syntheseRows) {
    const row = syntheseSheet.addRow([label, value]);
    row.font = { name: "Arial" };
    row.getCell(1).font = { name: "Arial", bold: true };
    if (label.startsWith("Taux")) row.getCell(2).numFmt = "0.0%";
  }

  const sheet = wb.addWorksheet("Détail par établissement", {
    properties: { outlineLevelRow: 1, outlineProperties: { summaryBelow: false, summaryRight: false } },
    views: [{ state: "frozen", ySplit: 1 }],
  });

  const headers = ["Établissement", "Nom", "Prénom", "Statut", "Adhérent", "Émargement"];
  const headerRow = sheet.addRow(headers);
  headerRow.font = { name: "Arial", bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
  });
  sheet.columns = [{ width: 42 }, { width: 22 }, { width: 18 }, { width: 14 }, { width: 12 }, { width: 20 }];

  for (const group of data.etablissements) {
    const etabRow = sheet.addRow([
      `${group.etablissement} (${group.inscrits} inscrit(s), ${(group.taux * 100).toFixed(1)} % de participation)`,
    ]);
    etabRow.font = { name: "Arial", bold: true };
    etabRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };

    for (const r of group.rows) {
      const detailRow = sheet.addRow([
        "",
        r.nom,
        r.prenom,
        r.votant ? "Votant" : "Non votant",
        r.isAdherent ? "Adhérent" : "Non adhérent",
        r.dateEmargement ? new Date(r.dateEmargement).toLocaleString("fr-FR") : "",
      ]);
      detailRow.outlineLevel = 1;
      detailRow.font = { name: "Arial" };
    }
  }

  return wb;
}
