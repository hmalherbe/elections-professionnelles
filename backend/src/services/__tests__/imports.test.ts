import { describe, expect, it } from "vitest";
import { detectDegreMismatch } from "../imports.js";
import type { RawEmargementItem } from "../../parsers/emargements.js";

function item(corps: string | null, affectation: string | null): RawEmargementItem {
  return { nom: "X", prenom: "Y", dateEmargement: null, corps, affectation };
}

describe("detectDegreMismatch", () => {
  it("ne signale rien quand le fichier correspond au degré attendu", () => {
    const items = [
      item("Professeurs certifiés ens privé EN", "Collège A"),
      item("Professeurs agrégés ens privé EN", "Lycée B"),
      item("maître délégué", "Collège C"), // repli établissement, cohérent
    ];
    expect(detectDegreMismatch(items, "2D")).toBeNull();
  });

  it("signale le 2nd degré quand un fichier 1D contient en majorité du 2nd degré", () => {
    const items = [
      item("Professeurs certifiés ens privé EN", "Collège A"),
      item("Professeurs agrégés ens privé EN", "Lycée B"),
      item("Professeurs lycée professionnel ens privé EN", "Lycée C"),
    ];
    expect(detectDegreMismatch(items, "1D")).toBe("2nd degré");
  });

  it("signale le 1er degré quand un fichier 2D contient en majorité du 1er degré", () => {
    const items = [
      item("Professeurs écoles ens privé EN", "École A"),
      item("instituteur", "École B"),
      item("Professeurs des écoles", "École C"),
    ];
    expect(detectDegreMismatch(items, "2D")).toBe("1er degré");
  });

  it("ne signale rien si une minorité seulement contredit le degré attendu", () => {
    const items = [
      item("Professeurs certifiés ens privé EN", "Collège A"),
      item("Professeurs agrégés ens privé EN", "Lycée B"),
      item("Professeurs certifiés ens privé EN", "Collège C"),
      item("Professeurs écoles ens privé EN", "École D"), // un seul électeur isolé, ne bloque pas le fichier
    ];
    expect(detectDegreMismatch(items, "2D")).toBeNull();
  });

  it("ne signale rien quand aucun électeur n'a un degré déterminable", () => {
    const items = [item("maître délégué", "ITEP L'essor la forêt"), item(null, null)];
    expect(detectDegreMismatch(items, "1D")).toBeNull();
  });

  it("se replie sur le nom de l'établissement pour les corps ambigus", () => {
    const items = [
      item("maître délégué", "Lycée A"),
      item("maître délégué", "Collège B"),
      item("maître délégué", "Lycée C"),
    ];
    expect(detectDegreMismatch(items, "1D")).toBe("2nd degré");
  });
});
