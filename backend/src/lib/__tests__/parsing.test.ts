import { describe, expect, it } from "vitest";
import { classifyDegre } from "../degre.js";
import { extractDepartement } from "../departement.js";
import { parseDateEmargement } from "../dateEmargement.js";

describe("classifyDegre", () => {
  it("classe le 1er degré via 'Professeurs des écoles'", () => {
    expect(classifyDegre("Professeurs des écoles enseignement privé de l'éducation nationale")).toBe("1D");
    expect(classifyDegre("Professeurs des écoles de l'éducation nationale")).toBe("1D");
  });

  it("classe le 2nd degré via 'certifié' ou 'agrégé'", () => {
    expect(classifyDegre("Professeurs certifiés de l'éducation nationale")).toBe("2D");
    expect(classifyDegre("Professeurs agrégés du second degré de l'éducation nationale")).toBe("2D");
    expect(classifyDegre("Professeurs certifiés enseignement privé de l'éducation nationale")).toBe("2D");
  });

  it("laisse indéterminé les autres corps", () => {
    expect(classifyDegre("Maîtres auxiliaires enseignement privé")).toBe("INDETERMINE");
    expect(classifyDegre(null)).toBe("INDETERMINE");
  });
});

describe("extractDepartement", () => {
  it("extrait un département métropolitain (2 chiffres)", () => {
    expect(extractDepartement("LYCEE BELLEVUE 30100 ALES")).toBe("30");
    expect(extractDepartement("LYCEE FREDERIC OZANAM 59045 LILLE CEDEX")).toBe("59");
  });

  it("extrait un département d'outre-mer (3 chiffres)", () => {
    expect(extractDepartement("COLLEGE LA SALLE ST MICHEL 97404 ST DENIS CEDEX")).toBe("974");
    expect(extractDepartement("INSTITUT MEDICO-EDUCATIF IMPRO TROIS MARES 97835 LE TAMPON CEDEX")).toBe("978");
  });

  it("retourne null si aucun code postal", () => {
    expect(extractDepartement("SANS CODE POSTAL")).toBeNull();
    expect(extractDepartement(null)).toBeNull();
  });
});

describe("parseDateEmargement", () => {
  it("parse le format observé AAAAMMJJ HH:MM:SS", () => {
    const iso = parseDateEmargement("20221206 16:09:32");
    expect(iso).not.toBeNull();
    expect(iso).toContain("2022-12-06");
  });

  it("parse le format AAMMJJ HHMMSS", () => {
    const iso = parseDateEmargement("261203 090000");
    expect(iso).toContain("2026-12-03");
  });

  it("retourne null si absent", () => {
    expect(parseDateEmargement(null)).toBeNull();
    expect(parseDateEmargement("")).toBeNull();
  });
});
