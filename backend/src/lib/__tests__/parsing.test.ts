import { describe, expect, it } from "vitest";
import { classifyDegre, classifyDegreAvecEtablissement, classifyDegreFromEtablissementName } from "../degre.js";
import { extractDepartement, extractDepartementFromCodePostal, extractDepartementFromRne } from "../departement.js";
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
    expect(classifyDegre("Maître délégué")).toBe("INDETERMINE");
    expect(classifyDegre("Adj ens ens privé")).toBe("INDETERMINE");
    expect(classifyDegre("Non Applicable")).toBe("INDETERMINE");
    expect(classifyDegre(null)).toBe("INDETERMINE");
  });

  it("classe le 1er degré via le vocabulaire réel du fichier électeurs CCMMEP 2026", () => {
    expect(classifyDegre("Professeurs écoles ens privé EN")).toBe("1D");
    expect(classifyDegre("Professeurs écoles éducation nationale")).toBe("1D");
    expect(classifyDegre("Enseignant contractuel alternant 1er degré privé")).toBe("1D");
    expect(classifyDegre("Instituteurs ens privé")).toBe("1D");
    expect(classifyDegre("instituteur suppléant")).toBe("1D");
    expect(classifyDegre("instituteur breveté")).toBe("1D");
  });

  it("classe le 2nd degré via le vocabulaire réel du fichier électeurs CCMMEP 2026", () => {
    expect(classifyDegre("Professeurs lycée professionnel ens privé EN")).toBe("2D");
    expect(classifyDegre("Professeurs EPS ens privé EN")).toBe("2D");
    expect(classifyDegre("Professeurs éducation physique sportive EN")).toBe("2D");
    expect(classifyDegre("Professeurs chaires supes ens privé EN")).toBe("2D");
    expect(classifyDegre("Professeurs chaires sup étab class mod tech EN")).toBe("2D");
    expect(classifyDegre("agent contractuel second degré")).toBe("2D");
    expect(classifyDegre("Enseignant contractuel alternant 2d degré privé")).toBe("2D");
  });
});

describe("classifyDegreFromEtablissementName", () => {
  it("classe 2D via collège ou lycée", () => {
    expect(classifyDegreFromEtablissementName("Collège Jean Moulin")).toBe("2D");
    expect(classifyDegreFromEtablissementName("Lycée général et technologique Fénelon")).toBe("2D");
  });

  it("classe 1D via école (élémentaire ou primaire)", () => {
    expect(classifyDegreFromEtablissementName("École élémentaire Sainte-Marie")).toBe("1D");
    expect(classifyDegreFromEtablissementName("École primaire privée Saint-Joseph")).toBe("1D");
  });

  it("ne tranche jamais au hasard quand le nom ne permet pas de conclure", () => {
    expect(classifyDegreFromEtablissementName("ITEP L'essor la forêt")).toBe("INDETERMINE");
    expect(classifyDegreFromEtablissementName(null)).toBe("INDETERMINE");
  });
});

describe("classifyDegreAvecEtablissement", () => {
  it("priorise le corps sur l'établissement quand il tranche", () => {
    expect(classifyDegreAvecEtablissement("Professeurs certifiés ens privé EN", "École X")).toBe("2D");
    expect(classifyDegreAvecEtablissement("Professeurs écoles ens privé EN", "Collège Y")).toBe("1D");
  });

  it("se replie sur l'établissement quand le corps est ambigu, sans tirage aléatoire", () => {
    expect(classifyDegreAvecEtablissement("maître délégué", "Lycée Z")).toBe("2D");
    expect(classifyDegreAvecEtablissement("maître délégué", "École W")).toBe("1D");
    expect(classifyDegreAvecEtablissement("maître délégué", "ITEP L'essor la forêt")).toBe("INDETERMINE");
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

  it("reconstitue le zéro initial d'un code postal à 4 chiffres (départements 01 à 09)", () => {
    expect(extractDepartement("COLLEGE SAINTE MARIE 1500 AMBERIEU EN BUGEY")).toBe("01");
    expect(extractDepartement("LYCEE SAINT JOSEPH 2140 FONTAINE LES VERVINS")).toBe("02");
    expect(extractDepartement("LYCEE FENELON 6130 GRASSE")).toBe("06");
    expect(extractDepartement("LYCEE LPO SAINT PAUL 8000 CHARLEVILLE MEZIERES")).toBe("08");
  });

  it("privilégie un vrai code à 5 chiffres même si un nombre à 4 chiffres apparaît aussi", () => {
    expect(extractDepartement("LYCEE MONTPENSIER 64051 PAU CEDEX 9")).toBe("64");
  });
});

describe("extractDepartementFromRne", () => {
  it("extrait un département métropolitain (zéro initial retiré)", () => {
    expect(extractDepartementFromRne("0751234A")).toBe("75");
    expect(extractDepartementFromRne("0020001Z")).toBe("02");
  });

  it("extrait un département d'outre-mer (3 chiffres conservés)", () => {
    expect(extractDepartementFromRne("9710001B")).toBe("971");
    expect(extractDepartementFromRne("9780001C")).toBe("978");
  });

  it("accepte une casse minuscule et des espaces superflus", () => {
    expect(extractDepartementFromRne(" 0751234a ")).toBe("75");
  });

  it("retourne null si le format ne correspond pas à un RNE/UAI", () => {
    expect(extractDepartementFromRne(null)).toBeNull();
    expect(extractDepartementFromRne("")).toBeNull();
    expect(extractDepartementFromRne("751234A")).toBeNull();
    expect(extractDepartementFromRne("0751234")).toBeNull();
    expect(extractDepartementFromRne("075123AB")).toBeNull();
  });
});

describe("extractDepartementFromCodePostal", () => {
  it("dérive un département métropolitain d'un code postal déjà isolé", () => {
    expect(extractDepartementFromCodePostal("30100")).toBe("30");
    expect(extractDepartementFromCodePostal("06500")).toBe("06");
  });

  it("dérive un département d'outre-mer (3 chiffres)", () => {
    expect(extractDepartementFromCodePostal("97404")).toBe("974");
  });

  it("reconstitue le zéro initial perdu sur une valeur numérique à 4 chiffres", () => {
    expect(extractDepartementFromCodePostal(1500)).toBe("01");
    expect(extractDepartementFromCodePostal("6130")).toBe("06");
  });

  it("retourne null pour une valeur absente ou non reconnue", () => {
    expect(extractDepartementFromCodePostal(null)).toBeNull();
    expect(extractDepartementFromCodePostal(undefined)).toBeNull();
    expect(extractDepartementFromCodePostal("")).toBeNull();
    expect(extractDepartementFromCodePostal("ABCDE")).toBeNull();
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
