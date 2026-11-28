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

    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);

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

    -- Plafond de crédits SMS par Spelc, réparti par la fédération au prorata
    -- du nombre d'adhérents à partir du volume total de crédits achetés en
    -- début de campagne (fichier Excel chargé par l'admin général, onglet
    -- Référentiels — voir services/reference.ts loadSmsQuotaWorkbook).
    CREATE TABLE IF NOT EXISTS ref_sms_quota (
      spelc TEXT PRIMARY KEY,
      credits INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Plan de relance SMS par Spelc et par jour du scrutin (Oui/Non), saisi
    -- manuellement par la fédération (fichier Excel chargé par l'admin
    -- général, onglet Référentiels — voir services/reference.ts
    -- loadRelanceSmsPlanWorkbook). Utilisé par la simulation de relances
    -- (/brevo/campaigns/simulate) pour ne compter les SMS d'un Spelc, un
    -- jour donné, que si ce plan prévoit "Oui" ce jour-là. L'absence de
    -- ligne pour un couple Spelc/jour n'est pas restrictive (pas de plan
    -- saisi = pas de restriction).
    CREATE TABLE IF NOT EXISTS ref_relance_sms_plan (
      spelc TEXT NOT NULL,
      jour TEXT NOT NULL,
      planifie INTEGER NOT NULL,
      PRIMARY KEY (spelc, jour)
    );

    -- Taux de participation simulé par jour du scrutin (fichier Excel chargé
    -- par l'admin général, onglet Référentiels — voir services/reference.ts
    -- loadParticipationSimulWorkbook) : "taux de votants parmi les restants
    -- à voter" ce jour-là (taux de hasard, pas cumulatif), utilisé comme
    -- référence pour générer un scénario de test des relances (voir carte
    -- "Simulation taux de participation").
    CREATE TABLE IF NOT EXISTS ref_participation_simul (
      jour TEXT PRIMARY KEY,
      taux REAL NOT NULL
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
    -- scrutinsByEtablissement()/scrutinsTab() filtrent toujours par
    -- "import_id IN (...) AND spelc = ?" pour un admin Spelc : sans index
    -- dédié aux deux colonnes ensemble, le planificateur SQLite peut choisir
    -- de driver la requête par import_id (idx_emargements_import), donc
    -- scanner TOUTES les lignes de l'import académique (tous Spelcs
    -- confondus) avant de filtrer sur spelc, plutôt que de ne lire que les
    -- lignes de ce Spelc directement.
    CREATE INDEX IF NOT EXISTS idx_emargements_spelc_import ON emargements(spelc, import_id);
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

    -- Suggestions de rapprochement approximatif (nom/prénom proches mais pas
    -- identiques) entre un adhérent et une identité rencontrée dans les
    -- émargements, pour les cas non retrouvés par correspondance exacte —
    -- voir services/fuzzyMatching.ts. Validée, une suggestion est traitée
    -- comme un rapprochement exact dans tous les calculs (adhérentExists,
    -- ciblage des relances). Une seule suggestion par couple
    -- (adhérent, identité candidate), quel que soit son statut.
    --
    -- Ancrée sur l'IDENTITÉ de l'adhérent (spelc + nom/prénom normalisés),
    -- PAS sur adherents.id : un réimport du fichier adhérents d'un Spelc
    -- supprime TOUS ses adhérents puis les réinsère avec de nouveaux id
    -- (voir routes/adherents.ts) — un id ne survit jamais à un réimport,
    -- alors que le nom/prénom de la personne, lui, survit tant qu'elle est
    -- toujours présente dans le nouveau fichier. (Avant ce correctif, la
    -- table référençait adherents(id) ON DELETE CASCADE : un réimport
    -- supprimait alors en cascade TOUS les rapprochements déjà validés.)
    CREATE TABLE IF NOT EXISTS adherent_fuzzy_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spelc TEXT NOT NULL,
      adherent_nom TEXT NOT NULL,
      adherent_prenom TEXT NOT NULL,
      adherent_nom_norm TEXT NOT NULL,
      adherent_prenom_norm TEXT NOT NULL,
      adherent_nom_naissance TEXT,
      adherent_nom_naissance_norm TEXT,
      candidate_nom TEXT NOT NULL,
      candidate_prenom TEXT NOT NULL,
      candidate_nom_norm TEXT NOT NULL,
      candidate_prenom_norm TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'en_attente' CHECK (status IN ('en_attente','valide','rejete')),
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- Index créés après migrateFuzzyMatchesToIdentity() ci-dessous, PAS ici :
    -- sur une base déjà déployée avec l'ancien schéma (colonne adherent_id,
    -- pas encore "spelc"), CREATE TABLE IF NOT EXISTS ci-dessus est un no-op
    -- (la table existe déjà), et ces CREATE INDEX échoueraient aussitôt
    -- ("no such column: spelc") avant que la migration n'ait reconstruit la
    -- table.

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

    -- Réglages globaux (admin général) : mail/mobile de test utilisés
    -- partout où le mode test est actif.
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- Réglages propres à un Spelc pour ses campagnes de relance : logo
    -- (image encodée en base64, insérée en entête des mails), réseaux
    -- sociaux (JSON) insérés en pied de mail, et mail/mobile de test propres
    -- à ce Spelc (indépendants du mail/mobile de test global de l'admin
    -- général).
    CREATE TABLE IF NOT EXISTS spelc_settings (
      spelc TEXT PRIMARY KEY,
      logo_data_uri TEXT,
      social_links TEXT,
      test_email TEXT,
      test_mobile TEXT,
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

    -- Désinscription des relances (mail et SMS gérés séparément : une même
    -- personne peut se désinscrire d'un seul canal) — voir lib/unsubscribeToken.ts
    -- (lien signé, sans jeton à stocker à l'avance) et services/optout.ts.
    -- contact = adresse mail en minuscules, ou mobile normalisé (lib/phone.ts).
    CREATE TABLE IF NOT EXISTS relance_optout (
      canal TEXT NOT NULL CHECK (canal IN ('mail','sms')),
      contact TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (canal, contact)
    );

    -- Documents libres (tout type de fichier) déposés par un admin académique
    -- ou un admin Spelc pour son propre périmètre, listés puis téléchargeables
    -- en un clic. Le fichier lui-même vit sur disque (volume persistant, voir
    -- lib/documentStorage.ts) ; ici seulement les métadonnées et le rattachement.
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL CHECK (scope IN ('academique','spelc')),
      academie TEXT,
      spelc TEXT,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT,
      size_bytes INTEGER NOT NULL,
      uploaded_by INTEGER REFERENCES users(id),
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_documents_scope ON documents(scope, academie, spelc);

    -- Dossiers de l'onglet Documents, organisés en arborescence (parent_id) au
    -- sein d'un même périmètre (académie ou Spelc). Un document rattaché à
    -- folder_id = NULL est à la racine. La suppression d'un dossier (et le
    -- nettoyage des fichiers sur disque qu'elle implique) est gérée par
    -- l'application, pas par un ON DELETE CASCADE SQL, pour pouvoir supprimer
    -- les fichiers physiques dans le bon ordre (voir routes/documentFolders.ts).
    CREATE TABLE IF NOT EXISTS document_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL CHECK (scope IN ('academique','spelc')),
      academie TEXT,
      spelc TEXT,
      parent_id INTEGER REFERENCES document_folders(id),
      name TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_document_folders_parent ON document_folders(parent_id);
    CREATE INDEX IF NOT EXISTS idx_document_folders_scope ON document_folders(scope, academie, spelc);
  `);

  addColumnIfMissing("users", "nom", "TEXT");
  addColumnIfMissing("users", "prenom", "TEXT");
  addColumnIfMissing("users", "must_change_password", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("relance_tracking", "error_message", "TEXT");
  addColumnIfMissing("relance_tracking", "opened", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("relance_tracking", "opened_at", "TEXT");
  addColumnIfMissing("spelc_settings", "sms_sender", "TEXT");
  addColumnIfMissing("documents", "extracted_text", "TEXT");
  addColumnIfMissing("documents", "extraction_status", "TEXT");
  addColumnIfMissing("documents", "folder_id", "INTEGER REFERENCES document_folders(id)");
  addColumnIfMissing("adherents", "nom_naissance", "TEXT");
  addColumnIfMissing("adherents", "nom_naissance_norm", "TEXT");
  // Symétrique côté émargements : certains fichiers électeurs distinguent un
  // nom d'usage (colonne "nom" existante) d'un nom de naissance — ex. nom
  // marital différent — nécessaire pour le rapprochement si l'adhérent est
  // déclaré par son Spelc sous l'autre nom (voir services/fuzzyMatching.ts).
  addColumnIfMissing("emargements", "nom_naissance", "TEXT");
  addColumnIfMissing("emargements", "nom_naissance_norm", "TEXT");
  // Nombre de crédits Brevo réellement consommés par CE message (1 pour un
  // mail, variable pour un SMS selon encodage/longueur — voir
  // lib/smsSegments.ts) : le plafond SMS par Spelc (services/smsQuota.ts)
  // sommait auparavant le nombre de SMS envoyés, pas les crédits réels,
  // sous-estimant la consommation dès qu'un message dépassait 1 crédit.
  addColumnIfMissing("relance_tracking", "credits", "INTEGER NOT NULL DEFAULT 1");
  // Crédits ESTIMÉS avant envoi (lib/smsSegments.ts, même calcul que le
  // contrôle de quota), conservés séparément de `credits` (qui mélange
  // valeur réelle Brevo et estimation de repli) — sert à comparer les deux
  // dans l'admin général (services/adminStats.ts), NULL pour un mail (pas de
  // notion de segment) ou pour un SMS envoyé avant l'ajout de cette colonne.
  addColumnIfMissing("relance_tracking", "estimated_credits", "INTEGER");

  migrateScopeIncludesGeneral();
  migrateFuzzyMatchesToIdentity();
  // Après coup (pas dans le bloc CREATE TABLE principal) : à ce stade, la
  // table a forcément le nouveau schéma, qu'elle vienne d'être créée (base
  // neuve) ou reconstruite (base migrée) — voir migrateFuzzyMatchesToIdentity.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_fuzzy_matches_identity ON adherent_fuzzy_matches(spelc, adherent_nom_norm, adherent_prenom_norm);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_fuzzy_matches_unique
      ON adherent_fuzzy_matches(spelc, adherent_nom_norm, adherent_prenom_norm, candidate_nom_norm, candidate_prenom_norm);
    -- adherentExistsClause()/adherentContactSelectFragment() (fuzzyMatching.ts)
    -- filtrent la branche "rapprochement validé" sur candidate_nom_norm/
    -- candidate_prenom_norm (l'identité de l'ÉLECTEUR), pas sur
    -- adherent_nom_norm/adherent_prenom_norm (l'identité de l'adhérent,
    -- déjà couverte par idx_fuzzy_matches_identity ci-dessus) : sans cet
    -- index dédié, cette branche ne profitait que du prefixe spelc.
    CREATE INDEX IF NOT EXISTS idx_fuzzy_matches_candidate ON adherent_fuzzy_matches(spelc, candidate_nom_norm, candidate_prenom_norm);
  `);
  dropPsaTables();
}

/**
 * Retire la fonctionnalité "Journée des PSA" (simulation + relances de test) :
 * supprime les tables dédiées, y compris sur une base déjà déployée où elles
 * ont été créées par une version antérieure. Idempotent (IF EXISTS).
 */
function dropPsaTables(): void {
  db.exec(`
    DROP TABLE IF EXISTS psa_emargements;
    DROP TABLE IF EXISTS psa_simulation_runs;
    DROP TABLE IF EXISTS psa_email_template;
    DROP TABLE IF EXISTS psa_sms_template;
    DROP TABLE IF EXISTS psa;
  `);
}

/**
 * Ajoute 'general' aux valeurs autorisées de la colonne scope de documents et
 * document_folders — l'arborescence commune, déposée une seule fois par
 * l'admin général et visible en lecture seule par toutes les académies, sans
 * copie physique par académie (voir routes/documentFolders.ts et
 * documents.ts). SQLite ne permet pas de modifier une contrainte CHECK via
 * ALTER TABLE : il faut reconstruire la table (procédure recommandée par
 * SQLite — https://www.sqlite.org/lang_altertable.html#otheralter), en
 * conservant exactement les mêmes lignes et identifiants. Idempotent : ne
 * fait rien si la contrainte autorise déjà 'general'.
 */
function migrateScopeIncludesGeneral(): void {
  const documentsSql = (
    db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='documents'`).get() as
      | { sql: string }
      | undefined
  )?.sql;
  if (!documentsSql || documentsSql.includes("'general'")) return; // table absente (impossible ici) ou déjà migrée

  db.pragma("foreign_keys = OFF");
  try {
    const tx = db.transaction(() => {
      db.exec(`
        CREATE TABLE documents_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          scope TEXT NOT NULL CHECK (scope IN ('academique','spelc','general')),
          academie TEXT,
          spelc TEXT,
          filename TEXT NOT NULL,
          original_name TEXT NOT NULL,
          mime_type TEXT,
          size_bytes INTEGER NOT NULL,
          uploaded_by INTEGER REFERENCES users(id),
          uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
          extracted_text TEXT,
          extraction_status TEXT,
          folder_id INTEGER REFERENCES document_folders(id)
        );
        INSERT INTO documents_new (id, scope, academie, spelc, filename, original_name, mime_type, size_bytes, uploaded_by, uploaded_at, extracted_text, extraction_status, folder_id)
          SELECT id, scope, academie, spelc, filename, original_name, mime_type, size_bytes, uploaded_by, uploaded_at, extracted_text, extraction_status, folder_id FROM documents;
        DROP TABLE documents;
        ALTER TABLE documents_new RENAME TO documents;
        CREATE INDEX IF NOT EXISTS idx_documents_scope ON documents(scope, academie, spelc);

        CREATE TABLE document_folders_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          scope TEXT NOT NULL CHECK (scope IN ('academique','spelc','general')),
          academie TEXT,
          spelc TEXT,
          parent_id INTEGER REFERENCES document_folders(id),
          name TEXT NOT NULL,
          created_by INTEGER REFERENCES users(id),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO document_folders_new (id, scope, academie, spelc, parent_id, name, created_by, created_at)
          SELECT id, scope, academie, spelc, parent_id, name, created_by, created_at FROM document_folders;
        DROP TABLE document_folders;
        ALTER TABLE document_folders_new RENAME TO document_folders;
        CREATE INDEX IF NOT EXISTS idx_document_folders_parent ON document_folders(parent_id);
        CREATE INDEX IF NOT EXISTS idx_document_folders_scope ON document_folders(scope, academie, spelc);
      `);
    });
    tx();
    const fkErrors = db.prepare("PRAGMA foreign_key_check").all();
    if (fkErrors.length > 0) {
      throw new Error(`Incohérences de clés étrangères après migration scope='general' : ${JSON.stringify(fkErrors)}`);
    }
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

/**
 * Ancre adherent_fuzzy_matches sur l'identité de l'adhérent (spelc +
 * nom/prénom normalisés) plutôt que sur adherent_id — voir le commentaire
 * de la table dans le CREATE TABLE ci-dessus. ALTER TABLE ne permet ni de
 * retirer une contrainte NOT NULL/FK ni de changer un index UNIQUE : il faut
 * reconstruire la table (procédure recommandée par SQLite), en reprenant les
 * lignes existantes à partir de l'adherent_id encore valide à cet instant.
 * Idempotent (ne fait rien si déjà migrée). Un rapprochement déjà perdu par
 * un réimport antérieur à ce correctif (adherent_id déjà supprimé en
 * cascade) ne peut, lui, pas être récupéré rétroactivement.
 */
function migrateFuzzyMatchesToIdentity(): void {
  const columns = db.prepare(`PRAGMA table_info(adherent_fuzzy_matches)`).all() as { name: string }[];
  if (!columns.some((c) => c.name === "adherent_id")) return; // déjà migrée (ou table toute neuve)

  db.pragma("foreign_keys = OFF");
  try {
    const tx = db.transaction(() => {
      db.exec(`
        CREATE TABLE adherent_fuzzy_matches_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          spelc TEXT NOT NULL,
          adherent_nom TEXT NOT NULL,
          adherent_prenom TEXT NOT NULL,
          adherent_nom_norm TEXT NOT NULL,
          adherent_prenom_norm TEXT NOT NULL,
          adherent_nom_naissance TEXT,
          adherent_nom_naissance_norm TEXT,
          candidate_nom TEXT NOT NULL,
          candidate_prenom TEXT NOT NULL,
          candidate_nom_norm TEXT NOT NULL,
          candidate_prenom_norm TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'en_attente' CHECK (status IN ('en_attente','valide','rejete')),
          reviewed_by INTEGER REFERENCES users(id),
          reviewed_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO adherent_fuzzy_matches_new
          (id, spelc, adherent_nom, adherent_prenom, adherent_nom_norm, adherent_prenom_norm,
           adherent_nom_naissance, adherent_nom_naissance_norm,
           candidate_nom, candidate_prenom, candidate_nom_norm, candidate_prenom_norm,
           status, reviewed_by, reviewed_at, created_at)
        SELECT fm.id, a.spelc, a.nom, a.prenom, a.nom_norm, a.prenom_norm,
               a.nom_naissance, a.nom_naissance_norm,
               fm.candidate_nom, fm.candidate_prenom, fm.candidate_nom_norm, fm.candidate_prenom_norm,
               fm.status, fm.reviewed_by, fm.reviewed_at, fm.created_at
        FROM adherent_fuzzy_matches fm
        INNER JOIN adherents a ON a.id = fm.adherent_id;
        DROP TABLE adherent_fuzzy_matches;
        ALTER TABLE adherent_fuzzy_matches_new RENAME TO adherent_fuzzy_matches;
        CREATE INDEX IF NOT EXISTS idx_fuzzy_matches_identity ON adherent_fuzzy_matches(spelc, adherent_nom_norm, adherent_prenom_norm);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_fuzzy_matches_unique
          ON adherent_fuzzy_matches(spelc, adherent_nom_norm, adherent_prenom_norm, candidate_nom_norm, candidate_prenom_norm);
      `);
    });
    tx();
    const fkErrors = db.prepare("PRAGMA foreign_key_check").all();
    if (fkErrors.length > 0) {
      throw new Error(`Incohérences de clés étrangères après migration adherent_fuzzy_matches : ${JSON.stringify(fkErrors)}`);
    }
  } finally {
    db.pragma("foreign_keys = ON");
  }
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
