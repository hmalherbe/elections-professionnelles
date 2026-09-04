import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "../../data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DATABASE_PATH ?? path.join(dataDir, "elections.sqlite");
export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin_general','admin_academique','admin_spelc')),
      academie TEXT,
      spelc TEXT,
      brevo_api_key TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ref_departements (
      departement TEXT PRIMARY KEY,
      spelc TEXT NOT NULL,
      academie TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ref_spelc (
      spelc TEXT PRIMARY KEY,
      accord TEXT NOT NULL,
      academie TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ref_academie_scrutins (
      academie TEXT PRIMARY KEY,
      type_1d TEXT NOT NULL,
      type_2d TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS psa (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type_scrutin TEXT,
      nom TEXT NOT NULL,
      prenom TEXT NOT NULL,
      email TEXT,
      mobile TEXT
    );

    CREATE TABLE IF NOT EXISTS imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL CHECK (scope IN ('national','academique')),
      academie TEXT,
      degre TEXT CHECK (degre IN ('1D','2D')),
      filename TEXT,
      imported_by INTEGER REFERENCES users(id),
      imported_at TEXT NOT NULL DEFAULT (datetime('now')),
      snapshot_date TEXT NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0,
      is_simulation INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS emargements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_id INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
      scope TEXT NOT NULL CHECK (scope IN ('national','academique')),
      academie TEXT,
      degre TEXT CHECK (degre IN ('1D','2D','INDETERMINE')),
      scrutin_type TEXT,
      nom TEXT NOT NULL,
      prenom TEXT NOT NULL,
      nom_norm TEXT NOT NULL,
      prenom_norm TEXT NOT NULL,
      date_emargement TEXT,
      corps TEXT,
      affectation TEXT,
      departement TEXT,
      spelc TEXT,
      reference_bulletin TEXT,
      votant INTEGER NOT NULL,
      snapshot_date TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_emargements_import ON emargements(import_id);
    CREATE INDEX IF NOT EXISTS idx_emargements_scope ON emargements(scope, academie, degre, snapshot_date);
    CREATE INDEX IF NOT EXISTS idx_emargements_spelc ON emargements(spelc, snapshot_date);
    CREATE INDEX IF NOT EXISTS idx_emargements_name ON emargements(nom_norm, prenom_norm);

    CREATE TABLE IF NOT EXISTS adherents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spelc TEXT NOT NULL,
      nom TEXT NOT NULL,
      prenom TEXT NOT NULL,
      nom_norm TEXT NOT NULL,
      prenom_norm TEXT NOT NULL,
      mail TEXT,
      mobile TEXT,
      uploaded_by INTEGER REFERENCES users(id),
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_adherents_spelc ON adherents(spelc);
    CREATE INDEX IF NOT EXISTS idx_adherents_name ON adherents(nom_norm, prenom_norm);

    CREATE TABLE IF NOT EXISTS email_templates (
      spelc TEXT PRIMARY KEY,
      subject TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sms_templates (
      spelc TEXT PRIMARY KEY,
      body TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS relances_mail (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spelc TEXT NOT NULL,
      date TEXT NOT NULL,
      campagne_tag TEXT NOT NULL,
      total_envoye INTEGER NOT NULL DEFAULT 0,
      erreurs_envoi INTEGER NOT NULL DEFAULT 0,
      mails_lus INTEGER NOT NULL DEFAULT 0,
      liens_clique INTEGER NOT NULL DEFAULT 0,
      is_test INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS psa_simulation_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_at TEXT NOT NULL DEFAULT (datetime('now')),
      description TEXT,
      run_by INTEGER REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS psa_emargements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES psa_simulation_runs(id) ON DELETE CASCADE,
      psa_id INTEGER NOT NULL REFERENCES psa(id) ON DELETE CASCADE,
      scrutin TEXT NOT NULL CHECK (scrutin IN ('CCMMEP','LOCAL')),
      scrutin_type TEXT,
      date_emargement TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_psa_emargements_run ON psa_emargements(run_id);

    CREATE TABLE IF NOT EXISTS relances_sms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spelc TEXT NOT NULL,
      date TEXT NOT NULL,
      campagne_tag TEXT NOT NULL,
      sms_envoyes INTEGER NOT NULL DEFAULT 0,
      erreurs_envoi INTEGER NOT NULL DEFAULT 0,
      sms_delivres INTEGER NOT NULL DEFAULT 0,
      sms_rejetes INTEGER NOT NULL DEFAULT 0,
      statut_global TEXT NOT NULL DEFAULT '',
      is_test INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  addColumnIfMissing("relances_mail", "is_test", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("relances_sms", "is_test", "INTEGER NOT NULL DEFAULT 0");
}

/**
 * CREATE TABLE IF NOT EXISTS ne modifie jamais une table déjà créée par une
 * version antérieure : les nouvelles colonnes ajoutées après coup doivent
 * être migrées explicitement, de façon idempotente, pour les bases déjà
 * déployées.
 */
function addColumnIfMissing(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
