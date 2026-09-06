import { describe, expect, it } from "vitest";
import { isValidSmsSender, suggestSmsSender } from "../smsSender.js";

describe("isValidSmsSender", () => {
  it("accepte un nom alphanumérique de 11 caractères ou moins", () => {
    expect(isValidSmsSender("SpelcParis")).toBe(true);
    expect(isValidSmsSender("Spelc")).toBe(true);
  });

  it("rejette un nom de plus de 11 caractères", () => {
    expect(isValidSmsSender("SpelcGuadeloupe")).toBe(false);
  });

  it("rejette les espaces et caractères spéciaux", () => {
    expect(isValidSmsSender("Spelc Paris")).toBe(false);
    expect(isValidSmsSender("Spelc-Paris")).toBe(false);
    expect(isValidSmsSender("Spelc'Azur")).toBe(false);
  });

  it("rejette un nom purement numérique", () => {
    expect(isValidSmsSender("12345")).toBe(false);
  });

  it("rejette une chaîne vide", () => {
    expect(isValidSmsSender("")).toBe(false);
  });
});

describe("suggestSmsSender", () => {
  it("préfixe le nom du Spelc par 'Spelc'", () => {
    expect(suggestSmsSender("Paris")).toBe("SpelcParis");
  });

  it("tronque à 11 caractères", () => {
    expect(suggestSmsSender("Guadeloupe")).toBe("SpelcGuadel");
    expect(suggestSmsSender("Guadeloupe").length).toBe(11);
  });

  it("retire les accents et espaces", () => {
    expect(suggestSmsSender("Côte d'Azur")).toBe("SpelcCotedA");
  });

  it("produit toujours un résultat valide pour isValidSmsSender", () => {
    for (const name of ["Paris", "Guadeloupe", "Côte d'Azur", "Centre-Poitou-Charente"]) {
      expect(isValidSmsSender(suggestSmsSender(name))).toBe(true);
    }
  });
});
