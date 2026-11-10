import { describe, expect, it } from "vitest";
import { parseEmargementsJson } from "../emargements.js";

describe("parseEmargementsJson — les deux formats fonctionnent de concert", () => {
  it("reconnaît le format d'émargement (nom/prenom/corps/affectation) tel quel", () => {
    const [item] = parseEmargementsJson({
      items: [
        {
          nom: "DUPONT",
          prenom: "Marie",
          dateEmargement: "2026-12-03",
          corps: "Professeurs certifiés",
          affectation: "COLLEGE X 30100 ALES",
          referenceBulletin: "REF1",
        },
      ],
    });
    expect(item).toMatchObject({
      nom: "DUPONT",
      prenom: "Marie",
      corps: "Professeurs certifiés",
      affectation: "COLLEGE X 30100 ALES",
      referenceBulletin: "REF1",
    });
    expect(item.codePostal ?? null).toBeNull();
  });

  it("reconnaît et convertit le format du fichier des électeurs (nomUsage/nomCol/nomEtab/codePostal)", () => {
    const [item] = parseEmargementsJson({
      items: [
        {
          matricule: "12345678A",
          nomFamille: "MARTIN",
          nomUsage: "DURAND",
          prenom: "Alice",
          nomCol: "Professeurs écoles ens privé EN",
          nomEtab: "ECOLE Y",
          codePostal: "06500",
          statut: "Titulaire",
          civilite: "Mme",
        },
      ],
    });
    expect(item).toMatchObject({
      nom: "DURAND",
      prenom: "Alice",
      corps: "Professeurs écoles ens privé EN",
      affectation: "ECOLE Y",
      nomNaissance: "MARTIN",
      codePostal: "06500",
      dateEmargement: null,
    });
  });

  it("ne porte pas de nom de naissance quand nomFamille == nomUsage (pas de nom marital)", () => {
    const [item] = parseEmargementsJson({
      items: [{ nomUsage: "BIANCO", nomFamille: "BIANCO", prenom: "Olympe", codePostal: "06200" }],
    });
    expect(item.nomNaissance ?? null).toBeNull();
  });

  it("reprend dateEmargement/referenceBulletin si un futur fichier d'émargement réel reprend les champs du fichier des électeurs", () => {
    const [item] = parseEmargementsJson({
      items: [
        {
          nomUsage: "PETIT",
          prenom: "Jean",
          codePostal: "75001",
          dateEmargement: "2026-12-05",
          referenceBulletin: "REF42",
        },
      ],
    });
    expect(item.dateEmargement).toBe("2026-12-05");
    expect(item.referenceBulletin).toBe("REF42");
  });

  it("traite un fichier mélangeant les deux formats, ligne à ligne", () => {
    const items = parseEmargementsJson({
      items: [
        { nom: "DUPONT", prenom: "Marie", dateEmargement: null, corps: null, affectation: "COLLEGE X 30100 ALES" },
        { nomUsage: "DURAND", prenom: "Alice", nomCol: null, nomEtab: "ECOLE Y", codePostal: "06500" },
      ],
    });
    expect(items).toHaveLength(2);
    expect(items[0].nom).toBe("DUPONT");
    expect(items[0].codePostal ?? null).toBeNull();
    expect(items[1].nom).toBe("DURAND");
    expect(items[1].codePostal).toBe("06500");
  });

  it("accepte aussi un tableau JSON brut (sans enveloppe { items })", () => {
    const items = parseEmargementsJson([{ nomUsage: "SEUL", prenom: "Un", codePostal: "13001" }]);
    expect(items).toHaveLength(1);
    expect(items[0].nom).toBe("SEUL");
  });
});
