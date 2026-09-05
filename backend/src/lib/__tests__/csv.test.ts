import { describe, expect, it } from "vitest";
import { parseCsvBuffer } from "../csv.js";

function buf(text: string): Buffer {
  return Buffer.from(text, "utf-8");
}

describe("parseCsvBuffer", () => {
  it("parse un CSV simple séparé par des virgules", () => {
    const rows = parseCsvBuffer(buf("nom,prenom\nDUPONT,Jean\nMARTIN,Alice\n"));
    expect(rows).toEqual([
      { nom: "DUPONT", prenom: "Jean" },
      { nom: "MARTIN", prenom: "Alice" },
    ]);
  });

  it("détecte le point-virgule comme séparateur", () => {
    const rows = parseCsvBuffer(buf("nom;prenom\nDUPONT;Jean\n"));
    expect(rows).toEqual([{ nom: "DUPONT", prenom: "Jean" }]);
  });

  it("gère les champs entre guillemets contenant le séparateur", () => {
    const rows = parseCsvBuffer(buf('nom,adresse\nDUPONT,"12 rue de la Paix, Paris"\n'));
    expect(rows).toEqual([{ nom: "DUPONT", adresse: "12 rue de la Paix, Paris" }]);
  });

  it("gère les guillemets doublés comme guillemet échappé", () => {
    const rows = parseCsvBuffer(buf('nom\n"D""ARC"\n'));
    expect(rows).toEqual([{ nom: 'D"ARC' }]);
  });

  it("ignore le BOM UTF-8 en tête de fichier", () => {
    const rows = parseCsvBuffer(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), buf("nom\nDUPONT\n")]));
    expect(rows).toEqual([{ nom: "DUPONT" }]);
  });

  it("retourne un tableau vide pour un fichier vide", () => {
    expect(parseCsvBuffer(buf(""))).toEqual([]);
  });
});
