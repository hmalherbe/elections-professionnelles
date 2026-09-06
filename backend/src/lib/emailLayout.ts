/**
 * Sans contrainte de largeur, le corps du mail (logo + texte + réseaux
 * sociaux) s'étale sur toute la largeur disponible chez le destinataire
 * (souvent bien plus large que le texte lui-même dans Thunderbird ou
 * Outlook.com) : le logo, centré dans ce conteneur sans limite, se
 * retrouve visuellement décalé par rapport au texte, qui lui ne remplit
 * qu'une partie de cette largeur. On enferme donc tout le contenu dans une
 * colonne de largeur fixe centrée sur la page (technique de table
 * imbriquée, la plus fiable pour centrer en HTML mail, y compris sur les
 * clients qui ignorent `max-width`/`margin:auto`) : le logo et le texte se
 * retrouvent alignés sur la même colonne.
 */
const EMAIL_COLUMN_WIDTH = 600;

export function wrapEmailHtml(bodyHtml: string): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">` +
    `<tr><td align="center" style="padding:0;">` +
    `<table role="presentation" width="${EMAIL_COLUMN_WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:${EMAIL_COLUMN_WIDTH}px;max-width:${EMAIL_COLUMN_WIDTH}px;">` +
    `<tr><td style="text-align:left;">${bodyHtml}</td></tr>` +
    `</table>` +
    `</td></tr>` +
    `</table>`
  );
}
