import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "../../data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DATABASE_PATH ?? path.join(dataDir, "agricole.sqlite");
export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      nom TEXT,
      prenom TEXT,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);

    -- Un import par scrutin par jour (fichier JSON des émargements, déposé
    -- manuellement comme l'était le fichier national CCMMEP de l'application
    -- éducation nationale avant l'ajout, puis le retrait, d'un scraping
    -- automatisé — on part ici directement sur le dépôt manuel).
    CREATE TABLE IF NOT EXISTS imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scrutin TEXT NOT NULL CHECK (scrutin IN ('scrutin1','scrutin2')),
      filename TEXT,
      imported_by INTEGER REFERENCES users(id),
      imported_at TEXT NOT NULL DEFAULT (datetime('now')),
      snapshot_date TEXT NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS emargements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_id INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
      scrutin TEXT NOT NULL CHECK (scrutin IN ('scrutin1','scrutin2')),
      nom TEXT NOT NULL,
      prenom TEXT NOT NULL,
      nom_norm TEXT NOT NULL,
      prenom_norm TEXT NOT NULL,
      date_emargement TEXT,
      corps TEXT,
      -- Lycée agricole (champ "affectation" du fichier source) où la
      -- personne enseigne — équivalent de l'établissement scolaire dans
      -- l'application éducation nationale.
      etablissement TEXT,
      reference_bulletin TEXT,
      votant INTEGER NOT NULL,
      snapshot_date TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_emargements_import ON emargements(import_id);
    CREATE INDEX IF NOT EXISTS idx_emargements_scrutin ON emargements(scrutin, snapshot_date);
    CREATE INDEX IF NOT EXISTS idx_emargements_name ON emargements(nom_norm, prenom_norm);

    -- Fichier global des adhérents, importé une seule fois avant le début
    -- des élections (remplacement intégral à chaque import, voir
    -- services/imports.ts) : pas de notion de Spelc local ici.
    CREATE TABLE IF NOT EXISTS adherents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL,
      prenom TEXT NOT NULL,
      nom_norm TEXT NOT NULL,
      prenom_norm TEXT NOT NULL,
      mail TEXT,
      etablissement TEXT,
      uploaded_by INTEGER REFERENCES users(id),
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_adherents_name ON adherents(nom_norm, prenom_norm);

    -- Modèle de mail de relance : un seul, partagé par tous les comptes
    -- administrateurs (pas de notion de Spelc local à ce niveau).
    CREATE TABLE IF NOT EXISTS email_template (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      subject TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Réglages globaux : clé API Brevo (chiffrée), logo/réseaux sociaux des
    -- mails, mail de test.
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- Suivi par personne d'un envoi de mail de relance, mis à jour au fil du
    -- temps par le sondage périodique de l'API Brevo (statut de livraison
    -- final et clics jamais connus au moment de l'envoi lui-même).
    CREATE TABLE IF NOT EXISTS relance_tracking (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      owner_user_id INTEGER NOT NULL REFERENCES users(id),
      campagne_tag TEXT NOT NULL,
      nom TEXT NOT NULL,
      prenom TEXT NOT NULL,
      contact TEXT NOT NULL,
      test_mode INTEGER NOT NULL DEFAULT 0,
      send_ok INTEGER NOT NULL,
      message_id TEXT,
      error_message TEXT,
      delivery_status TEXT,
      clicked INTEGER NOT NULL DEFAULT 0,
      clicked_at TEXT,
      opened INTEGER NOT NULL DEFAULT 0,
      opened_at TEXT,
      last_checked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_relance_tracking_pending ON relance_tracking(owner_user_id, message_id);
  `);
}

/**
 * CREATE TABLE IF NOT EXISTS ne modifie jamais une table déjà créée par une
 * version antérieure : toute nouvelle colonne ajoutée après coup devra être
 * migrée explicitement ici, de façon idempotente, pour les bases déjà
 * déployées (voir le même mécanisme dans l'application éducation nationale).
 */
export function addColumnIfMissing(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
