import { describe, expect, it } from "vitest";
import { composeEtablissement, parseEmargementsJson } from "../emargements.js";

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

describe("composeEtablissement — nom d'établissement complété par ville/codePostal", () => {
  it("ajoute la ville quand le fichier la fournit", () => {
    expect(composeEtablissement("ECOLE Y", "Nice", "06500")).toBe("ECOLE Y - Nice");
  });

  it("déduit la ville du code postal quand le fichier ne la fournit pas, s'il ne correspond qu'à une seule commune", () => {
    // 06000 Nice : une seule commune pour ce code postal (référentiel INSEE/DGFiP).
    expect(composeEtablissement("ECOLE Y", null, "06000")).toBe("ECOLE Y - Nice");
    expect(composeEtablissement("ECOLE Y", undefined, 6000)).toBe("ECOLE Y - Nice"); // code postal numérique (zéro initial reconstitué)
  });

  it("se replie sur le code postal brut quand il correspond à plusieurs communes (cas fréquent en zone rurale)", () => {
    // 06500 : plusieurs communes partagent ce code postal, aucune ville fiable à afficher.
    expect(composeEtablissement("ECOLE Y", null, "06500")).toBe("ECOLE Y - 06500");
  });

  it("laisse l'établissement tel quel si ni ville ni codePostal ne sont disponibles", () => {
    expect(composeEtablissement("COLLEGE X 30100 ALES", null, null)).toBe("COLLEGE X 30100 ALES");
  });

  it("n'invente pas d'établissement quand affectation est absente", () => {
    expect(composeEtablissement(null, "Nice", "06500")).toBeNull();
  });
});
