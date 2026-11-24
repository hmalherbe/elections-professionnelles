import { describe, expect, it } from "vitest";
import { smsSegmentCount } from "../smsSegments.js";

describe("smsSegmentCount", () => {
  it("compte 1 pour un message GSM-7 court (<= 160 caractères)", () => {
    expect(smsSegmentCount("Jean, pensez a voter avant le 10/12.")).toBe(1);
    // Accents couverts par l'alphabet GSM-7 par defaut.
    expect(smsSegmentCount("Jean, pensez à voter à l'école avant le 10/12.")).toBe(1);
  });

  it("decoupe en parties de 153 caracteres au-dela d'un seul SMS GSM-7", () => {
    const text160 = "a".repeat(160);
    expect(smsSegmentCount(text160)).toBe(1);
    const text161 = "a".repeat(161);
    expect(smsSegmentCount(text161)).toBe(Math.ceil(161 / 153));
    const text400 = "a".repeat(400);
    expect(smsSegmentCount(text400)).toBe(Math.ceil(400 / 153));
  });

  it("bascule en UCS-2 des qu'un caractere hors GSM-7 apparait (ex. apostrophe typographique)", () => {
    // Message court mais avec une apostrophe typographique (’) au lieu d'une apostrophe simple (').
    const withCurlyApostrophe = "Plus d’info : https://urls.fr/Pr3IRB";
    expect(smsSegmentCount(withCurlyApostrophe)).toBe(1); // <= 70 caracteres, reste 1 segment UCS-2
    expect(withCurlyApostrophe.length).toBeLessThanOrEqual(70);
  });

  it("decoupe en parties de 67 caracteres au-dela d'un seul SMS UCS-2", () => {
    const text70 = "é".repeat(70) + "’"; // 71 caracteres, mais tous hors GSM-7 (e accent + apostrophe typo)
    // Verifie d'abord qu'un message UCS-2 de 70 caracteres exactement reste a 1 segment.
    const exact70 = "’".repeat(70);
    expect(smsSegmentCount(exact70)).toBe(1);
    const over70 = "’".repeat(71);
    expect(smsSegmentCount(over70)).toBe(Math.ceil(71 / 67));
    void text70;
  });

  it("compte les caracteres etendus GSM-7 (ex. €) pour 2 unites", () => {
    // 159 'a' (GSM-7 basique) + 1 '€' (etendu, compte double) = 161 unites GSM-7 -> depasse 160.
    const text = "a".repeat(159) + "€";
    expect(smsSegmentCount(text)).toBe(Math.ceil(161 / 153));
  });
});
