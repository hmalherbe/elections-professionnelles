import { describe, expect, it } from "vitest";
import { renderTemplate, buildIfTestCases, type TemplateFields } from "../template.js";

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

describe("renderTemplate — échappement HTML (format)", () => {
  it("n'échappe rien par défaut (objet du mail, SMS)", () => {
    const out = renderTemplate("Bonjour {{prenom}}", fields({ prenom: "<script>alert(1)</script>" }));
    expect(out).toBe("Bonjour <script>alert(1)</script>");
  });

  it("n'échappe rien en format \"text\" explicite", () => {
    const out = renderTemplate("Bonjour {{prenom}}", fields({ prenom: "<b>x</b> & y" }), "text");
    expect(out).toBe("Bonjour <b>x</b> & y");
  });

  it("échappe un champ provenant d'un fichier importé (nom/prénom) en format \"html\"", () => {
    const out = renderTemplate(
      "Bonjour {{prenom}} {{nom}}",
      fields({ prenom: '<img src=x onerror="alert(1)">', nom: "A & B" }),
      "html"
    );
    expect(out).toBe("Bonjour &lt;img src=x onerror=&quot;alert(1)&quot;&gt; A &amp; B");
    expect(out).not.toContain("<img");
  });

  it("n'échappe jamais logo_spelc/logo_rugby/reseaux_sociaux (HTML construit par l'application)", () => {
    const out = renderTemplate(
      "{{logo_spelc}}{{logo_rugby}}{{reseaux_sociaux}}",
      fields({ logo_spelc: '<img src="a.png">', logo_rugby: '<img src="b.png">', reseaux_sociaux: '<a href="x">y</a>' }),
      "html"
    );
    expect(out).toBe('<img src="a.png"><img src="b.png"><a href="x">y</a>');
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

describe("buildIfTestCases", () => {
  it("un seul cas, sans override, pour un modèle sans #if", () => {
    const cases = buildIfTestCases("Bonjour {{prenom}}, votez avant le 10/12.");
    expect(cases).toEqual([{ label: "Aperçu", overrides: {} }]);
  });

  it("un cas par condition distincte, chacun rendant sa propre branche", () => {
    const cases = buildIfTestCases(TEMPLATE);
    expect(cases).toHaveLength(3);

    for (const { overrides } of cases) {
      const out = renderTemplate(TEMPLATE, fields(overrides as Partial<TemplateFields>));
      // Toujours exactement un des trois blocs qui s'affiche (jamais zéro, jamais deux à la fois).
      const blocksShown = ["scrutins CCMMEP et", "au scrutin CCMMEP.", "au scrutin CCMI."].filter((s) => out.includes(s));
      expect(blocksShown).toHaveLength(1);
    }
  });

  it("dédoublonne les conditions identiques répétées", () => {
    const cases = buildIfTestCases("{{#if votant}}a{{/if}} {{#if votant}}b{{/if}}");
    expect(cases).toHaveLength(1);
  });

  it("choisit la combinaison avec le moins de valeurs vraies qui satisfait l'expression", () => {
    // "a or b" : la combinaison minimale qui le satisfait n'active qu'un seul des deux (jamais a=true ET b=true).
    const cases = buildIfTestCases("{{#if a or b}}x{{/if}}");
    expect(cases).toHaveLength(1);
    expect(Object.values(cases[0].overrides).filter(Boolean)).toHaveLength(1);
  });
});
