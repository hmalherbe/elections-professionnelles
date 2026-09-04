import dayjs from "dayjs";
import { db } from "../db/index.js";

const ELECTION_START = "2026-12-03";
const ELECTION_END = "2026-12-10";
const VOTE_PROBABILITY = 0.85;

function randomEmargementDate(): string {
  const startDay = dayjs(ELECTION_START);
  const totalDays = dayjs(ELECTION_END).diff(startDay, "day") + 1;
  const dayOffset = Math.floor(Math.random() * totalDays);
  const hour = 7 + Math.floor(Math.random() * 15); // 07h-21h
  const minute = Math.floor(Math.random() * 60);
  const second = Math.floor(Math.random() * 60);
  return startDay.add(dayOffset, "day").hour(hour).minute(minute).second(second).toISOString();
}

export interface PsaRow {
  id: number;
  type_scrutin: string | null;
  nom: string;
  prenom: string;
}

export function runPsaSimulation(runBy: number, description?: string): { runId: number; count: number } {
  const psaRows = db.prepare("SELECT id, type_scrutin, nom, prenom FROM psa").all() as PsaRow[];

  const insertRun = db.prepare(
    "INSERT INTO psa_simulation_runs (description, run_by) VALUES (?, ?)"
  );
  const insertEmargement = db.prepare(
    `INSERT INTO psa_emargements (run_id, psa_id, scrutin, scrutin_type, date_emargement) VALUES (?, ?, ?, ?, ?)`
  );

  let count = 0;
  const runId = db.transaction(() => {
    const id = insertRun.run(description ?? "Journée de simulation PSA", runBy).lastInsertRowid as number;
    for (const psa of psaRows) {
      const votedNational = Math.random() < VOTE_PROBABILITY;
      insertEmargement.run(id, psa.id, "CCMMEP", "CCMMEP", votedNational ? randomEmargementDate() : null);
      count++;

      const votedLocal = Math.random() < VOTE_PROBABILITY;
      insertEmargement.run(id, psa.id, "LOCAL", psa.type_scrutin, votedLocal ? randomEmargementDate() : null);
      count++;
    }
    return id;
  })();

  return { runId, count };
}
