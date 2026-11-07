import { describe, expect, it } from "vitest";
import { classifyDegreFromEtablissement, classifyDegreForElecteur } from "../electeursAcademiques.js";

describe("classifyDegreFromEtablissement", () => {
  it("reconnaît collège/lycée -> 2D et école -> 1D, quelle que soit la graine", () => {
    expect(classifyDegreFromEtablissement("Collège privé Saint-Joseph", "seed-a")).toBe("2D");
    expect(classifyDegreFromEtablissement("Lycée général Fénelon", "seed-b")).toBe("2D");
    expect(classifyDegreFromEtablissement("École primaire privée Sainte-Marie", "seed-c")).toBe("1D");
  });

  it("le repli aléatoire est déterministe : même graine -> même résultat à chaque appel", () => {
    // Établissement sans "collège"/"lycée"/"école" -> repli sur deterministicCoinFlip(seed).
    const etab = "ITEP L'essor la foret";
    const seeds = ["ABRIEU|PAULINE", "12345678A@ac-nice.fr", "DUPONT|Jean", "X"];
    for (const seed of seeds) {
      const first = classifyDegreFromEtablissement(etab, seed);
      for (let i = 0; i < 5; i++) {
        expect(classifyDegreFromEtablissement(etab, seed)).toBe(first);
      }
    }
  });

  it("des graines différentes peuvent donner des résultats différents (pas toujours la même valeur)", () => {
    const etab = "ITEP L'essor la foret";
    const results = new Set(
      Array.from({ length: 50 }, (_, i) => classifyDegreFromEtablissement(etab, `seed-${i}`))
    );
    expect(results.has("1D")).toBe(true);
    expect(results.has("2D")).toBe(true);
  });
});

describe("classifyDegreForElecteur", () => {
  it("priorise le corps sur l'établissement quand il tranche", () => {
    expect(classifyDegreForElecteur("Professeurs certifiés ens privé EN", "ITEP L'essor la foret", "seed")).toBe("2D");
    expect(classifyDegreForElecteur("Professeurs écoles ens privé EN", "Collège Stanislas", "seed")).toBe("1D");
  });

  it("repli déterministe sur l'établissement (puis la graine) quand le corps est ambigu", () => {
    const seed = "mamy-mirinah.andriamasiarison@ac-nice.fr";
    const first = classifyDegreForElecteur("maître délégué", "ITEP L'essor la foret", seed);
    expect(classifyDegreForElecteur("maître délégué", "ITEP L'essor la foret", seed)).toBe(first);
  });
});
