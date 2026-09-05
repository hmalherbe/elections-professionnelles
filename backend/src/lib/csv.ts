/**
 * Parseur CSV minimal, sans dépendance externe. Gère les champs entre
 * guillemets (avec guillemets doublés pour échapper), la virgule ou le
 * point-virgule comme séparateur (auto-détecté sur la ligne d'en-tête), et
 * les fins de ligne CRLF/LF. Ne gère pas les champs multi-lignes, ce qui
 * est acceptable pour de courtes valeurs (nom, prénom, email...).
 */
export function parseCsvBuffer(buffer: Buffer): Record<string, string>[] {
  const text = buffer.toString("utf-8").replace(/^﻿/, "");
  const lines = text.split(/\r\n|\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const delimiter = lines[0].includes(";") && !lines[0].includes(",") ? ";" : ",";

  function parseLine(line: string): string[] {
    const fields: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          cur += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === delimiter) {
        fields.push(cur.trim());
        cur = "";
      } else {
        cur += c;
      }
    }
    fields.push(cur.trim());
    return fields;
  }

  const headers = parseLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseLine(line);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = values[i] ?? "";
    });
    return obj;
  });
}
