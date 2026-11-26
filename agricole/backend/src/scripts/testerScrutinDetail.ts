/**
 * Sanity check de services/stats.ts#scrutinDetail (onglet "Scrutin") juste
 * après déploiement : exécute la fonction pour les 2 scrutins, avec et sans
 * filtres, et affiche les taux globaux + un contrôle de cohérence (somme
 * des établissements = total). N'écrit rien en base.
 *
 * Usage (dans le conteneur backend) :
 *   npx tsx src/scripts/testerScrutinDetail.ts
 */
import { migrate } from "../db/index.js";
import { scrutinDetail } from "../services/stats.js";
import { SCRUTINS } from "../lib/scrutins.js";

migrate();

for (const { code, label } of SCRUTINS) {
  console.log(`\n=== ${label} (${code}) ===`);

  const sansFiltre = scrutinDetail({ scrutin: code });
  console.log(
    `Global : ${sansFiltre.global.votants}/${sansFiltre.global.inscrits} ` +
      `(${(sansFiltre.global.taux * 100).toFixed(1)} %) — adhérents : ` +
      `${sansFiltre.global.adherentsVotants}/${sansFiltre.global.adherentsInscrits} ` +
      `(${(sansFiltre.global.adherentsTaux * 100).toFixed(1)} %)`
  );
  console.log(`${sansFiltre.etablissements.length} établissement(s), ${sansFiltre.etablissementOptions.length} option(s) de filtre.`);

  const sommeEtabs = sansFiltre.etablissements.reduce((s, e) => s + e.inscrits, 0);
  if (sommeEtabs !== sansFiltre.global.inscrits) {
    console.error(`INCOHÉRENCE : somme des établissements (${sommeEtabs}) != global (${sansFiltre.global.inscrits}).`);
  } else {
    console.log("Cohérence somme établissements / global : OK.");
  }

  const nonVotants = scrutinDetail({ scrutin: code, votant: "non_votant" });
  const totalListeNonVotants = nonVotants.etablissements.reduce((s, e) => s + e.rows.length, 0);
  console.log(
    `Filtre "non votant" : ${totalListeNonVotants} électeur(s) listé(s) ` +
      `(taux global inchangé : ${(nonVotants.global.taux * 100).toFixed(1)} % — si différent du global sans filtre, c'est un bug).`
  );

  const adherents = scrutinDetail({ scrutin: code, adherent: "oui" });
  console.log(`Filtre "adhérents" : ${adherents.totalRows} électeur(s) adhérent(s) listé(s).`);
}

console.log("\nTerminé sans exception.");
