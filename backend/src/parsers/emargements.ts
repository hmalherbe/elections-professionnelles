import { classifyDegre, type Degre } from "../lib/degre.js";
import { extractDepartement, extractDepartementFromCodePostal, extractDepartementFromRne } from "../lib/departement.js";
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
  /**
   * Code RNE/UAI de l'établissement (ex. "0751234A"), si le fichier le
   * fournit — nom de champ à confirmer dès réception du format réel du
   * fichier CCMMEP. Utilisé en priorité sur le code postal contenu dans
   * `affectation` pour déterminer le département (voir buildEmargementRow).
   */
  rne?: string | null;
  /**
   * Nom de naissance de l'électeur, distinct de `nom` (nom d'usage) — ex.
   * fichier des électeurs CCMMEP 2026, qui fournit nomUsage ET nomFamille
   * séparément. Facultatif, symétrique à adherents.nom_naissance : sert au
   * rapprochement (exact ou approximatif) si l'adhérent est déclaré par son
   * Spelc sous l'autre nom (voir services/fuzzyMatching.ts).
   */
  nomNaissance?: string | null;
  /**
   * Code postal de l'établissement, tel que fourni directement et déjà
   * isolé par le fichier des électeurs CCMMEP 2026 (champ "codePostal") —
   * contrairement à "affectation" (texte libre contenant un code postal à
   * y repérer), utilisé par le fichier d'émargement. Les deux formats
   * doivent fonctionner de concert : voir normalizeRawItem() et
   * buildEmargementRow() ci-dessous.
   */
  codePostal?: string | number | null;
}

export interface RawEmargementFile {
  totalCount?: number;
  items: Record<string, unknown>[];
}

/**
 * Deux formats de fichier national CCMMEP coexistent et doivent tous les
 * deux être importables :
 *   - le fichier d'émargement (qui du 3 au 10 décembre portera les votes du
 *     jour — pour l'instant, en l'absence de ces fichiers réels, le format
 *     de test 2022 : nom/prenom/corps/affectation/dateEmargement/
 *     referenceBulletin, le département se déduisant d'un code postal à
 *     repérer dans le texte libre "affectation") ;
 *   - le fichier des électeurs (la liste d'éligibilité, disponible avant le
 *     3 décembre, en l'absence des fichiers d'émargement quotidiens réels :
 *     matricule/nomFamille/nomUsage/prenom/nomCol/nomEtab/codePostal/
 *     statut/civilite, le département se déduisant directement du champ
 *     codePostal, déjà isolé).
 * Détecté ligne à ligne (présence de nomUsage, qui n'existe pas dans le
 * premier format) plutôt que pour le fichier entier : robuste même si un
 * futur fichier d'émargement réel reprend les noms de champs du fichier
 * des électeurs (nomUsage/nomCol/nomEtab/codePostal) en y ajoutant
 * dateEmargement/referenceBulletin — repris tels quels s'ils sont présents,
 * quel que soit le format par ailleurs.
 */
function normalizeRawItem(raw: Record<string, unknown>): RawEmargementItem {
  const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v));

  if ("nomUsage" in raw || "nomCol" in raw || "nomEtab" in raw || "codePostal" in raw) {
    const nom = str(raw.nomUsage) ?? "";
    const nomFamille = str(raw.nomFamille);
    return {
      nom,
      prenom: str(raw.prenom) ?? "",
      dateEmargement: (raw.dateEmargement as string | null | undefined) ?? null,
      corps: str(raw.nomCol),
      affectation: str(raw.nomEtab),
      referenceBulletin: (raw.referenceBulletin as string | null | undefined) ?? null,
      rne: (raw.rne as string | null | undefined) ?? null,
      nomNaissance: nomFamille && nomFamille !== nom ? nomFamille : null,
      codePostal: (raw.codePostal as string | number | null | undefined) ?? null,
    };
  }

  return raw as unknown as RawEmargementItem;
}

export interface EmargementRow {
  academie: string | null;
  degre: Degre;
  scrutinType: string | null;
  nom: string;
  prenom: string;
  nomNorm: string;
  prenomNorm: string;
  nomNaissance: string | null;
  nomNaissanceNorm: string | null;
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
    return (raw as RawEmargementFile).items.map(normalizeRawItem);
  }
  if (Array.isArray(raw)) return (raw as Record<string, unknown>[]).map(normalizeRawItem);
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
  // Priorité aux champs structurés et dédiés — RNE, puis codePostal (fichier
  // des électeurs 2026) — sur la recherche d'un code postal dans le texte
  // libre `affectation` (fichier d'émargement), en repli si les deux
  // premiers sont absents ou n'ont pas été reconnus. Les deux formats de
  // fichier fonctionnent ainsi de concert via la même fonction.
  const departement =
    extractDepartementFromRne(item.rne) ??
    extractDepartementFromCodePostal(item.codePostal) ??
    extractDepartement(item.affectation);
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
    nomNaissance: item.nomNaissance ?? null,
    nomNaissanceNorm: item.nomNaissance ? normalizeName(item.nomNaissance) : null,
    dateEmargement,
    corps: item.corps ?? null,
    affectation: item.affectation ?? null,
    departement,
    spelc,
    referenceBulletin: item.referenceBulletin ?? null,
    votant: dateEmargement ? 1 : 0,
  };
}
