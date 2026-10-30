/**
 * Les 2 scrutins nationaux agricoles — voir le même fichier côté backend
 * (lib/scrutins.ts), à tenir synchronisé. Les noms officiels (CPSSA ou
 * autre) restent à confirmer par le client ; seul `label` change alors,
 * `code` doit rester stable (déjà utilisé dans les données importées).
 */
export interface ScrutinDef {
  code: "scrutin1" | "scrutin2";
  label: string;
}

export const SCRUTINS: ScrutinDef[] = [
  { code: "scrutin1", label: "Scrutin 1" },
  { code: "scrutin2", label: "Scrutin 2" },
];
