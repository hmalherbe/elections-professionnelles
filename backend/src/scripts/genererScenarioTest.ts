/**
 * Génère un scénario de test complet pour la sandbox : 2 académies fictives
 * ("localhost" et "Académie Test Beta"), chacune avec un Spelc dédié, une
 * population d'électeurs 1D/2D qui votent de façon aléatoire au fil de
 * plusieurs jours (fichiers d'émargements cumulatifs, au format réel du
 * fichier des électeurs CCMMEP), une liste d'adhérents pour chaque Spelc, et
 * un plan de relances mail/SMS (voir simulerRelancesTest.ts) qui fait
 * remonter la participation des adhérents après chaque relance — sans jamais
 * appeler Brevo.
 *
 * Ne touche à aucune base de données : génère uniquement des fichiers, à
 * importer ensuite via l'interface (onglets Imports et Adhérents de l'admin
 * général). Les deux académies fictives doivent d'abord exister dans les
 * référentiels (voir scenarioTestReferentiel.ts).
 *
 * Usage : npx tsx src/scripts/genererScenarioTest.ts --out <dossier> [--seed N] [--jours N]
 */
import fs from "node:fs";
import path from "node:path";

interface Args {
  out: string;
  seed: number;
  jours: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string, fallback?: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const out = get("--out");
  if (!out) throw new Error("Argument requis : --out <dossier>");
  return { out, seed: Number(get("--seed", "42")), jours: Number(get("--jours", "5")) };
}

/** PRNG déterministe (mulberry32) : même seed -> mêmes fichiers, reproductible. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function shuffle<T>(rng: () => number, arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const NOMS = [
  "MARTIN", "BERNARD", "THOMAS", "PETIT", "ROBERT", "RICHARD", "DURAND", "DUBOIS", "MOREAU", "LAURENT",
  "SIMON", "MICHEL", "LEFEBVRE", "LEROY", "ROUX", "DAVID", "BERTRAND", "MOREL", "FOURNIER", "GIRARD",
  "BONNET", "DUPONT", "LAMBERT", "FONTAINE", "ROUSSEAU", "VINCENT", "MULLER", "LEFEVRE", "FAURE", "ANDRE",
  "MERCIER", "BLANC", "GUERIN", "BOYER", "GARNIER", "CHEVALIER", "FRANCOIS", "LEGRAND", "GAUTHIER", "GARCIA",
  "PERRIN", "ROBIN", "CLEMENT", "MORIN", "NICOLAS", "HENRY", "ROUSSEL", "MATHIEU", "GAUTIER", "MASSON",
];
const PRENOMS_M = [
  "JEAN", "PIERRE", "MICHEL", "ALAIN", "PHILIPPE", "CHRISTOPHE", "DANIEL", "ERIC", "PATRICK", "NICOLAS",
  "STEPHANE", "PASCAL", "THIERRY", "LAURENT", "FRANCOIS", "OLIVIER", "DAVID", "SEBASTIEN", "JULIEN", "VINCENT",
  "ANTOINE", "MATHIEU", "FLORIAN", "THOMAS", "ALEXANDRE", "MAXIME", "ROMAIN", "GUILLAUME", "HUGO", "QUENTIN",
];
const PRENOMS_F = [
  "MARIE", "NATHALIE", "ISABELLE", "SYLVIE", "CATHERINE", "FRANCOISE", "MONIQUE", "CHRISTINE", "VALERIE", "SANDRINE",
  "CELINE", "STEPHANIE", "VIRGINIE", "CAROLE", "SOPHIE", "CORINNE", "ANNE", "AUDREY", "JULIE", "CAMILLE",
  "EMILIE", "LAURENCE", "MARTINE", "CHANTAL", "BRIGITTE", "PATRICIA", "AMELIE", "CLAIRE", "MARION", "LEA",
];
const ETAB_SUFFIXES = [
  "Saint-Joseph", "Notre-Dame", "Sainte-Marie", "Saint-Pierre", "Jeanne d'Arc",
  "Saint-Louis", "Sainte-Therese", "Saint-Exupery", "La Providence", "Jean XXIII",
];

interface Academie {
  key: string; // clé de dossier, sans accent/espace
  nom: string; // valeur académie telle qu'importée (ref_academie_scrutins)
  spelc: string;
  departement: string; // département fictif (voir scenarioTestReferentiel.ts)
  codePostalPrefix: string; // 3 premiers chiffres du département fictif + suffixe pour faire 5 chiffres
}

const ACADEMIES: Academie[] = [
  { key: "localhost", nom: "localhost", spelc: "Spelc Test Alpha", departement: "96", codePostalPrefix: "96" },
  { key: "academie-test-beta", nom: "Académie Test Beta", spelc: "Spelc Test Beta", departement: "99", codePostalPrefix: "99" },
];

type Degre = "1D" | "2D";

interface Electeur {
  nom: string;
  prenom: string;
  corps: string;
  nomEtab: string;
  codePostal: string;
  matricule: string;
  civilite: 1 | 3;
  jourVote: number | null; // 1..NB_JOURS, ou null si jamais voté
  estAdherent: boolean;
}

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function makeMatricule(prenom: string, nom: string, used: Set<string>): string {
  const base = `${stripAccents(prenom).toLowerCase()}.${stripAccents(nom).toLowerCase()}`.replace(/[^a-z.]/g, "-");
  let candidate = `${base}@ac-test.fr`;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${base}${n}@ac-test.fr`;
    n++;
  }
  used.add(candidate);
  return candidate;
}

/**
 * Probabilité de voter CE jour précis (parmi ceux qui n'ont pas encore
 * voté), pour 5 jours, selon qu'on est adhérent (donc cible des relances
 * simulées après J2 et J4, voir simulerRelancesTest.ts) ou non. Les pics aux
 * jours 3 et 5 chez les adhérents racontent l'effet de la relance mail (J2)
 * puis SMS (J4) ; le jour 5 (dernier jour) a aussi un effet "deadline"
 * universel, plus marqué chez les adhérents relancés.
 */
const VOTE_PROB: Record<"adherent" | "non_adherent", number[]> = {
  adherent: [0.08, 0.07, 0.15, 0.1, 0.25],
  non_adherent: [0.05, 0.04, 0.05, 0.05, 0.12],
};

function tirerJourVote(rng: () => number, estAdherent: boolean, nbJours: number): number | null {
  const probs = VOTE_PROB[estAdherent ? "adherent" : "non_adherent"];
  const u = rng();
  let cum = 0;
  for (let j = 0; j < nbJours; j++) {
    cum += probs[j] ?? probs[probs.length - 1] * 0.5;
    if (u < cum) return j + 1;
  }
  return null; // abstention
}

function genererEtablissements(rng: () => number, degre: Degre, codePostalPrefix: string, n: number) {
  const suffixes = shuffle(rng, ETAB_SUFFIXES).slice(0, n);
  return suffixes.map((suffixe, i) => {
    const codePostal = `${codePostalPrefix}${String(i * 11).padStart(3, "0")}`;
    if (degre === "1D") {
      const type = pick(rng, ["École élémentaire privée", "École primaire privée"]);
      return { nomEtab: `${type} ${suffixe}`, codePostal };
    }
    const type = pick(rng, ["Collège privé", "Collège privé", "Lycée privé", "Lycée professionnel privé"]);
    return { nomEtab: `${type} ${suffixe}`, codePostal };
  });
}

function corpsPour(degre: Degre, nomEtab: string, rng: () => number): string {
  if (degre === "1D") {
    const r = rng();
    if (r < 0.7) return "Professeurs écoles ens privé EN";
    if (r < 0.8) return "Instituteurs ens privé";
    return "maître délégué";
  }
  const r = rng();
  if (r < 0.5) return "Professeurs certifiés ens privé EN";
  if (r < 0.65) return "Professeurs agrégés ens privé EN";
  if (r < 0.8 && nomEtab.includes("professionnel")) return "Professeurs lycée professionnel ens privé EN";
  return "maître délégué";
}

function genererElecteurs(rng: () => number, degre: Degre, academie: Academie, n: number, nbJours: number, usedMatricules: Set<string>): Electeur[] {
  const nbEtabs = degre === "1D" ? 6 : 8;
  const etabs = genererEtablissements(rng, degre, academie.codePostalPrefix, nbEtabs);
  const electeurs: Electeur[] = [];
  const nomsShuffled = shuffle(rng, NOMS);
  for (let i = 0; i < n; i++) {
    const nom = nomsShuffled[i % nomsShuffled.length];
    const estHomme = rng() < 0.5;
    const prenom = estHomme ? pick(rng, PRENOMS_M) : pick(rng, PRENOMS_F);
    const etab = pick(rng, etabs);
    const corps = corpsPour(degre, etab.nomEtab, rng);
    // ~56% des électeurs de cette académie sont adhérents de son Spelc — fixé
    // ici (et non dans genererAdherents) pour que le jour de vote tienne déjà
    // compte du statut d'adhérent.
    const estAdherent = rng() < 0.56;
    electeurs.push({
      nom,
      prenom,
      corps,
      nomEtab: etab.nomEtab,
      codePostal: etab.codePostal,
      matricule: makeMatricule(prenom, nom, usedMatricules),
      civilite: estHomme ? 1 : 3,
      jourVote: tirerJourVote(rng, estAdherent, nbJours),
      estAdherent,
    });
  }
  return electeurs;
}

function formatDateEmargement(jour: number, rng: () => number): string {
  // Semaine de scrutin 2026, du 3 au 9 décembre (jours ouvrés fictifs).
  const base = new Date(Date.UTC(2026, 11, 2)); // 2026-12-02, jour 1 = 12-03
  base.setUTCDate(base.getUTCDate() + jour);
  const yyyy = base.getUTCFullYear();
  const mm = String(base.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(base.getUTCDate()).padStart(2, "0");
  const hh = String(8 + Math.floor(rng() * 10)).padStart(2, "0");
  const mi = String(Math.floor(rng() * 60)).padStart(2, "0");
  const ss = String(Math.floor(rng() * 60)).padStart(2, "0");
  return `${yyyy}${mm}${dd} ${hh}:${mi}:${ss}`;
}

function emargementItem(e: Electeur, jourCourant: number, rng: () => number) {
  const [nomUsage, nomFamille] = [e.nom, e.nom]; // pas de nom de naissance distinct dans ce scénario
  return {
    matricule: e.matricule,
    nomFamille,
    nomEtab: e.nomEtab,
    nomCol: e.corps,
    codePostal: e.codePostal,
    nomUsage,
    prenom: e.prenom,
    statut: "TITULAIRE",
    civilite: e.civilite,
    dateEmargement: e.jourVote != null && e.jourVote <= jourCourant ? formatDateEmargement(e.jourVote, rng) : null,
  };
}

interface AdherentRow {
  spelc: string;
  nom: string;
  prenom: string;
  mail: string;
  mobile: string;
  estOrphelin: boolean; // true = n'existe dans aucun fichier électeurs (teste "adhérents non retrouvés")
  electeurRef?: Electeur;
}

function genererAdherents(rng: () => number, academie: Academie, electeursParDegre: Record<Degre, Electeur[]>): AdherentRow[] {
  const rows: AdherentRow[] = [];
  const usedMails = new Set<string>();
  for (const degre of ["1D", "2D"] as Degre[]) {
    for (const e of electeursParDegre[degre]) {
      if (!e.estAdherent) continue;
      const mailBase = `${stripAccents(e.prenom).toLowerCase()}.${stripAccents(e.nom).toLowerCase()}`.replace(/[^a-z.]/g, "-");
      let mail = `${mailBase}@exemple-test.fr`;
      let n = 2;
      while (usedMails.has(mail)) {
        mail = `${mailBase}${n}@exemple-test.fr`;
        n++;
      }
      usedMails.add(mail);
      const mobile = `06${String(Math.floor(rng() * 100000000)).padStart(8, "0")}`;
      rows.push({ spelc: academie.spelc, nom: e.nom, prenom: e.prenom, mail, mobile, estOrphelin: false, electeurRef: e });
    }
  }
  // ~5% d'adhérents "orphelins" supplémentaires, déclarés par le Spelc mais
  // absents de tout fichier électeurs — teste le panneau "adhérents non
  // retrouvés" (voir diagnosticNonRetrouves.ts).
  const nbOrphelins = Math.round(rows.length * 0.05);
  const nomsShuffled = shuffle(rng, NOMS);
  for (let i = 0; i < nbOrphelins; i++) {
    const nom = `${nomsShuffled[i % nomsShuffled.length]}-X`;
    const estHomme = rng() < 0.5;
    const prenom = estHomme ? pick(rng, PRENOMS_M) : pick(rng, PRENOMS_F);
    const mailBase = `${stripAccents(prenom).toLowerCase()}.${stripAccents(nom).toLowerCase()}`.replace(/[^a-z.]/g, "-");
    rows.push({
      spelc: academie.spelc,
      nom,
      prenom,
      mail: `${mailBase}@exemple-test.fr`,
      mobile: `06${String(Math.floor(rng() * 100000000)).padStart(8, "0")}`,
      estOrphelin: true,
    });
  }
  return rows;
}

interface RelanceCible {
  nom: string;
  prenom: string;
  contact: string;
}

interface RelanceEvent {
  id: string;
  spelc: string;
  type: "mail" | "sms";
  /** Jour simulé APRÈS lequel la relance est envoyée (ex. 2 = envoyée entre l'import du jour 2 et celui du jour 3). */
  apresJour: number;
  cibles: RelanceCible[];
}

function genererPlanRelances(academie: Academie, adherents: AdherentRow[], nbJours: number): RelanceEvent[] {
  const events: RelanceEvent[] = [];
  const checkpoints: { apresJour: number; type: "mail" | "sms" }[] = [
    { apresJour: 2, type: "mail" },
    { apresJour: Math.min(4, nbJours - 1), type: "sms" },
  ];
  for (const cp of checkpoints) {
    const cibles: RelanceCible[] = [];
    for (const a of adherents) {
      const aDejaVote = !a.estOrphelin && a.electeurRef!.jourVote != null && a.electeurRef!.jourVote <= cp.apresJour;
      if (aDejaVote) continue;
      const contact = cp.type === "mail" ? a.mail : a.mobile;
      if (!contact) continue;
      cibles.push({ nom: a.nom, prenom: a.prenom, contact });
    }
    if (cibles.length > 0) {
      events.push({
        id: `${academie.key}-${cp.type}-apres-j${cp.apresJour}`,
        spelc: academie.spelc,
        type: cp.type,
        apresJour: cp.apresJour,
        cibles,
      });
    }
  }
  return events;
}

function main() {
  const args = parseArgs();
  const rng = makeRng(args.seed);
  fs.mkdirSync(args.out, { recursive: true });

  const populations: Record<Degre, number> = { "1D": 100, "2D": 150 };
  const allRelanceEvents: RelanceEvent[] = [];
  const summaryLines: string[] = [];
  const adherentsCsvRows: string[] = ["spelc,nom,prenom,mail,mobile"];

  for (const academie of ACADEMIES) {
    const usedMatricules = new Set<string>();
    const electeursParDegre: Record<Degre, Electeur[]> = {
      "1D": genererElecteurs(rng, "1D", academie, populations["1D"], args.jours, usedMatricules),
      "2D": genererElecteurs(rng, "2D", academie, populations["2D"], args.jours, usedMatricules),
    };

    for (const degre of ["1D", "2D"] as Degre[]) {
      const dir = path.join(args.out, "emargements", academie.key, degre);
      fs.mkdirSync(dir, { recursive: true });
      const electeurs = electeursParDegre[degre];
      for (let jour = 1; jour <= args.jours; jour++) {
        const items = electeurs.map((e) => emargementItem(e, jour, rng));
        const payload = { totalCount: items.length, items };
        fs.writeFileSync(path.join(dir, `jour-${jour}.json`), JSON.stringify(payload, null, 2), "utf-8");
      }
      const votantsFinal = electeurs.filter((e) => e.jourVote != null).length;
      summaryLines.push(
        `- ${academie.nom} / ${degre} : ${electeurs.length} électeurs, ${votantsFinal} votants au jour ${args.jours} (${((votantsFinal / electeurs.length) * 100).toFixed(1)} %)`
      );
    }

    const adherents = genererAdherents(rng, academie, electeursParDegre);
    for (const a of adherents) {
      adherentsCsvRows.push(`${a.spelc},${a.nom},${a.prenom},${a.mail},${a.mobile}`);
    }
    const adherentsVotantsFinal = adherents.filter((a) => !a.estOrphelin && a.electeurRef!.jourVote != null).length;
    summaryLines.push(
      `- ${academie.spelc} : ${adherents.length} adhérents (dont ${adherents.filter((a) => a.estOrphelin).length} jamais retrouvés dans les électeurs), ${adherentsVotantsFinal} votants au jour ${args.jours} (${((adherentsVotantsFinal / adherents.length) * 100).toFixed(1)} %)`
    );

    const events = genererPlanRelances(academie, adherents, args.jours);
    allRelanceEvents.push(...events);
  }

  fs.writeFileSync(path.join(args.out, "adherents.csv"), adherentsCsvRows.join("\n") + "\n", "utf-8");
  fs.writeFileSync(path.join(args.out, "relances-plan.json"), JSON.stringify(allRelanceEvents, null, 2), "utf-8");

  const readme = `# Scénario de test — élections simulées

Généré le ${new Date().toISOString()} (seed=${args.seed}, ${args.jours} jours simulés).

Ce scénario est 100% fictif, isolé des vraies académies/Spelcs (voir
scenarioTestReferentiel.ts pour la mise en place du référentiel nécessaire
avant tout import).

## Contenu

- \`adherents.csv\` — à importer en une fois via l'onglet **Adhérents** de
  l'admin général ("Importer tous les adhérents (tous les Spelcs)").
- \`emargements/<academie>/<1D|2D>/jour-N.json\` — fichiers cumulatifs, un par
  jour simulé, à importer via l'onglet **Imports** de l'admin général
  (bouton 1D ou 2D de l'académie concernée). Importer jour-1.json, puis
  jour-2.json à sa place (il la remplace), etc. — exactement comme un import
  quotidien réel.
- \`relances-plan.json\` — plan des relances simulées, consommé par
  \`simulerRelancesTest.ts\` (jamais d'appel Brevo réel).

## Déroulé conseillé

1. Mettre en place le référentiel de test (une fois) : voir
   scenarioTestReferentiel.ts.
2. Importer adherents.csv.
3. Importer le jour 1 (4 fichiers : 2 académies × 1D/2D).
4. Importer le jour 2.
5. Lancer la relance mail (voir simulerRelancesTest.ts, événements
   \`*-mail-apres-j2\`).
6. Importer le jour 3 — la participation des adhérents doit bondir plus que
   celle des non-adhérents.
7. Importer le jour 4.
8. Lancer la relance SMS (événements \`*-sms-apres-j4\`).
9. Importer le jour 5 (dernier jour) — nouveau bond, encore plus marqué chez
   les adhérents relancés.

## Résultat attendu au dernier jour

${summaryLines.join("\n")}
`;
  fs.writeFileSync(path.join(args.out, "README.md"), readme, "utf-8");

  console.log(readme);
  console.log(`\nFichiers écrits dans ${args.out}`);
}

main();
