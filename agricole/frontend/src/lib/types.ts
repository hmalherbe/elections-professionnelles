export interface AuthUser {
  id: number;
  email: string;
  nom: string | null;
  prenom: string | null;
  mustChangePassword: boolean;
}

export interface CourbePoint {
  date: string;
  inscrits: number;
  votants: number;
  taux: number;
}

export interface EtablissementRow {
  etablissement: string;
  inscrits: number;
  votants: number;
  taux: number;
}

export interface ImportRecord {
  id: number;
  scrutin: "scrutin1" | "scrutin2";
  filename: string | null;
  imported_at: string;
  snapshot_date: string;
  row_count: number;
}

export interface ManagedUser {
  id: number;
  email: string;
  nom: string | null;
  prenom: string | null;
  must_change_password: number;
  created_at: string;
}

export interface Adherent {
  id: number;
  nom: string;
  prenom: string;
  mail: string | null;
  etablissement: string | null;
}

export interface RelanceTrackingRow {
  id: number;
  created_at: string;
  campagne_tag: string;
  nom: string;
  prenom: string;
  contact: string;
  test_mode: number;
  send_ok: number;
  error_message: string | null;
  clicked: number;
  statusLabel: "ok" | "echec" | "en_attente";
}

export interface MailSeriesPoint {
  date: string;
  total_envoye: number;
  erreurs_envoi: number;
  mails_lus: number;
  liens_clique: number;
}

export interface BrevoPlanEntry {
  type: string;
  credits: number;
  creditsType: string;
}
