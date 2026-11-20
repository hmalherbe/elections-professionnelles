import { describe, expect, it } from "vitest";
import { buildBannerHtml, buildLogoHtml } from "../socialLinks.js";

describe("buildLogoHtml", () => {
  it("renvoie une chaîne vide sans logo", () => {
    expect(buildLogoHtml(null)).toBe("");
  });

  it("préfixe un chemin relatif par PUBLIC_BASE_URL et fixe la taille à 250x250 (table + attributs + !important)", () => {
    const html = buildLogoHtml("/api/uploads/logos/mon-spelc.png");
    expect(html).toContain("/api/uploads/logos/mon-spelc.png");
    expect(html).toContain("<table");
    expect(html.match(/width="250"/g)?.length).toBe(2); // <td> et <img>
    expect(html.match(/height="250"/g)?.length).toBe(2);
    expect(html).toContain("width:250px !important");
    expect(html).toContain("height:250px !important");
  });

  it("conserve une data URI historique telle quelle", () => {
    const html = buildLogoHtml("data:image/png;base64,abc123");
    expect(html).toContain("src=\"data:image/png;base64,abc123\"");
  });
});

describe("buildBannerHtml", () => {
  it("rend une bannière pleine largeur, sans plafond de hauteur fixe, avec l'alt fourni", () => {
    const html = buildBannerHtml("/api/assets/logo/rugby.png", "Transformez l'essai ! Votez 2 fois Spelc");
    expect(html).toContain("/api/assets/logo/rugby.png");
    expect(html).toContain("alt=\"Transformez l'essai ! Votez 2 fois Spelc\"");
    expect(html).toContain("width:100%");
    expect(html).toContain("max-width:600px");
    expect(html).not.toContain("max-height");
  });
});
