import { describe, expect, it } from "vitest";
import { smsSegmentCount, analyzeSmsEncoding } from "../smsSegments.js";

// Facteur reel constate entre un segment technique et le nombre de credits
// Brevo facture (voir BREVO_CREDITS_PER_SEGMENT_FR_ALPHA) : smsSegmentCount
// estime les CREDITS, pas les segments bruts (voir analyzeSmsEncoding
// ci-dessous pour les segments techniques).
const CREDITS_PER_SEGMENT = 4.5;

describe("smsSegmentCount", () => {
  it("compte 1 segment (4,5 credits) pour un message GSM-7 court (<= 160 caracteres)", () => {
    expect(smsSegmentCount("Jean, pensez a voter avant le 10/12.")).toBe(1 * CREDITS_PER_SEGMENT);
    // Accents couverts par l'alphabet GSM-7 par defaut.
    expect(smsSegmentCount("Jean, pensez à voter à l'école avant le 10/12.")).toBe(1 * CREDITS_PER_SEGMENT);
  });

  it("decoupe en parties de 153 caracteres au-dela d'un seul SMS GSM-7", () => {
    const text160 = "a".repeat(160);
    expect(smsSegmentCount(text160)).toBe(1 * CREDITS_PER_SEGMENT);
    const text161 = "a".repeat(161);
    expect(smsSegmentCount(text161)).toBe(Math.ceil(161 / 153) * CREDITS_PER_SEGMENT);
    const text400 = "a".repeat(400);
    expect(smsSegmentCount(text400)).toBe(Math.ceil(400 / 153) * CREDITS_PER_SEGMENT);
  });

  it("bascule en UCS-2 des qu'un caractere hors GSM-7 apparait (ex. apostrophe typographique)", () => {
    // Message court mais avec une apostrophe typographique (’) au lieu d'une apostrophe simple (').
    const withCurlyApostrophe = "Plus d’info : https://urls.fr/Pr3IRB";
    expect(smsSegmentCount(withCurlyApostrophe)).toBe(1 * CREDITS_PER_SEGMENT); // <= 70 caracteres, reste 1 segment UCS-2
    expect(withCurlyApostrophe.length).toBeLessThanOrEqual(70);
  });

  it("decoupe en parties de 67 caracteres au-dela d'un seul SMS UCS-2", () => {
    const text70 = "é".repeat(70) + "’"; // 71 caracteres, mais tous hors GSM-7 (e accent + apostrophe typo)
    // Verifie d'abord qu'un message UCS-2 de 70 caracteres exactement reste a 1 segment.
    const exact70 = "’".repeat(70);
    expect(smsSegmentCount(exact70)).toBe(1 * CREDITS_PER_SEGMENT);
    const over70 = "’".repeat(71);
    expect(smsSegmentCount(over70)).toBe(Math.ceil(71 / 67) * CREDITS_PER_SEGMENT);
    void text70;
  });

  it("compte les caracteres etendus GSM-7 (ex. €) pour 2 unites", () => {
    // 159 'a' (GSM-7 basique) + 1 '€' (etendu, compte double) = 161 unites GSM-7 -> depasse 160.
    const text = "a".repeat(159) + "€";
    expect(smsSegmentCount(text)).toBe(Math.ceil(161 / 153) * CREDITS_PER_SEGMENT);
  });
});

describe("analyzeSmsEncoding", () => {
  it("un message de 92 caracteres en UCS-2 coute plus que 101 caracteres en GSM-7 (longueur brute non pertinente)", () => {
    // 92 caracteres mais avec une apostrophe typographique -> UCS-2, > 70 -> 2 segments.
    const text92 = "’" + "a".repeat(91);
    const info92 = analyzeSmsEncoding(text92);
    expect(info92.encoding).toBe("UCS-2");
    expect(info92.segments).toBe(2);
    expect(info92.offendingChars).toEqual(["’"]);

    // 101 caracteres, tous GSM-7 -> reste 1 segment malgre une longueur superieure.
    const text101 = "a".repeat(101);
    const info101 = analyzeSmsEncoding(text101);
    expect(info101.encoding).toBe("GSM-7");
    expect(info101.segments).toBe(1);
    expect(info101.offendingChars).toEqual([]);

    expect(text92.length).toBeLessThan(text101.length);
    expect(info92.segments).toBeGreaterThan(info101.segments);
  });

  it("liste chaque caractere fautif une seule fois, dans l'ordre de premiere apparition", () => {
    const info = analyzeSmsEncoding("Plus d’info — vite’");
    expect(info.encoding).toBe("UCS-2");
    expect(info.offendingChars).toEqual(["’", "—"]);
  });

  it("maxCharsPerSegment reflete l'encodage et le nombre de segments", () => {
    expect(analyzeSmsEncoding("a".repeat(160)).maxCharsPerSegment).toBe(160);
    expect(analyzeSmsEncoding("a".repeat(161)).maxCharsPerSegment).toBe(153);
    expect(analyzeSmsEncoding("’".repeat(70)).maxCharsPerSegment).toBe(70);
    expect(analyzeSmsEncoding("’".repeat(71)).maxCharsPerSegment).toBe(67);
  });
});
