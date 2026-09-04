import { stripAccents } from "./normalize.js";

export type Degre = "1D" | "2D" | "INDETERMINE";

/**
 * Règle métier : le corps "Professeurs des écoles" identifie le 1er degré ;
 * "certifié" ou "agrégé" identifie le 2nd degré. Les autres corps restent
 * non classés (l'utilisateur n'a pas fourni de règle pour eux).
 */
export function classifyDegre(corps: string | null | undefined): Degre {
  if (!corps) return "INDETERMINE";
  const normalized = stripAccents(corps).toLowerCase();
  const is1D = normalized.includes("professeurs des ecoles");
  const is2D = normalized.includes("certifie") || normalized.includes("agrege");
  if (is1D && !is2D) return "1D";
  if (is2D && !is1D) return "2D";
  return "INDETERMINE";
}
