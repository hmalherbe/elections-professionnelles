import { describe, expect, it } from "vitest";
import { buildUnsubscribeUrl, canalFromContact, unsubscribeToken, verifyUnsubscribeToken } from "../unsubscribeToken.js";

describe("canalFromContact", () => {
  it("reconnaît un mail (présence de @)", () => {
    expect(canalFromContact("test@example.com")).toBe("mail");
  });

  it("reconnaît un mobile (absence de @)", () => {
    expect(canalFromContact("0612345678")).toBe("sms");
  });
});

describe("unsubscribeToken", () => {
  it("vérifie un jeton généré pour le même contact", () => {
    const token = unsubscribeToken("test@example.com");
    expect(verifyUnsubscribeToken("test@example.com", token)).toBe(true);
  });

  it("rejette un jeton pour un contact différent", () => {
    const token = unsubscribeToken("test@example.com");
    expect(verifyUnsubscribeToken("autre@example.com", token)).toBe(false);
  });

  it("rejette un jeton altéré", () => {
    const token = unsubscribeToken("0612345678");
    const altered = token.slice(0, -1) + (token.at(-1) === "A" ? "B" : "A");
    expect(verifyUnsubscribeToken("0612345678", altered)).toBe(false);
  });

  it("rejette un jeton de longueur différente sans lever d'exception", () => {
    expect(verifyUnsubscribeToken("test@example.com", "trop-court")).toBe(false);
  });

  it("construit une URL courte avec contact et jeton", () => {
    const url = buildUnsubscribeUrl("0612345678");
    expect(url).toContain("/api/u?c=0612345678&t=");
    expect(url).toMatch(/[&?]t=[\w-]{12}$/);
  });
});
