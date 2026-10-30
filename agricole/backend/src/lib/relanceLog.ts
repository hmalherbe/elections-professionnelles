import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "../../data");
const logPath = process.env.RELANCE_LOG_PATH ?? path.join(dataDir, "relances.log");

export interface RelanceLogEntry {
  timestamp: string;
  campagneTag: string;
  nom: string;
  prenom: string;
  contact: string;
  testMode: boolean;
  success: boolean;
}

/** Journal des relances au format NDJSON (une ligne JSON par envoi individuel). */
export function appendRelanceLog(entry: RelanceLogEntry): void {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
}
