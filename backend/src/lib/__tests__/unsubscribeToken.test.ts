import { describe, expect, it } from "vitest";
import { buildUnsubscribeUrl, unsubscribeToken, verifyUnsubscribeToken } from "../unsubscribeToken.js";

describe("unsubscribeToken", () => {
  it("vérifie un jeton généré pour le même canal/contact", () => {
    const token = unsubscribeToken("mail", "test@example.com");
    expect(verifyUnsubscribeToken("mail", "test@example.com", token)).toBe(true);
  });

  it("rejette un jeton pour un contact différent", () => {
    const token = unsubscribeToken("mail", "test@example.com");
    expect(verifyUnsubscribeToken("mail", "autre@example.com", token)).toBe(false);
  });

  it("rejette un jeton pour un canal différent (même contact)", () => {
    const token = unsubscribeToken("mail", "0612345678");
    expect(verifyUnsubscribeToken("sms", "0612345678", token)).toBe(false);
  });

  it("rejette un jeton altéré", () => {
    const token = unsubscribeToken("sms", "0612345678");
    const altered = token.slice(0, -1) + (token.at(-1) === "A" ? "B" : "A");
    expect(verifyUnsubscribeToken("sms", "0612345678", altered)).toBe(false);
  });

  it("rejette un jeton de longueur différente sans lever d'exception", () => {
    expect(verifyUnsubscribeToken("mail", "test@example.com", "trop-court")).toBe(false);
  });

  it("construit une URL absolue contenant canal, contact et jeton", () => {
    const url = buildUnsubscribeUrl("sms", "0612345678");
    expect(url).toContain("canal=sms");
    expect(url).toContain("contact=0612345678");
    expect(url).toMatch(/token=[\w-]+$/);
  });
});
