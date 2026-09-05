import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "../crypto.js";

describe("encrypt/decrypt", () => {
  it("retrouve le texte original après un aller-retour", () => {
    const original = "MotDePasseSuperSecret123!";
    const encrypted = encrypt(original);
    expect(encrypted).not.toBe(original);
    expect(decrypt(encrypted)).toBe(original);
  });

  it("produit un résultat différent à chaque chiffrement (IV aléatoire)", () => {
    const a = encrypt("même texte");
    const b = encrypt("même texte");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("même texte");
    expect(decrypt(b)).toBe("même texte");
  });
});
