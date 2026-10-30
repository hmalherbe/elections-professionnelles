/**
 * Sans contrainte de largeur, le corps du mail (logo + texte + réseaux
 * sociaux) s'étale sur toute la largeur disponible chez le destinataire
 * (souvent bien plus large que le texte lui-même dans Thunderbird ou
 * Outlook.com) : le logo, centré dans ce conteneur sans limite, se
 * retrouve visuellement décalé par rapport au texte, qui lui ne remplit
 * qu'une partie de cette largeur. On enferme donc tout le contenu dans une
 * colonne de largeur fixe centrée sur la page (technique de table
 * imbriquée, la plus fiable pour centrer en HTML mail, y compris sur les
 * clients qui ignorent `max-width`/`margin:auto`).
 */
const EMAIL_COLUMN_WIDTH = 600;

export function wrapEmailHtml(bodyHtml: string): string {
  // Les retours à la ligne saisis dans le modèle sont de simples "\n" : en
  // HTML un saut de ligne brut est ignoré (fusionné en un espace), donc sans
  // cette conversion explicite en <br>, le texte suivant resterait collé à
  // la phrase précédente au lieu d'apparaître sur sa propre ligne.
  const withLineBreaks = bodyHtml.replace(/\n/g, "<br>");
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">` +
    `<tr><td align="center" style="padding:0;">` +
    `<table role="presentation" width="${EMAIL_COLUMN_WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:${EMAIL_COLUMN_WIDTH}px;max-width:${EMAIL_COLUMN_WIDTH}px;">` +
    `<tr><td style="text-align:left;">${withLineBreaks}</td></tr>` +
    `</table>` +
    `</td></tr>` +
    `</table>`
  );
}
