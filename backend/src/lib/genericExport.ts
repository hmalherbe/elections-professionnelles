import ExcelJS from "exceljs";

/**
 * Construit un classeur Excel à partir d'une grille déjà prête (en-têtes +
 * lignes), sans connaissance du domaine métier — utilisé par la route
 * générique /stats/table-export pour les tableaux calculés côté frontend à
 * partir de données statiques (ex. résultats CCM 2022, onglet "Résultats
 * 2022"), qui n'existent nulle part côté backend et ne justifient donc pas
 * une route d'export dédiée.
 */
export function buildGenericTableWorkbook(
  sheetName: string,
  headers: string[],
  rows: (string | number | null)[][]
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(sheetName.slice(0, 31) || "Feuille 1", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  const headerRow = sheet.addRow(headers);
  headerRow.font = { name: "Arial", bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
  });

  sheet.columns = headers.map((h, i) => ({
    width: Math.max(h.length + 2, 12, ...rows.map((r) => String(r[i] ?? "").length + 2)),
  }));

  for (const row of rows) {
    const r = sheet.addRow(row);
    r.font = { name: "Arial" };
    r.eachCell((cell) => {
      if (typeof cell.value === "number") cell.alignment = { horizontal: "right" };
    });
  }

  return wb;
}
