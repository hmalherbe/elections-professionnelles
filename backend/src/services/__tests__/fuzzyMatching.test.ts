import { describe, expect, it } from "vitest";
import { electeurMatchesAdherent, identityKeys, prenomCompatible } from "../fuzzyMatching.js";
import { normalizeName } from "../../lib/normalize.js";

const n = normalizeName;

describe("prenomCompatible", () => {
  it("accepte toujours une distance de Levenshtein <= seuil (comportement inchangé)", () => {
    expect(prenomCompatible(n("Camille"), n("Camile"), 1)).toBe(true);
    expect(prenomCompatible(n("Camille"), n("Camil"), 1)).toBe(false);
  });

  it("ignore tiret vs espace dans un prénom composé (cas Thi-Hoang-Liên / Thi Hoang Lien)", () => {
    expect(prenomCompatible(n("Thi-Hoang-Liên"), n("Thi Hoang Lien"), 1)).toBe(true);
  });

  it("reconnaît un prénom d'usage contenu dans le prénom légal complet (cas Mamy Mirinah / Mirinah)", () => {
    expect(prenomCompatible(n("Mirinah"), n("Mamy Mirinah"), 1)).toBe(true);
    expect(prenomCompatible(n("Mamy Mirinah"), n("Mirinah"), 1)).toBe(true); // symétrique
  });

  it("reconnaît un prénom composé côté adhérent contenant le prénom simple de l'électeur (cas Audrey-Francine / Audrey)", () => {
    expect(prenomCompatible(n("Audrey-Francine"), n("Audrey"), 1)).toBe(true);
  });

  it("reconnaît un prénom composé côté électeur (cas adhérent Agnès / électeur Agnès-Jeanne)", () => {
    expect(prenomCompatible(n("Agnès"), n("Agnès-Jeanne"), 1)).toBe(true);
  });

  it("tolère une variante orthographique sur un des mots du prénom composé", () => {
    // "Olivia" (adhérent) vs "Olivya Clara" (électeur) : mot le plus proche à distance 1.
    expect(prenomCompatible(n("Olivia"), n("Olivya Clara"), 1)).toBe(true);
  });

  it("refuse deux prénoms simples manifestement différents, même proches en longueur", () => {
    expect(prenomCompatible(n("Sophie"), n("Marielle"), 1)).toBe(false);
    expect(prenomCompatible(n("Patricia"), n("Sylvie"), 1)).toBe(false);
  });

  it("refuse un prénom composé dont aucun mot ne correspond à l'autre prénom", () => {
    // "Marion" ne correspond à aucun mot de "Jean Michel".
    expect(prenomCompatible(n("Marion"), n("Jean Michel"), 1)).toBe(false);
  });

  it("ignore les mots d'une seule lettre (initiales) pour éviter les faux positifs", () => {
    // "A" ne doit pas suffire à rapprocher deux prénoms composés sans autre mot commun.
    expect(prenomCompatible(n("A"), n("Amandine Blandine"), 1)).toBe(false);
  });
});

describe("identityKeys — tolérance tiret/espace sur le nom (rapprochement exact)", () => {
  it("un nom à tiret et sa variante à espace produisent au moins une clé commune", () => {
    const adherent = identityKeys(n("Soussi-Ouada"), null, n("Imen"));
    const electeur = identityKeys(n("Soussi Ouada"), null, n("Imen"));
    expect(adherent.some((k) => electeur.includes(k))).toBe(true);
  });

  it("reste symétrique (tiret côté adhérent ou côté électeur, peu importe)", () => {
    const a = identityKeys(n("Jean-Pierre"), null, n("Paul"));
    const b = identityKeys(n("Jean Pierre"), null, n("Paul"));
    expect(a.some((k) => b.includes(k))).toBe(true);
  });

  it("ne rapproche pas deux noms différents au-delà du seul tiret/espace", () => {
    const a = identityKeys(n("Martin"), null, n("Paul"));
    const b = identityKeys(n("Martine"), null, n("Paul"));
    expect(a.some((k) => b.includes(k))).toBe(false);
  });

  it("fonctionne aussi via le nom de naissance", () => {
    const adherent = identityKeys(n("Dupont"), n("Soussi-Ouada"), n("Imen"));
    const electeur = identityKeys(n("Dupont"), n("Soussi Ouada"), n("Imen"));
    expect(adherent.some((k) => electeur.includes(k))).toBe(true);
  });
});

describe("electeurMatchesAdherent — tolérance tiret/espace sur le nom", () => {
  it("rapproche un électeur à tiret avec un adhérent à espace (et inversement)", () => {
    const sets = new Map<string, Set<string>>();
    const add = (spelc: string, nomNorm: string, prenomNorm: string) => {
      const set = sets.get(spelc) ?? new Set<string>();
      set.add(`${nomNorm}|${prenomNorm}`);
      set.add(`${nomNorm.replace(/-/g, " ")}|${prenomNorm}`);
      sets.set(spelc, set);
    };
    add("Spelc Test", n("Soussi Ouada"), n("Imen"));
    expect(electeurMatchesAdherent(sets, "Spelc Test", n("Soussi-Ouada"), n("Imen"), null)).toBe(true);
  });
});
