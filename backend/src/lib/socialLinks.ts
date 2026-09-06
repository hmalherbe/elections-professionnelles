export const SOCIAL_NETWORKS = ["facebook", "twitter", "instagram", "linkedin", "youtube"] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

const NETWORK_LABELS: Record<SocialNetwork, string> = {
  facebook: "Facebook",
  twitter: "X / Twitter",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  youtube: "YouTube",
};

export type SocialLinks = Partial<Record<SocialNetwork, { enabled: boolean; url: string }>>;

export function parseSocialLinks(raw: string | null): SocialLinks {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as SocialLinks;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Petits pictogrammes ronds (PNG 96x96 encodés en data URI, affichés à 24px)
 * pour chaque réseau - pas les logos de marque déposés, des pictogrammes
 * génériques (lettre ou symbole) suffisamment reconnaissables pour identifier
 * le réseau, intégrés en base64 pour s'afficher dans n'importe quel client
 * mail sans dépendre d'une image hébergée en externe.
 */
const NETWORK_ICON_DATA_URI: Record<SocialNetwork, string> = {
  facebook: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAADk0lEQVR4nO2dPWgUQRiG3937MyYxYASTgIIWIsRGYiEiItjaayFqoYWVaJPeypSCpYWovZUgIv40gn0stLA1aZMiMV5yVpfc7e3uze7O7PfN7vvUd7cz7zPfN3tzx10AD5hb3ujled7aypHA9lhso26AecM2RZsUFYNxHXoSGmSIDUAq9CSkZJR+UW3BRylbRGkX0x58lLJEOL+Ib8FHcS3C2Yv7HnwUVyJCFy9atfABd3OyLqCK4fdxMTdrZVXl4OOw1ZKsVEDdwgfszbmwgDqG38fG3AsJqHP4fYpmkFsAwz+gSBa5BDD8UfJmklkAw08mTzaZBDD88WTNyFgAwzcnS1ZOjiKIOUYCuPqzY5rZWAEMPz8m2aWeZ2gOv9UArp5pYulkA+cWQpyaDTF9KMBUB5hopR/TPPu0g6cf/pY00vRzo2Zpo7DEdCfAo2tt3Fhq4eik+GfqhUlsQRpX/6XTDXx9PIkHV9pehZ+WpTcVcP5EA6/vTuBw25/gTYitAG2rv9MEXtzyO/ykTL14H3DnYhsLM/6Gn8aIAG2rHwBuXmhJD8EKcdmq3wOOTQU4e9y8UD//6uL5lx2s/tnD5nYPPXXLaZihmWlc/YvzDQSG3efn+h5uv9zCt9+72NjSGX40Y/V7wGyG2833P7ro7jkcjAPUC5iZMH/s+qZn6WNAgMb2AwDNhnkF7HqS/2DW6iug6uwvLw0V8PHhJBbn3a6Jd6td3Huz5fQaJvQP6EJAR/h1o585W5AwFCAMBQhDAcKE3IDlmFve6LEChAm0V8D9y208ud4xeuzy2228+v7P8YjswgoQhgKEoQBhKEAYChCGAoShAGEoQBgKEIYChKEAYUINP1xXV9ZWjgSsAGEoQBgKEIYChAkBHb8gWzeGvphF5KAAYfYFsA2Vx2DWrABhKECYIQFsQ+6JZswKEGZEAKvAHXHZxoat/dtyvhInILYFsQrsk5Qp9wBhEgWwCuyRliUrQJhUAayC4ozLcGwFUEJ+TLIzakGUkB3TzLgHCGMsgFVgTpasMlUAJYwna0aZWxAlJJMnm1x7ACWMkjeT3JswJRxQJItCd0GUUDyDwrehdZZgY+5W3gfUUYKtOVsPruof5thebNbfCVe5GlzMzclRRBUluJoT/9J8DN7+pXkU30SUVcWltwrtIspun2K9WpsIqX1LxWYpJUPDzYL4AKK4lqEh9EFUDSaJvFK0hR3Hf/vnKwo9tUCBAAAAAElFTkSuQmCC",
  twitter: "data:image/png;base64,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",
  instagram: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAADiUlEQVR4nO2d3VXsMAyEvXuoA1qAvqAa6AtaYBuBJ0OO147/JM040fd4z2Vjz1iS5WSzl7AA38+vPyN/9/T1cZEeizR0AxwVuxU2UygGoy16CQYzYANAiV4CZYb5RdmET7E2wuxi7MKnWBmhfpHVhE/RNkLtw1cXPkXLiKvGhx5N/BD05iRuwBHFj2jMTSysjix8DqmUJBIBZxM/BLk5TxtwRvEjEnOfMuDM4kdmNRg2wMX/Z0aLIQNc/HtGNek2wMUvM6JNlwEufp1ejZoNcPHb6dFK5SjCaafJAF/9/bRqVjXAxR+nRbtdA1z8eWoaeg0AUzTAV78ce1p6BIDJGuCrX56Sph4BYO7u6iBX/+Pnu9m1bi9vZtfakt5Je4CMYoOl6KXroswIIUlB1qsfJX6K5ThSjSERwCL8ljgm62gwL8KM4m+xHt9fQbBIP7XJWa4+9FhiMYYX4RAwRTBeEx2RZimoNFHkDmRPfCtjriHopx9G8VvQNCFqDuuE0eKjU0+Eogb0sice2the1A3IiTUiUuuKle5wHz/fVU1d4jBuNF2sECkPzEfPEnka1eG28P38+kMbAdJFspQK0cZQFuGZLrW2t8/97fbfrHdHlAaUaFmtLB1uK3QpSKppK/1/NmOoDJDumFcwgcqAHLNFEl1ka9AbcHRoDJDqmHPkPoclDdEYcFbcADBuABg3AIwbAObK8OK6s/L09XGhiQDNraLmFncWGgPOCr0Bs1HA0nCVoDJA+vBshcdhriFwvEE2ImUCu/hUjya20nJ/lz3lpFAacHt5U3lskGX1b/mrAUxpKAR5sZjE32pNGQERifu7TMLnoNoFlZC+JcmEybckpTtRrSfeLDpmum9JjrDCym7lLgVZFWO27aLFeHLamtQA9sdDkE1b1gCNKGA1wUr8kqYUNQDxBDPa+MjuSrfaEbFhtfpDAPQB7DsY6/FVc73mFziYokFL+Fo9rUaA5raUJRpQ4ofQ8QsaDK8ykMTqVQQ1KHZBEZaIsKS5CLMdVzPTo1XXLshNqNOrUfc21E0oM6LNUB/gJtwzqslwI+Ym/DOjxVQn7CbMazB9FHFmEyTmLnIWdEYTpOYsLhzzyz8kkF5s4qehR44GjbmpHEcf0QStOflPmldY9ifNU1YzwiqKzVMFuxHW6ROWq9mMQNUtimKJMoNhswAfQIq2GQyib6EaTIlRU9jEzvELVjCpxbfY05AAAAAASUVORK5CYII=",
  linkedin: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAADGUlEQVR4nO3dPWgTcRzG8efOtCEtUiVaa30FKbUooiCIoB3ESSm4iIOT1TooUkcHd8XdpUhEHXRy0sFJqODL4FBUtFZQalGsWKuNaYNp4pSSNrmX/JPLU/88n7F3R4/f9/6XawmJA0MtZ4cLpsfaKDPU65gcV9VBGno41cQItaMGbyZMCDdoBw3fXJjZ+QbQ8GsXNEPPABp+/fjNsmIADb/+vGZaFkDDj06l2bpBO0h9LZ2x67VBolM668DHUImWC+jqZyjOXCuATAHIHN1+uLQCyBSATAHIFIBMAcgUgEwByBSATAHIFIBMAcgUgEwByBSATAHIFIBMAcgUgCzG+sWp/m6c2Ndecdvp1CjuvZhs8BlxaAWQKQCZApApAJneF0SmFUBGewyNWtMKB0d2JXFyfzt6OluxYXUzMtk8Jn5m8fjdNFLDXzH2bZZ9mrxbkOnfAWGO27t1JW70d6NrXcLz9+fyBVx9OI4rD8arP/k6sm4F9O1O4tbAdsRj/nfXmOvgct8WAKBGsOo14EBXG24P9AQOv9Slo5uxc2NrhGflz6oApw52oDlW3Uc2xFwH5w51RnRGwawKUPT2SwbHr7/B+ovP0DH4FGdujmI6k/Pc/9ieNXCMPmqjdta9Brya+IPD10aQzs4v/Ozu80lMpXO4f2FHxWPaWmLYtjaBD5ONfyqybgWcvzO2aPhFj15P4Uf6r+dxm5LxKE/Lk1UBRj6n8fLTjOd2vyt8VYJzM7AqwJP3v3y3/54tXxlF8SbOKKwK8PH7nO/2bC7foDMJz6oAM3PeVzgAzOeX3/8drQoQNODC8pu/XQH+RwpApgBkCkCmAGQKQKYAZApApgBkCkCmN2aRaQWQKQCZApApAJkCkCkAmQKQKQCZApApAJkCkCkAmQKQKQCZApApAJkCkCkAmWv6TdBSu8xQr6MVQKYAZC5g/oX0Yq44c60AsoUAWgWNUzpr12uDRGPpjMtuQYoQnUqzrfgaoAj15zVTzxdhRagfv1n6PgUpQu2CZhj4GKoI5sLMrqrh6q3s4VRz0Rpf3YqxmOmd4h8PototoTUoYwAAAABJRU5ErkJggg==",
  youtube: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAACDUlEQVR4nO2dQXKDMBAEByr//zI5uDZFbAsQCLS76r46Jqluj+xLsAQAAAAAAAAwElOrCy3S0upaEZgaubt0kdGkl7gSo/qJSN+mNsZc88PI36fW0aFaiD/HkTXsLgD55znibjMA8q+z57AYAPnt2HL5NQDy21Ny+hEA+ffxzW3Vx1Boz78AvPrv593xXHoA7mPtmiOoMwTozCxx/PTAnLOAzhCgM7Pr42fx+6e1YJEW/wtIHsF/AOkVIWmIGAGMhBFiBZDSrSFeACNJhLgBpBRriB3ACBwhRwAp7BryBDCCRcgXQAq1hpwBjAARcgeQ3K8hfwDDaYRxAkgu1zBWAMNRhDEDSG7WMG4Ao3MEAkhd10CANR0iEOCdh9fw89hvisLU7D93D8EC1jwsX2IBLzqIN1hAR/nSyAvoLN4YcwFO5EujLcCReGOcBTiUL42wAKfijdwLcC5fyrqAAOKNfAsIJF/KtIBg4o0cCwgqX4q+gMDijbgLSCBfiriAJOKNWAtIJl+KsoCE4o251R1gbyOx/EmafB9BieUbvgMMwCy1uxE1HMecs4DOEKAzfwE4hp5j7XouPQD38O6YI6gzHwFYwX18c/t1AURoT8lp8QgiQju2XG6+BxDhOnsOd9+EiXCeI+6q5Lq+w6Ijal60VR9DWcM+tY74IrcGPPpFbiVGi8FpAAAAAAAAAHCGXwXadJJl0Pz2AAAAAElFTkSuQmCC",
};

/**
 * Bloc HTML de pied de mail listant les réseaux sociaux cochés (avec une URL
 * renseignée), sous forme de petits logos cliquables plutôt que de liens
 * texte - alt renseigné pour rester lisible si les images sont bloquées par
 * le client mail.
 */
export function buildSocialLinksHtml(links: SocialLinks): string {
  const active = SOCIAL_NETWORKS.filter((n) => links[n]?.enabled && links[n]?.url?.trim());
  if (active.length === 0) return "";
  const items = active
    .map(
      (n) =>
        `<a href="${links[n]!.url.trim()}" style="display:inline-block;margin-right:10px;line-height:0;">` +
        `<img src="${NETWORK_ICON_DATA_URI[n]}" width="24" height="24" alt="${NETWORK_LABELS[n]}" style="border-radius:50%;vertical-align:middle;" />` +
        `</a>`
    )
    .join("");
  return `<div style="margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;">Suivez-nous : ${items}</div>`;
}

export function buildLogoHtml(logoDataUri: string | null): string {
  if (!logoDataUri) return "";
  return `<div style="margin-bottom:16px;"><img src="${logoDataUri}" alt="Logo" style="max-height:80px;max-width:280px;" /></div>`;
}
