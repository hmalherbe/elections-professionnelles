import { describe, expect, it } from "vitest";
import { renderTemplate, type TemplateFields } from "../template.js";

function fields(overrides: Partial<TemplateFields>): TemplateFields {
  return {
    nom: "DUPONT",
    prenom: "JEAN",
    scrutin_local: "CCMI",
    CCMMEP_non_votant: false,
    scrutin_local_non_votant: false,
    scrutin: "CCMI",
    votant: true,
    ...overrides,
  };
}

const TEMPLATE =
  "Bonjour {{prenom}} {{nom}}, merci de voter" +
  "{{#if CCMMEP_non_votant and scrutin_local_non_votant}} aux scrutins CCMMEP et {{scrutin_local}}{{/if}}" +
  "{{#if CCMMEP_non_votant and not(scrutin_local_non_votant)}} au scrutin CCMMEP{{/if}}" +
  "{{#if not(CCMMEP_non_votant) and scrutin_local_non_votant}} au scrutin {{scrutin_local}}{{/if}}.";

describe("renderTemplate — substitution simple", () => {
  it("remplace les champs simples", () => {
    expect(renderTemplate("Bonjour {{prenom}} {{nom}}", fields({ prenom: "MARIE", nom: "CURIE" }))).toBe(
      "Bonjour MARIE CURIE"
    );
  });

  it("rend une chaîne vide pour un champ absent", () => {
    expect(renderTemplate("x{{inconnu}}y", fields({}))).toBe("xy");
  });
});

describe("renderTemplate — expressions booléennes (and/or/not)", () => {
  it("n'a voté nulle part -> les deux scrutins", () => {
    const out = renderTemplate(TEMPLATE, fields({ CCMMEP_non_votant: true, scrutin_local_non_votant: true }));
    expect(out).toContain("aux scrutins CCMMEP et CCMI.");
  });

  it("a voté au local seulement -> relance CCMMEP uniquement", () => {
    const out = renderTemplate(TEMPLATE, fields({ CCMMEP_non_votant: true, scrutin_local_non_votant: false }));
    expect(out).toContain("au scrutin CCMMEP.");
    expect(out).not.toContain("scrutins CCMMEP et");
  });

  it("a voté au CCMMEP seulement -> relance le scrutin local uniquement", () => {
    const out = renderTemplate(
      TEMPLATE,
      fields({ CCMMEP_non_votant: false, scrutin_local_non_votant: true, scrutin_local: "CCMA" })
    );
    expect(out).toContain("au scrutin CCMA.");
  });

  it("a voté partout -> aucun des trois blocs ne s'affiche", () => {
    const out = renderTemplate(TEMPLATE, fields({ CCMMEP_non_votant: false, scrutin_local_non_votant: false }));
    expect(out).toBe("Bonjour JEAN DUPONT, merci de voter.");
  });

  it("gère les parenthèses explicites autour d'une négation", () => {
    const out = renderTemplate(
      "{{#if (not(votant))}}relance{{else}}rien{{/if}}",
      fields({ votant: false })
    );
    expect(out).toBe("relance");
  });

  it("gère else", () => {
    expect(renderTemplate("{{#if votant}}a{{else}}b{{/if}}", fields({ votant: true }))).toBe("a");
    expect(renderTemplate("{{#if votant}}a{{else}}b{{/if}}", fields({ votant: false }))).toBe("b");
  });
});
