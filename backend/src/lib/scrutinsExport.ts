import ExcelJS from "exceljs";
import type { ScrutinsByEtablissementResult } from "../services/stats.js";

/**
 * Construit le classeur Excel du détail par établissement (bouton "Export
 * Excel" à côté des filtres de l'onglet Scrutins) : une ligne d'en-tête par
 * établissement (niveau 0), puis une ligne par électeur (niveau 1,
 * regroupée/repliable via le plan Excel natif — "+"/"-" dans la marge),
 * reflétant la hiérarchie établissement -> électeur déjà utilisée dans le
 * tableau "Détail par établissement" de l'application.
 */
export function buildScrutinsByEtablissementWorkbook(
  data: ScrutinsByEtablissementResult,
  showAdherentColumn: boolean
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Détail par établissement", {
    properties: { outlineLevelRow: 1, outlineProperties: { summaryBelow: false, summaryRight: false } },
    views: [{ state: "frozen", ySplit: 1 }],
  });

  const headers = ["Établissement", "Nom", "Prénom", "Scrutin", "Statut", ...(showAdherentColumn ? ["Adhérent"] : []), "Émargement"];
  const headerRow = sheet.addRow(headers);
  headerRow.font = { name: "Arial", bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
  });

  sheet.columns = [
    { width: 42 },
    { width: 22 },
    { width: 18 },
    { width: 16 },
    { width: 14 },
    ...(showAdherentColumn ? [{ width: 12 }] : []),
    { width: 20 },
  ];

  for (const group of data.etablissements) {
    const etabRow = sheet.addRow([`${group.etablissement} (${group.rows.length})`]);
    etabRow.font = { name: "Arial", bold: true };
    etabRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };

    for (const r of group.rows) {
      const row = r as Record<string, unknown> & {
        nom: string;
        prenom: string;
        scrutinType: string | null;
        votant: number;
        dateEmargement: string | null;
        isAdherent?: number;
      };
      const values = [
        "",
        row.nom,
        row.prenom,
        row.scrutinType ?? "Non défini",
        row.votant ? "Votant" : "Non votant",
        ...(showAdherentColumn ? [row.isAdherent ? "Adhérent" : "Non adhérent"] : []),
        row.dateEmargement ? new Date(row.dateEmargement).toLocaleString("fr-FR") : "",
      ];
      const detailRow = sheet.addRow(values);
      detailRow.outlineLevel = 1;
      detailRow.font = { name: "Arial" };
    }
  }

  return wb;
}
