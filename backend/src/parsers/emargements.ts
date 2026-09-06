import { classifyDegre, type Degre } from "../lib/degre.js";
import { extractDepartement } from "../lib/departement.js";
import { parseDateEmargement } from "../lib/dateEmargement.js";
import { normalizeName } from "../lib/normalize.js";
import { lookupDepartement, soleSpelcForAcademie } from "../services/reference.js";

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
  academie: string | null;
  degre: Degre;
  scrutinType: string | null;
  nom: string;
  prenom: string;
  nomNorm: string;
  prenomNorm: string;
  dateEmargement: string | null;
  corps: string | null;
  affectation: string | null;
  departement: string | null;
  spelc: string | null;
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

export interface BuildRowOptions {
  /** Pour un import académique : degré et académie déjà connus (fichier 1D ou 2D dédié). */
  forcedDegre?: Degre;
  forcedAcademie?: string;
  /**
   * Type de scrutin fixe, indépendant du degré (scrutin national CCMMEP :
   * tous les électeurs du fichier appartiennent au même scrutin, qu'on ait
   * pu ou non déterminer leur degré à partir du corps).
   */
  scrutinTypeFixed?: string;
  /** Scrutin académique : le type dépend du degré (CCMI/CCMA/CCMD/CCML…). */
  scrutinTypeFor1D?: string;
  scrutinTypeFor2D?: string;
}

export function buildEmargementRow(item: RawEmargementItem, options: BuildRowOptions = {}): EmargementRow {
  const departement = extractDepartement(item.affectation);
  const lookup = lookupDepartement(departement);
  const degre = options.forcedDegre ?? classifyDegre(item.corps);
  const academie = options.forcedAcademie ?? lookup?.academie ?? null;
  // Le code postal de "affectation" n'est pas toujours reconnu (format
  // inattendu, absent...) : lookup.spelc est alors null même quand l'académie,
  // elle, est connue (forcée pour un import académique). Sans ce repli, la
  // personne resterait invisible du tableau de bord de son Spelc (filtré sur
  // `spelc`), alors que son académie n'a qu'un seul Spelc possible.
  const spelc = lookup?.spelc ?? soleSpelcForAcademie(academie);

  let scrutinType: string | null = options.scrutinTypeFixed ?? null;
  if (!scrutinType) {
    if (degre === "1D") scrutinType = options.scrutinTypeFor1D ?? null;
    else if (degre === "2D") scrutinType = options.scrutinTypeFor2D ?? null;
  }

  const dateEmargement = parseDateEmargement(item.dateEmargement);

  return {
    academie,
    degre,
    scrutinType,
    nom: item.nom ?? "",
    prenom: item.prenom ?? "",
    nomNorm: normalizeName(item.nom),
    prenomNorm: normalizeName(item.prenom),
    dateEmargement,
    corps: item.corps ?? null,
    affectation: item.affectation ?? null,
    departement,
    spelc,
    referenceBulletin: item.referenceBulletin ?? null,
    votant: dateEmargement ? 1 : 0,
  };
}
