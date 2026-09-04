export type Role = "admin_general" | "admin_academique" | "admin_spelc";

export interface AuthUser {
  id: number;
  email: string;
  role: Role;
  academie: string | null;
  spelc: string | null;
}

export interface ParticipationRow {
  label: string;
  inscrits: number;
  votants: number;
  taux: number;
}

export interface AcademieNode extends ParticipationRow {
  spelcs: ParticipationRow[];
}

export interface CourbePoint {
  date: string;
  inscrits: number;
  votants: number;
  taux: number;
}

export interface ScrutinsRow {
  nom: string;
  prenom: string;
  scrutinType: string | null;
  votant: number;
  dateEmargement: string | null;
  affectation: string | null;
  spelc: string | null;
  academie: string | null;
  degre: string | null;
  /** Présent uniquement quand la requête est filtrée sur un Spelc précis. */
  isAdherent?: number;
}

export interface ScrutinsResult {
  groups: { scrutinType: string; total: number; votants: number }[];
  rows: ScrutinsRow[];
  totalRows: number;
}

export interface EtablissementRow {
  affectation: string;
  inscrits: number;
  votants: number;
  taux: number;
}

export interface ImportRecord {
  id: number;
  scope: "national" | "academique";
  academie: string | null;
  degre: string | null;
  filename: string | null;
  imported_at: string;
  snapshot_date: string;
  row_count: number;
}

export interface ManagedUser {
  id: number;
  email: string;
  role: Role;
  academie: string | null;
  spelc: string | null;
  created_at: string;
}
