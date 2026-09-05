import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "../../data");
const logPath = process.env.RELANCE_LOG_PATH ?? path.join(dataDir, "relances.log");

export interface RelanceLogEntry {
  timestamp: string;
  type: "mail" | "sms";
  provider: string;
  /** Nom du Spelc concerné, ou "PSA" pour une relance PSA. */
  scope: string;
  campagneTag: string;
  nom: string;
  prenom: string;
  /** Adresse mail ou numéro de mobile réellement utilisé pour l'envoi. */
  contact: string;
  testMode: boolean;
  success: boolean;
}

/** Journal des relances au format NDJSON (une ligne JSON par envoi individuel). */
export function appendRelanceLog(entry: RelanceLogEntry): void {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
}

export function readRelanceLog(limit = 500): RelanceLogEntry[] {
  if (!fs.existsSync(logPath)) return [];
  const lines = fs.readFileSync(logPath, "utf-8").split("\n").filter((l) => l.trim().length > 0);
  return lines
    .slice(-limit)
    .map((line) => JSON.parse(line) as RelanceLogEntry)
    .reverse();
}
