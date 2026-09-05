import { describe, expect, it } from "vitest";
import { normalizeFrenchMobile } from "../phone.js";

describe("normalizeFrenchMobile", () => {
  it("convertit un numéro national avec 0 initial", () => {
    expect(normalizeFrenchMobile("0620053811")).toBe("33620053811");
  });

  it("gère les espaces de séparation", () => {
    expect(normalizeFrenchMobile("06 20 05 38 11")).toBe("33620053811");
  });

  it("gère le préfixe +33", () => {
    expect(normalizeFrenchMobile("+33620053811")).toBe("33620053811");
  });

  it("gère le préfixe 0033", () => {
    expect(normalizeFrenchMobile("0033620053811")).toBe("33620053811");
  });

  it("laisse un numéro déjà au format international inchangé", () => {
    expect(normalizeFrenchMobile("33620053811")).toBe("33620053811");
  });
});
