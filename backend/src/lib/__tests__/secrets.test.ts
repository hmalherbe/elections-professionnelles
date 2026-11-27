import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requiredSecret } from "../secrets.js";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.TEST_SECRET_A;
  delete process.env.TEST_SECRET_B;
  delete process.env.NODE_ENV;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("requiredSecret", () => {
  it("retourne la première variable définie", () => {
    process.env.TEST_SECRET_B = "valeur-b";
    expect(requiredSecret(["TEST_SECRET_A", "TEST_SECRET_B"], "repli")).toBe("valeur-b");
  });

  it("retourne la valeur de repli hors production si aucune variable n'est définie", () => {
    expect(requiredSecret(["TEST_SECRET_A"], "repli")).toBe("repli");
  });

  it("lève une erreur en production si aucune variable n'est définie (jamais de repli silencieux)", () => {
    process.env.NODE_ENV = "production";
    expect(() => requiredSecret(["TEST_SECRET_A"], "repli")).toThrow(/Secret manquant en production/);
  });

  it("retourne la variable définie en production (pas d'erreur)", () => {
    process.env.NODE_ENV = "production";
    process.env.TEST_SECRET_A = "valeur-prod";
    expect(requiredSecret(["TEST_SECRET_A"], "repli")).toBe("valeur-prod");
  });
});
