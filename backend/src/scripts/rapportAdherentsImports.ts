/**
 * Rapport quotidien (cron, voir crontab de l'hôte) : liste les Spelcs ayant
 * importé une liste d'adhérents, avec le nombre d'adhérents, la date du
 * dernier import et qui l'a fait — envoyé par mail via Brevo (clé API déjà
 * configurée dans l'application) plutôt que consulté manuellement sur le
 * serveur. Destinataire fixé en dur (pas de réglage dédié pour ce rapport
 * ponctuel) : changer DESTINATAIRE ci-dessous pour une autre adresse.
 *
 * Usage (dans le conteneur backend) :
 *   npx tsx src/scripts/rapportAdherentsImports.ts
 */
import { db, migrate } from "../db/index.js";
import { getBrevoApiKey, sendBrevoEmails } from "../services/brevo.js";
import { wrapEmailHtml } from "../lib/emailLayout.js";

const DESTINATAIRE = "h.malherbe@spelc.fr";

migrate();

interface Row {
  spelc: string;
  nbAdherents: number;
  dernierImport: string;
  importePar: string | null;
}

async function main() {
  const rows = db
    .prepare(
      `SELECT a.spelc AS spelc, COUNT(*) AS nbAdherents, MAX(a.uploaded_at) AS dernierImport, u.email AS importePar
       FROM adherents a
       LEFT JOIN users u ON u.id = a.uploaded_by
       GROUP BY a.spelc
       ORDER BY a.spelc`
    )
    .all() as Row[];

  const today = new Date().toLocaleDateString("fr-FR");
  const rowsHtml = rows
    .map(
      (r) =>
        `<tr>` +
        `<td style="padding:4px 8px;border-bottom:1px solid #e2e8f0;">${r.spelc}</td>` +
        `<td style="padding:4px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">${r.nbAdherents}</td>` +
        `<td style="padding:4px 8px;border-bottom:1px solid #e2e8f0;">${r.dernierImport}</td>` +
        `<td style="padding:4px 8px;border-bottom:1px solid #e2e8f0;">${r.importePar ?? "(inconnu)"}</td>` +
        `</tr>`
    )
    .join("");

  const html =
    `<p>${rows.length} Spelc(s) ont importé une liste d'adhérents à ce jour (${today}).</p>` +
    `<table style="border-collapse:collapse;width:100%;font-size:14px;">` +
    `<tr style="font-weight:bold;">` +
    `<td style="padding:4px 8px;border-bottom:2px solid #1e293b;">Spelc</td>` +
    `<td style="padding:4px 8px;border-bottom:2px solid #1e293b;text-align:right;">Adhérents</td>` +
    `<td style="padding:4px 8px;border-bottom:2px solid #1e293b;">Dernier import</td>` +
    `<td style="padding:4px 8px;border-bottom:2px solid #1e293b;">Importé par</td>` +
    `</tr>${rowsHtml}</table>`;

  const apiKey = getBrevoApiKey();
  if (!apiKey) {
    console.error("Clé API Brevo non configurée — rapport non envoyé.");
    process.exit(1);
  }

  const result = await sendBrevoEmails({
    apiKey,
    to: [{ email: DESTINATAIRE }],
    subject: `Imports adhérents par Spelc — ${today}`,
    htmlContent: wrapEmailHtml(html),
    tag: "rapport-imports-adherents",
  });

  if (result.sent > 0) {
    console.log(`Rapport envoyé à ${DESTINATAIRE} (${rows.length} Spelc(s)).`);
  } else {
    console.error(`Échec de l'envoi du rapport : ${result.errorMessage ?? "raison inconnue"}.`);
    process.exit(1);
  }
}

main();
