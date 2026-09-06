import { db } from "../db/index.js";
import { decrypt } from "../lib/crypto.js";
import { scrapePortalFiles } from "./scraper.js";
import { runImport, defaultSnapshotDate, findCrossDegreDuplicates, type ImportResult } from "./imports.js";

export interface ScrapingConfigRow {
  academie: string;
  portal_url: string;
  username: string;
  password_encrypted: string;
  file_url_1: string;
  file_url_2: string | null;
  username_selector: string | null;
  password_selector: string | null;
  submit_selector: string | null;
  schedule_times: string | null;
  updated_at: string;
}

export function getScrapingConfig(academie: string): ScrapingConfigRow | undefined {
  return db.prepare("SELECT * FROM scraping_config WHERE academie = ?").get(academie) as ScrapingConfigRow | undefined;
}

export function listScrapingConfigs(): ScrapingConfigRow[] {
  return db.prepare("SELECT * FROM scraping_config").all() as ScrapingConfigRow[];
}

const MAX_SCHEDULE_TIMES = 3;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidScheduleTimes(times: unknown): times is string[] {
  return (
    Array.isArray(times) &&
    times.length <= MAX_SCHEDULE_TIMES &&
    times.every((t) => typeof t === "string" && TIME_RE.test(t))
  );
}

export function parseScheduleTimes(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return isValidScheduleTimes(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Lance le scraping puis l'import pour une académie ('' = national CCMMEP) —
 * logique partagée entre le déclenchement manuel (routes/scraping.ts) et le
 * planificateur automatique (services/scrapingScheduler.ts).
 */
export interface ScrapingRunResult {
  [key: string]: ImportResult | { nom: string; prenom: string }[] | undefined;
  crossDegreDuplicates?: { nom: string; prenom: string }[];
}

export async function runScrapingAndImport(academie: string, importedBy: number | null): Promise<ScrapingRunResult> {
  const row = getScrapingConfig(academie);
  if (!row) throw new Error("Aucune configuration de scraping enregistrée pour ce périmètre.");
  if (academie !== "" && !row.file_url_2) {
    throw new Error("Une deuxième URL (2nd degré) est requise pour un scraping académique.");
  }

  const { file1, file2 } = await scrapePortalFiles({
    portalUrl: row.portal_url,
    username: row.username,
    password: decrypt(row.password_encrypted),
    fileUrl1: row.file_url_1,
    fileUrl2: row.file_url_2,
    usernameSelector: row.username_selector,
    passwordSelector: row.password_selector,
    submitSelector: row.submit_selector,
  });

  const snapshotDate = defaultSnapshotDate();
  if (academie === "") {
    const result = runImport(JSON.parse(file1), {
      scope: "national",
      academie: null,
      degre: null,
      filename: "scraping-ccmmep.json",
      importedBy,
      snapshotDate,
    });
    return { national: result };
  }
  const result1D = runImport(JSON.parse(file1), {
    scope: "academique",
    academie,
    degre: "1D",
    filename: "scraping-1d.json",
    importedBy,
    snapshotDate,
  });
  const result2D = runImport(JSON.parse(file2!), {
    scope: "academique",
    academie,
    degre: "2D",
    filename: "scraping-2d.json",
    importedBy,
    snapshotDate,
  });
  const duplicates = findCrossDegreDuplicates(academie);
  return {
    degre1D: result1D,
    degre2D: result2D,
    ...(duplicates.length > 0 ? { crossDegreDuplicates: duplicates } : {}),
  };
}
