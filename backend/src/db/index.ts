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

    -- Réglages globaux (admin général) : mail/mobile de test utilisés
    -- partout où le mode test est actif (campagnes Spelc et relances PSA).
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- Modèles de relance pour les PSA (nationaux, non rattachés à un Spelc).
    CREATE TABLE IF NOT EXISTS psa_email_template (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      subject TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS psa_sms_template (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      body TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Réglages propres à un Spelc pour ses campagnes de relance : logo
    -- (image encodée en base64, insérée en entête des mails), réseaux
    -- sociaux (JSON) insérés en pied de mail, et mail/mobile de test propres
    -- à ce Spelc (indépendants du mail/mobile de test global de l'admin
    -- général, utilisé lui pour les relances PSA).
    CREATE TABLE IF NOT EXISTS spelc_settings (
      spelc TEXT PRIMARY KEY,
      logo_data_uri TEXT,
      social_links TEXT,
      test_email TEXT,
      test_mobile TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Configuration du scraping Playwright des portails de gestion CCMMEP
    -- (academie = '' pour le national) / académiques. Mot de passe chiffré
    -- au repos (voir lib/crypto.ts), jamais stocké ni renvoyé en clair.
    CREATE TABLE IF NOT EXISTS scraping_config (
      academie TEXT PRIMARY KEY,
      portal_url TEXT NOT NULL,
      username TEXT NOT NULL,
      password_encrypted TEXT NOT NULL,
      file_url_1 TEXT NOT NULL,
      file_url_2 TEXT,
      username_selector TEXT,
      password_selector TEXT,
      submit_selector TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Suivi par personne d'un envoi de relance (mail ou SMS) : une ligne par
    -- destinataire, mise à jour au fil du temps par le sondage périodique de
    -- l'API Brevo (le statut de livraison final et les clics n'arrivent
    -- jamais au moment de l'envoi lui-même, seulement l'acceptation initiale
    -- par Brevo). owner_user_id identifie le compte (donc la clé API Brevo)
    -- à utiliser pour interroger le statut de cette ligne plus tard.
    CREATE TABLE IF NOT EXISTS relance_tracking (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      owner_user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL CHECK (type IN ('mail','sms')),
      scope TEXT NOT NULL,
      campagne_tag TEXT NOT NULL,
      nom TEXT NOT NULL,
      prenom TEXT NOT NULL,
      contact TEXT NOT NULL,
      test_mode INTEGER NOT NULL DEFAULT 0,
      send_ok INTEGER NOT NULL,
      message_id TEXT,
      delivery_status TEXT,
      clicked INTEGER NOT NULL DEFAULT 0,
      clicked_at TEXT,
      last_checked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_relance_tracking_scope ON relance_tracking(scope, created_at);
    CREATE INDEX IF NOT EXISTS idx_relance_tracking_pending ON relance_tracking(owner_user_id, message_id);
  `);

  addColumnIfMissing("users", "nom", "TEXT");
  addColumnIfMissing("users", "prenom", "TEXT");
  addColumnIfMissing("users", "must_change_password", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("relance_tracking", "error_message", "TEXT");
  addColumnIfMissing("relance_tracking", "opened", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("relance_tracking", "opened_at", "TEXT");
  addColumnIfMissing("spelc_settings", "sms_sender", "TEXT");
  addColumnIfMissing("scraping_config", "schedule_times", "TEXT");
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
