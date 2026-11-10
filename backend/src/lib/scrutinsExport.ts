import ExcelJS from "exceljs";
import type { AcademieNode, EtablissementRow, ScrutinsByEtablissementResult } from "../services/stats.js";

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

  const headers = [
    "Établissement",
    "Nom",
    "Prénom",
    "Scrutin",
    "Statut",
    ...(showAdherentColumn ? ["Adhérent", "Mail (adhérent)", "Mobile (adhérent)"] : []),
    "Émargement",
  ];
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
    ...(showAdherentColumn ? [{ width: 12 }, { width: 28 }, { width: 16 }] : []),
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
        adherentMail?: string | null;
        adherentMobile?: string | null;
      };
      const values = [
        "",
        row.nom,
        row.prenom,
        row.scrutinType ?? "Non défini",
        row.votant ? "Votant" : "Non votant",
        ...(showAdherentColumn
          ? [row.isAdherent ? "Adhérent" : "Non adhérent", row.adherentMail ?? "", row.adherentMobile ?? ""]
          : []),
        row.dateEmargement ? new Date(row.dateEmargement).toLocaleString("fr-FR") : "",
      ];
      const detailRow = sheet.addRow(values);
      detailRow.outlineLevel = 1;
      detailRow.font = { name: "Arial" };
    }
  }

  return wb;
}

/**
 * Classeur Excel du tableau "Participation par établissement" (bouton
 * "Export Excel" de cet onglet) : une ligne par établissement, participation
 * globale et participation des seuls adhérents (voir
 * services/stats.ts#participationParEtablissement).
 */
export function buildEtablissementsWorkbook(rows: EtablissementRow[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Participation par établissement", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  const headers = [
    "Établissement",
    "Inscrits",
    "Votants",
    "Taux de participation",
    "Adhérents inscrits",
    "Adhérents votants",
    "Taux de participation (adhérents)",
  ];
  const headerRow = sheet.addRow(headers);
  headerRow.font = { name: "Arial", bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
  });
  sheet.columns = [{ width: 42 }, { width: 12 }, { width: 12 }, { width: 20 }, { width: 18 }, { width: 18 }, { width: 28 }];

  for (const r of rows) {
    const row = sheet.addRow([r.affectation, r.inscrits, r.votants, r.taux, r.adherentsInscrits, r.adherentsVotants, r.adherentsTaux]);
    row.font = { name: "Arial" };
    row.getCell(4).numFmt = "0.0%";
    row.getCell(7).numFmt = "0.0%";
  }

  return wb;
}

/**
 * Classeur Excel du TCD "Participation par académie" de la Vue nationale
 * (bouton "Export Excel" de cet onglet) : une ligne par académie (niveau
 * 0, en gras), puis une ligne par Spelc de cette académie (niveau 1,
 * repliable via le plan Excel natif — "+"/"-" dans la marge), conservant
 * la même hiérarchie académie -> Spelc que le tableau de l'application
 * (voir services/stats.ts#participationTreeNational).
 */
export function buildParticipationTreeWorkbook(tree: AcademieNode[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Participation par académie", {
    properties: { outlineLevelRow: 1, outlineProperties: { summaryBelow: false, summaryRight: false } },
    views: [{ state: "frozen", ySplit: 1 }],
  });

  const headers = [
    "Académie / Spelc",
    "Inscrits",
    "Votants",
    "Taux de participation",
    "Taux CCMI (1er degré)",
    "Taux CCMA (2nd degré)",
    "Taux adhérents CCMI",
    "Taux adhérents CCMA",
  ];
  const headerRow = sheet.addRow(headers);
  headerRow.font = { name: "Arial", bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
  });
  sheet.columns = [
    { width: 30 },
    { width: 12 },
    { width: 12 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
  ];

  const percentCols = [4, 5, 6, 7, 8];
  const addDataRow = (
    label: string,
    row: Pick<
      AcademieNode,
      | "inscrits"
      | "votants"
      | "taux"
      | "tauxCcmi"
      | "tauxCcma"
      | "adherentsTauxCcmi"
      | "adherentsTauxCcma"
    >,
    outlineLevel: 0 | 1,
    bold: boolean
  ) => {
    const sheetRow = sheet.addRow([
      label,
      row.inscrits,
      row.votants,
      row.taux,
      row.tauxCcmi,
      row.tauxCcma,
      row.adherentsTauxCcmi,
      row.adherentsTauxCcma,
    ]);
    sheetRow.font = { name: "Arial", bold };
    sheetRow.outlineLevel = outlineLevel;
    for (const col of percentCols) sheetRow.getCell(col).numFmt = "0.0%";
  };

  for (const academie of tree) {
    addDataRow(academie.label, academie, 0, true);
    for (const spelc of academie.spelcs) {
      addDataRow(`    ${spelc.label}`, spelc, 1, false);
    }
  }

  return wb;
}
