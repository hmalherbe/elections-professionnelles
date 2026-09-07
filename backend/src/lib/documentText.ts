import path from "node:path";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import { loadWorkbook } from "./xlsx.js";

const MAX_EXTRACTED_CHARS = 20000;
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".csv", ".json", ".log"]);

export type ExtractionStatus = "ok" | "empty" | "unsupported" | "error";

export interface ExtractionResult {
  text: string | null;
  status: ExtractionStatus;
}

async function extractXlsxText(buffer: Buffer): Promise<string> {
  const wb = await loadWorkbook(buffer);
  const parts: string[] = [];
  wb.eachSheet((sheet) => {
    parts.push(`# ${sheet.name}`);
    sheet.eachRow((row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        cells.push(String(cell.value ?? "").trim());
      });
      parts.push(cells.join("\t"));
    });
  });
  return parts.join("\n");
}

/**
 * Extrait le texte d'un document uploadé, pour le rendre consultable par
 * l'Assistant IA (outil lire_document, voir services/chatTools.ts). Types
 * non pris en charge (images, .doc/.ppt binaires anciens...) : renvoie
 * "unsupported" plutôt que d'échouer — l'upload lui-même n'est jamais
 * bloqué par un échec d'extraction.
 */
export async function extractDocumentText(
  buffer: Buffer,
  originalName: string,
  mimeType: string | null
): Promise<ExtractionResult> {
  const ext = path.extname(originalName).toLowerCase();
  try {
    let text: string | null = null;

    if (ext === ".pdf" || mimeType === "application/pdf") {
      const parser = new PDFParse({ data: buffer });
      try {
        text = (await parser.getText()).text;
      } finally {
        await parser.destroy();
      }
    } else if (ext === ".docx") {
      text = (await mammoth.extractRawText({ buffer })).value;
    } else if (ext === ".xlsx") {
      text = await extractXlsxText(buffer);
    } else if (TEXT_EXTENSIONS.has(ext) || (mimeType?.startsWith("text/") ?? false)) {
      text = buffer.toString("utf-8");
    } else {
      return { text: null, status: "unsupported" };
    }

    if (!text || !text.trim()) {
      return { text: null, status: "empty" };
    }
    return { text: text.slice(0, MAX_EXTRACTED_CHARS), status: "ok" };
  } catch (err) {
    console.error(`Échec de l'extraction de texte pour « ${originalName} » :`, err);
    return { text: null, status: "error" };
  }
}
