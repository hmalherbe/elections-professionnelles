import ExcelJS from "exceljs";

export async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return wb;
}

function normalizeCellValue(value: ExcelJS.CellValue): unknown {
  if (value && typeof value === "object") {
    if ("result" in value) return (value as { result: unknown }).result;
    if ("text" in value) return (value as { text: unknown }).text;
    if ("richText" in value) {
      return (value as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
    }
  }
  return value;
}

/**
 * Convertit une feuille en tableau d'objets clé/valeur, la première ligne
 * étant traitée comme l'en-tête. L'ordre des clés reflète l'ordre des
 * colonnes, ce qui permet un accès positionnel via Object.values().
 */
export function rowsAsObjects(sheet: ExcelJS.Worksheet): Record<string, unknown>[] {
  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber] = String(cell.value ?? "").trim();
  });

  const rows: Record<string, unknown>[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: Record<string, unknown> = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = headers[colNumber] || `col${colNumber}`;
      obj[key] = normalizeCellValue(cell.value);
    });
    if (Object.values(obj).some((v) => v !== null && v !== undefined && v !== "")) {
      rows.push(obj);
    }
  });
  return rows;
}
