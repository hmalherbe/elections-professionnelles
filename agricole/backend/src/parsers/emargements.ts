import { parseDateEmargement } from "../lib/dateEmargement.js";
import { normalizeName } from "../lib/normalize.js";
import type { ScrutinCode } from "../lib/scrutins.js";

/**
 * Format repris par hypothèse de celui du fichier CCMMEP (éducation
 * nationale), en l'absence à ce jour d'un exemple réel du fichier agricole
 * — à ajuster dès réception du format effectif. Pas de notion d'académie
 * ici : "affectation" devient directement l'établissement (lycée agricole).
 */
export interface RawEmargementItem {
  nom: string;
  prenom: string;
  dateEmargement: string | null;
  corps: string | null;
  affectation: string | null;
  referenceBulletin?: string | null;
}

export interface RawEmargementFile {
  totalCount?: number;
  items: RawEmargementItem[];
}

export interface EmargementRow {
  scrutin: ScrutinCode;
  nom: string;
  prenom: string;
  nomNorm: string;
  prenomNorm: string;
  dateEmargement: string | null;
  corps: string | null;
  etablissement: string | null;
  referenceBulletin: string | null;
  votant: 0 | 1;
}

export function parseEmargementsJson(raw: unknown): RawEmargementItem[] {
  if (raw && typeof raw === "object" && Array.isArray((raw as RawEmargementFile).items)) {
    return (raw as RawEmargementFile).items;
  }
  if (Array.isArray(raw)) return raw as RawEmargementItem[];
  throw new Error("Format JSON inattendu : un champ 'items' (tableau) est requis.");
}

export function buildEmargementRow(item: RawEmargementItem, scrutin: ScrutinCode): EmargementRow {
  const dateEmargement = parseDateEmargement(item.dateEmargement);
  return {
    scrutin,
    nom: item.nom ?? "",
    prenom: item.prenom ?? "",
    nomNorm: normalizeName(item.nom),
    prenomNorm: normalizeName(item.prenom),
    dateEmargement,
    corps: item.corps ?? null,
    etablissement: item.affectation ?? null,
    referenceBulletin: item.referenceBulletin ?? null,
    votant: dateEmargement ? 1 : 0,
  };
}
