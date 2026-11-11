import { stripAccents } from "./normalize.js";

export type Degre = "1D" | "2D" | "INDETERMINE";

/**
 * Règle métier, élargie à partir du vocabulaire réel observé dans le
 * fichier des électeurs CCMMEP 2026 (plus riche que "Professeurs des
 * écoles"/"certifié"/"agrégé" seuls, qui suffisaient sur les anciens
 * fichiers de test) :
 *   - 1er degré : "professeurs des écoles" ou "professeurs écoles" (sans
 *     "des", variante trouvée dans le fichier réel), "instituteur" (ancien
 *     intitulé du 1er degré, encore présent), ou "1er degré" explicite.
 *   - 2nd degré : "certifié", "agrégé", "lycée professionnel", "chaire(s)
 *     sup(érieure)", "EPS"/"éducation physique sportive", ou "second
 *     degré"/"2d degré" explicite.
 * Les autres corps (ex. "maître délégué", utilisé indifféremment dans les
 * deux degrés) restent non classés : voir classifyDegreFromEtablissement()
 * pour le repli sur le nom de l'établissement dans ce cas.
 */
export function classifyDegre(corps: string | null | undefined): Degre {
  if (!corps) return "INDETERMINE";
  const n = stripAccents(corps).toLowerCase();
  const is1D =
    n.includes("professeurs des ecoles") ||
    n.includes("professeurs ecoles") ||
    n.includes("instituteur") ||
    n.includes("1er degre");
  const is2D =
    n.includes("certifie") ||
    n.includes("agrege") ||
    n.includes("lycee professionnel") ||
    (n.includes("chaire") && n.includes("sup")) ||
    /\beps\b/.test(n) ||
    n.includes("education physique sportive") ||
    n.includes("second degre") ||
    n.includes("2d degre");
  if (is1D && !is2D) return "1D";
  if (is2D && !is1D) return "2D";
  return "INDETERMINE";
}

/**
 * Degré via le seul nom de l'établissement (collège/lycée -> 2D, école
 * élémentaire/primaire -> 1D), SANS repli aléatoire — contrairement à
 * classifyDegreFromEtablissement() (services/electeursAcademiques.ts), qui
 * a besoin d'un résultat binaire garanti pour répartir un électeur dans un
 * fichier CCMI ou CCMA généré hors ligne. Ici (détection d'un fichier
 * académique importé avec le mauvais degré, voir
 * services/imports.ts#detectDegreMismatch), laisser "INDETERMINE" quand
 * l'établissement ne permet pas de conclure est préférable à une
 * classification arbitraire.
 */
export function classifyDegreFromEtablissementName(etablissement: string | null | undefined): Degre {
  if (!etablissement) return "INDETERMINE";
  const n = stripAccents(etablissement).toLowerCase();
  if (n.includes("college") || n.includes("lycee")) return "2D";
  if (n.includes("ecole")) return "1D";
  return "INDETERMINE";
}

/**
 * Degré combiné, sans tirage aléatoire : le corps d'abord (classifyDegre,
 * plus fiable quand il tranche), le nom de l'établissement en repli
 * (classifyDegreFromEtablissementName) pour les corps ambigus (ex. "maître
 * délégué", utilisé indifféremment dans les deux degrés).
 */
export function classifyDegreAvecEtablissement(
  corps: string | null | undefined,
  etablissement: string | null | undefined
): Degre {
  const viaCorps = classifyDegre(corps);
  if (viaCorps !== "INDETERMINE") return viaCorps;
  return classifyDegreFromEtablissementName(etablissement);
}
