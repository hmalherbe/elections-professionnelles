import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Référentiel codePostal -> ville, limité aux codes postaux qui ne
 * correspondent qu'à UNE SEULE commune (Code Officiel Géographique INSEE /
 * DGFiP, via le paquet npm "codes-postaux" — licence ouverte). Un code
 * postal français couvre très souvent plusieurs communes (68 % des 6201
 * codes du fichier source, essentiellement en zone rurale) : dans ce cas,
 * aucune ville n'est fiable à afficher, donc volontairement absente de ce
 * référentiel (voir composeEtablissement, qui retombe alors sur le code
 * postal brut).
 *
 * Chargé via fs.readFileSync (pas un import ES statique) : les imports JSON
 * natifs de Node exigent un attribut `with { type: "json" }` que tsc
 * n'émet qu'en ciblant "module": "nodenext"/"esnext" — un changement plus
 * large que nécessaire ici pour un seul fichier de données.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const villes: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../data/villesParCodePostal.json"), "utf-8")
);

export function villeFromCodePostal(codePostal: string | number | null | undefined): string | null {
  if (codePostal == null || codePostal === "") return null;
  const raw = String(codePostal).trim();
  // Même repli que extractDepartementFromCodePostal (lib/departement.ts) : un
  // code postal arrivé en JSON comme nombre perd son zéro initial (ex. 6000
  // au lieu de "06000") pour les départements métropolitains 01 à 09.
  const padded = /^\d{4}$/.test(raw) ? `0${raw}` : raw;
  return villes[padded] ?? null;
}
