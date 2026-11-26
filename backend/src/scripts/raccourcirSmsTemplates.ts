/**
 * Raccourcit les formulations fixes des modèles SMS de tous les Spelcs pour
 * repasser sous le seuil d'un segment GSM-7 (160 caractères) plus souvent
 * (voir lib/smsSegments.ts — un dépassement double le coût : 2 segments x
 * 4,5 crédits Brevo au lieu de 1 segment). Ne touche jamais le texte propre
 * à chaque Spelc (prénom, statut de vote, échéances) : seulement deux
 * tournures de structure communes à tous les modèles, remplacées par un
 * équivalent plus court et tout aussi clair.
 *
 * Remplacements (uniquement si le texte exact est présent, jamais de devinette) :
 *   "Plus d'info : "      -> "Infos : "  (-6 caractères)
 *   "Se désinscrire : "   -> "Stop : "   (-10 caractères)
 *   "avant le JJ/MM"      -> "avant JJ/MM" (-3 caractères ; ne touche jamais
 *                            la ponctuation qui suit, pour ne jamais risquer
 *                            de recoller deux phrases)
 *
 * Affiche pour chaque Spelc la longueur/encodage/segments/crédits estimés
 * avant et après (voir lib/smsSegments.ts, mêmes fonctions que l'aperçu dans
 * l'appli), avant d'écrire en base — aucune mise à jour si rien ne change.
 *
 * Usage (dans le conteneur backend) :
 *   npx tsx src/scripts/raccourcirSmsTemplates.ts        # aperçu + applique
 *   npx tsx src/scripts/raccourcirSmsTemplates.ts --dry-run   # aperçu seul
 */
import { db, migrate } from "../db/index.js";
import { analyzeSmsEncoding, smsSegmentCount } from "../lib/smsSegments.js";

const DRY_RUN = process.argv.includes("--dry-run");

migrate();

function raccourcir(body: string): string {
  return body
    .replaceAll("Plus d'info : ", "Infos : ")
    .replaceAll("Se désinscrire : ", "Stop : ")
    .replace(/\bavant le (\d{1,2}\/\d{1,2})\b/gi, "avant $1");
}

function diagnostic(label: string, body: string): string {
  const a = analyzeSmsEncoding(body);
  const credits = smsSegmentCount(body);
  return `${label} : ${body.length} car. / ${a.maxCharsPerSegment} max/segment (${a.encoding}) / ${a.segments} segment(s) / ${credits} crédit(s) estimé(s)`;
}

interface Row {
  spelc: string;
  body: string;
}

function main() {
  const rows = db.prepare("SELECT spelc, body FROM sms_templates ORDER BY spelc").all() as Row[];

  const update = db.prepare(
    "UPDATE sms_templates SET body = ?, updated_at = datetime('now') WHERE spelc = ?"
  );

  let nbModifies = 0;
  for (const { spelc, body } of rows) {
    const nouveau = raccourcir(body);
    if (nouveau === body) {
      console.log(`${spelc} : rien à raccourcir (aucune des formulations ciblées trouvée).`);
      continue;
    }
    nbModifies++;
    console.log(`\n--- ${spelc} ---`);
    console.log(diagnostic("Avant", body));
    console.log(diagnostic("Après", nouveau));
    if (!DRY_RUN) {
      update.run(nouveau, spelc);
    }
  }

  console.log(
    `\n${nbModifies}/${rows.length} Spelc(s) ${DRY_RUN ? "seraient modifiés (--dry-run, rien écrit en base)" : "modifiés en base"}.`
  );
}

main();
