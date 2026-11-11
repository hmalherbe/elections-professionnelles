/**
 * Mise en place / nettoyage du référentiel nécessaire au scénario de test
 * (voir genererScenarioTest.ts) : deux académies fictives, chacune avec un
 * département fictif et un Spelc dédié, totalement isolés des vraies
 * données (aucun vrai département ne pointe vers "localhost" ou "Académie
 * Test Beta", aucun vrai Spelc ne s'appelle "Spelc Test Alpha/Beta").
 *
 * Additif uniquement (pas de remplacement intégral comme les imports de
 * fichiers référentiels réels) : n'ajoute que les lignes manquantes
 * (idempotent), et --cleanup ne supprime QUE ces lignes précises.
 *
 * "localhost" existe déjà dans ref_academie_scrutins sur la plupart des
 * bases (entrée de test visiblement déjà prévue pour cet usage) : ce script
 * ne la recrée pas si elle est déjà là.
 *
 * Usage (dans le conteneur backend) :
 *   npx tsx src/scripts/scenarioTestReferentiel.ts setup
 *   npx tsx src/scripts/scenarioTestReferentiel.ts cleanup
 */
import { db, migrate } from "../db/index.js";

migrate();

const ACADEMIES = [
  { nom: "localhost", spelc: "Spelc Test Alpha", departement: "96" },
  { nom: "Académie Test Beta", spelc: "Spelc Test Beta", departement: "99" },
];

function setup(): void {
  const insertDept = db.prepare(
    "INSERT OR IGNORE INTO ref_departements (departement, spelc, academie) VALUES (?, ?, ?)"
  );
  const insertSpelc = db.prepare(
    "INSERT OR IGNORE INTO ref_spelc (spelc, accord, academie) VALUES (?, 'Oui', ?)"
  );
  const insertScrutins = db.prepare(
    "INSERT OR IGNORE INTO ref_academie_scrutins (academie, type_1d, type_2d) VALUES (?, 'CCMI', 'CCMA')"
  );

  for (const a of ACADEMIES) {
    insertDept.run(a.departement, a.spelc, a.nom);
    insertSpelc.run(a.spelc, a.nom);
    insertScrutins.run(a.nom);
  }

  console.log("Référentiel de test mis en place :");
  for (const a of ACADEMIES) {
    console.log(`  - ${a.nom} (département fictif ${a.departement}) -> ${a.spelc}`);
  }
}

function cleanup(): void {
  const tx = db.transaction(() => {
    for (const a of ACADEMIES) {
      db.prepare("DELETE FROM ref_departements WHERE departement = ? AND academie = ?").run(a.departement, a.nom);
      db.prepare("DELETE FROM ref_spelc WHERE spelc = ? AND academie = ?").run(a.spelc, a.nom);
      // On ne retire "localhost" de ref_academie_scrutins que si on l'a
      // nous-même créée (academie-test-beta) : "localhost" existait avant ce
      // script sur la plupart des bases, mieux vaut la laisser en place.
      if (a.nom !== "localhost") {
        db.prepare("DELETE FROM ref_academie_scrutins WHERE academie = ?").run(a.nom);
      }
      db.prepare("DELETE FROM adherents WHERE spelc = ?").run(a.spelc);
    }
    // Supprime aussi les imports/émargements du scénario (académique, sur ces 2 académies).
    const ids = db
      .prepare(
        `SELECT id FROM imports WHERE scope = 'academique' AND academie IN (${ACADEMIES.map(() => "?").join(",")})`
      )
      .all(...ACADEMIES.map((a) => a.nom)) as { id: number }[];
    for (const row of ids) {
      db.prepare("DELETE FROM imports WHERE id = ?").run(row.id);
    }
    for (const a of ACADEMIES) {
      db.prepare("DELETE FROM relance_tracking WHERE scope = ?").run(a.spelc);
    }
  });
  tx();
  console.log("Référentiel et données du scénario de test supprimés.");
}

const cmd = process.argv[2];
if (cmd === "setup") setup();
else if (cmd === "cleanup") cleanup();
else {
  console.error("Usage : npx tsx src/scripts/scenarioTestReferentiel.ts setup|cleanup");
  process.exit(1);
}
