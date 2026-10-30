/**
 * Les 2 scrutins nationaux agricoles — voir le même fichier côté frontend,
 * à tenir synchronisé. Le `code` est la valeur stockée en base
 * (imports.scrutin, emargements.scrutin, relance_tracking.scrutin) : le
 * changer après coup invaliderait les données déjà importées, contrairement
 * au `label` qui n'est qu'un affichage et peut être renommé sans risque.
 */
export interface ScrutinDef {
  code: "scrutin1" | "scrutin2";
  label: string;
}

export const SCRUTINS: ScrutinDef[] = [
  { code: "scrutin1", label: "Comité consultatif ministériel (CCM)" },
  { code: "scrutin2", label: "Commission consultative mixte (CCM)" },
];

export type ScrutinCode = (typeof SCRUTINS)[number]["code"];

export function isScrutinCode(value: unknown): value is ScrutinCode {
  return SCRUTINS.some((s) => s.code === value);
}

export function scrutinLabel(code: string): string {
  return SCRUTINS.find((s) => s.code === code)?.label ?? code;
}
