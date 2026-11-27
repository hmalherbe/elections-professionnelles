/**
 * Génère un fichier d'émargements "jour 2" à partir d'un fichier "jour 1"
 * du scénario de test (voir genererScenarioTest.ts) : copie tel quel,
 * sauf pour les personnes désignées (nom/prénom, insensible à la casse et
 * aux accents) dont le dateEmargement passe de null à une date du jour
 * indiqué — pour tester qu'une relance ultérieure ne cible plus quelqu'un
 * qui a voté depuis (sans dépendre du modèle probabiliste du générateur,
 * qui n'avait jamais prévu de jour 2 pour un scénario généré avec
 * --jours 1).
 *
 * Usage (dans le conteneur backend) :
 *   npx tsx src/scripts/genererJour2Test.ts <jour-1.json> <jour-2.json> <jour> "<nom>:<prenom>" ["<nom>:<prenom>" ...]
 *
 * Exemple :
 *   npx tsx src/scripts/genererJour2Test.ts \
 *     /app/data/scenario-test/emargements/localhost/1D/jour-1.json \
 *     /app/data/scenario-test/emargements/localhost/1D/jour-2.json \
 *     2 "RICHARD:AMELIE"
 */
import fs from "node:fs";

const [inputPath, outputPath, jourStr, ...cibles] = process.argv.slice(2);
if (!inputPath || !outputPath || !jourStr || cibles.length === 0) {
  console.error(
    'Usage : npx tsx src/scripts/genererJour2Test.ts <jour-1.json> <jour-2.json> <jour> "<nom>:<prenom>" [...]'
  );
  process.exit(1);
}
const jour = Number(jourStr);

function stripAccents(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim();
}

const ciblesNorm = new Set(
  cibles.map((c) => {
    const [nom, prenom] = c.split(":");
    return `${stripAccents(nom ?? "")}|${stripAccents(prenom ?? "")}`;
  })
);

function formatDateEmargement(j: number): string {
  const base = new Date(Date.UTC(2026, 11, 2)); // même base que genererScenarioTest.ts (jour 1 = 2026-12-03)
  base.setUTCDate(base.getUTCDate() + j);
  const yyyy = base.getUTCFullYear();
  const mm = String(base.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(base.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd} 09:30:00`;
}

const raw = JSON.parse(fs.readFileSync(inputPath, "utf-8"));
const items = raw.items ?? raw;

let nbMarques = 0;
for (const item of items) {
  const key = `${stripAccents(item.nomUsage ?? item.nomFamille ?? "")}|${stripAccents(item.prenom ?? "")}`;
  if (ciblesNorm.has(key) && !item.dateEmargement) {
    item.dateEmargement = formatDateEmargement(jour);
    nbMarques++;
    console.log(`Marqué votant (jour ${jour}) : ${item.nomUsage} ${item.prenom}`);
  }
}

fs.writeFileSync(outputPath, JSON.stringify({ totalCount: items.length, items }, null, 2), "utf-8");
console.log(`\n${nbMarques}/${cibles.length} cible(s) trouvée(s) et marquée(s) comme votant(e) dans "${outputPath}".`);
if (nbMarques < cibles.length) {
  console.log("Les cibles manquantes ne sont pas dans ce fichier (essayer l'autre degré 1D/2D) ou votaient déjà.");
}
