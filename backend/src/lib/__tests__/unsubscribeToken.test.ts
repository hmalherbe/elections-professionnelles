import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildUnsubscribeUrl,
  canalFromContact,
  expandContactParam,
  unsubscribeToken,
  verifyUnsubscribeToken,
} from "../unsubscribeToken.js";

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

  it("rejette un jeton de longueur différente (ni 8 ni 12) sans lever d'exception", () => {
    expect(verifyUnsubscribeToken("test@example.com", "trop-court")).toBe(false);
  });

  it("accepte un ancien jeton de 12 caractères (liens déjà envoyés avant le raccourcissement)", () => {
    // Même construction que l'ancien unsubscribeToken() (avant son passage à 8
    // caractères) : un préfixe plus long de la même signature HMAC.
    const secret = process.env.SCRAPING_SECRET_KEY || process.env.JWT_SECRET || "dev-secret-change-me";
    const legacyToken = crypto.createHmac("sha256", secret)
      .update("0612345678")
      .digest("base64url")
      .slice(0, 12);
    expect(verifyUnsubscribeToken("0612345678", legacyToken)).toBe(true);
    // Un jeton de 12 caractères altéré doit rester rejeté.
    const altered = legacyToken.slice(0, -1) + (legacyToken.at(-1) === "A" ? "B" : "A");
    expect(verifyUnsubscribeToken("0612345678", altered)).toBe(false);
  });

  it("construit une URL courte avec le contact (indicatif français retiré) et un jeton de 8 caractères", () => {
    const url = buildUnsubscribeUrl("33612345678");
    expect(url).toContain("/u/612345678/");
    expect(url).toMatch(/\/u\/612345678\/[\w-]{8}$/);
  });

  it("encode un contact mail dans l'URL (jamais d'indicatif à retirer)", () => {
    const url = buildUnsubscribeUrl("test@example.com");
    expect(url).toContain(`/u/${encodeURIComponent("test@example.com")}/`);
  });
});

describe("expandContactParam", () => {
  it("reconstruit un mobile français à partir du segment d'URL (sans indicatif)", () => {
    expect(expandContactParam("612345678")).toBe("33612345678");
  });

  it("décode un contact mail inchangé", () => {
    expect(expandContactParam(encodeURIComponent("test@example.com"))).toBe("test@example.com");
  });

  it("est l'inverse exact de buildUnsubscribeUrl pour un mobile", () => {
    const contact = "33612345678";
    const url = buildUnsubscribeUrl(contact);
    const [, contactParam] = url.match(/\/u\/([^/]+)\//)!;
    expect(expandContactParam(contactParam)).toBe(contact);
  });
});
