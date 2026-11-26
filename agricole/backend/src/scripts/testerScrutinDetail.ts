/**
 * Sanity check de services/stats.ts#scrutinDetail (onglet "Scrutin") juste
 * après déploiement : exécute la fonction avec et sans filtres, affiche les
 * taux globaux pour les 2 scrutins ("le CCM" et "la CCM", fusionnés par
 * identité) + un contrôle de cohérence (somme des établissements = total).
 * N'écrit rien en base.
 *
 * Usage (dans le conteneur backend) :
 *   npx tsx src/scripts/testerScrutinDetail.ts
 */
import { migrate } from "../db/index.js";
import { scrutinDetail, type ScrutinStats } from "../services/stats.js";

migrate();

function afficherStats(label: string, s: ScrutinStats): void {
  console.log(
    `${label} : ${s.votants}/${s.inscrits} (${(s.taux * 100).toFixed(1)} %) — adhérents : ` +
      `${s.adherentsVotants}/${s.adherentsInscrits} (${(s.adherentsTaux * 100).toFixed(1)} %)`
  );
}

const sansFiltre = scrutinDetail({});
afficherStats("Le CCM (scrutin1)", sansFiltre.global.scrutin1);
afficherStats("La CCM (scrutin2)", sansFiltre.global.scrutin2);
console.log(`${sansFiltre.etablissements.length} établissement(s), ${sansFiltre.etablissementOptions.length} option(s) de filtre.`);

for (const [key, label] of [["scrutin1", "le CCM"], ["scrutin2", "la CCM"]] as const) {
  const somme = sansFiltre.etablissements.reduce((s, e) => s + e[key].inscrits, 0);
  if (somme !== sansFiltre.global[key].inscrits) {
    console.error(`INCOHÉRENCE (${label}) : somme des établissements (${somme}) != global (${sansFiltre.global[key].inscrits}).`);
  } else {
    console.log(`Cohérence somme établissements / global (${label}) : OK.`);
  }
}

const nonVotants1 = scrutinDetail({ votant1: "non_votant" });
const totalListeNonVotants1 = nonVotants1.etablissements.reduce((s, e) => s + e.rows.length, 0);
console.log(
  `Filtre "non votant" (le CCM) : ${totalListeNonVotants1} électeur(s) listé(s) ` +
    `(taux global inchangé : le CCM ${(nonVotants1.global.scrutin1.taux * 100).toFixed(1)} % / ` +
    `la CCM ${(nonVotants1.global.scrutin2.taux * 100).toFixed(1)} % — si différents du global sans filtre, c'est un bug).`
);

const adherents = scrutinDetail({ adherent: "oui" });
console.log(`Filtre "adhérents" : ${adherents.totalRows} électeur(s) adhérent(s) listé(s).`);

console.log("\nTerminé sans exception.");
