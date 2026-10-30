/**
 * Les 2 scrutins nationaux agricoles — voir le même fichier côté backend
 * (lib/scrutins.ts), à tenir synchronisé. `code` doit rester stable (déjà
 * utilisé dans les données importées) ; seul `label` est un simple affichage.
 */
export interface ScrutinDef {
  code: "scrutin1" | "scrutin2";
  label: string;
}

export const SCRUTINS: ScrutinDef[] = [
  { code: "scrutin1", label: "Comité consultatif ministériel (CCM)" },
  { code: "scrutin2", label: "Commission consultative mixte (CCM)" },
];
