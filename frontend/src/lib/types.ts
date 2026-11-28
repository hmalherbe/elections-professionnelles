export type Role = "admin_general" | "admin_academique" | "admin_spelc";

export interface AuthUser {
  id: number;
  email: string;
  role: Role;
  academie: string | null;
  spelc: string | null;
  mustChangePassword: boolean;
}

export interface ParticipationRow {
  label: string;
  inscrits: number;
  votants: number;
  taux: number;
  inscritsCcmi: number;
  votantsCcmi: number;
  tauxCcmi: number;
  inscritsCcma: number;
  votantsCcma: number;
  tauxCcma: number;
  adherentsInscritsCcmi: number;
  adherentsVotantsCcmi: number;
  adherentsTauxCcmi: number;
  adherentsInscritsCcma: number;
  adherentsVotantsCcma: number;
  adherentsTauxCcma: number;
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
  etablissementOptions: string[];
  scrutinTypeOptions: string[];
}

export interface ScrutinsByEtablissementGroup {
  etablissement: string;
  rows: ScrutinsRow[];
}

export interface ScrutinsByEtablissementResult {
  groups: { scrutinType: string; total: number; votants: number }[];
  etablissementOptions: string[];
  scrutinTypeOptions: string[];
  etablissements: ScrutinsByEtablissementGroup[];
  totalRows: number;
}

export interface EtablissementRow {
  affectation: string;
  inscrits: number;
  votants: number;
  taux: number;
  adherentsInscrits: number;
  adherentsVotants: number;
  adherentsTaux: number;
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
  votants: number | null;
}

export interface AcademieScrutin {
  academie: string;
  type1d: string;
  type2d: string;
}

export interface RelanceDailyPoint {
  date: string;
  spelc: string;
  mailEnvoyes: number;
  smsEnvoyes: number;
}

export interface DesinscriptionSpelcRow {
  spelc: string;
  mail: number;
  sms: number;
  total: number;
}

export interface CreditsSmsRow {
  spelc: string;
  reels: number;
  estimes: number;
  ecartPct: number | null;
}

export interface SpelcQuotaRow {
  spelc: string;
  quota: number;
  used: number;
  remaining: number;
  pctUsed: number;
  reached: boolean;
}

export interface EfficaciteRelanceRow {
  spelc: string;
  derniereCampagneDate: string;
  tauxAvant: number | null;
  tauxApres: number | null;
  progressionPoints: number | null;
  relances: number;
}

export interface SpelcSansEnvoiRow {
  spelc: string;
  nonVotants: number;
}

export interface QualiteRapprochementRow {
  spelc: string;
  totalAdherents: number;
  jamaisRetrouves: number;
  pctJamaisRetrouves: number;
}

export interface AdherentsImportStatusRow {
  spelc: string;
  nbAdherents: number;
  derniereMaj: string | null;
}

export interface AdminStatsAvancees {
  desinscriptions: { rows: DesinscriptionSpelcRow[]; nonAttribuees: number };
  creditsSms: CreditsSmsRow[];
  plafondsSms: SpelcQuotaRow[];
  efficaciteRelances: EfficaciteRelanceRow[];
  spelcsSansEnvoi: SpelcSansEnvoiRow[];
  qualiteRapprochement: QualiteRapprochementRow[];
}

export interface ManagedUser {
  id: number;
  email: string;
  role: Role;
  academie: string | null;
  spelc: string | null;
  nom: string | null;
  prenom: string | null;
  must_change_password: number;
  created_at: string;
}
