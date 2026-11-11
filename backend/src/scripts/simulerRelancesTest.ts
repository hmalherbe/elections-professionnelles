/**
 * Simule l'envoi d'une relance (mail ou SMS) du scénario de test (voir
 * genererScenarioTest.ts) : enregistre chaque destinataire directement dans
 * relance_tracking, EXACTEMENT comme un envoi réel validerait le suivi, mais
 * SANS JAMAIS appeler Brevo ni effectuer la moindre requête réseau — rien
 * n'est envoyé à personne.
 *
 * Usage (dans le conteneur backend) :
 *   npx tsx src/scripts/simulerRelancesTest.ts <chemin-vers-relances-plan.json> <id-événement>
 *   npx tsx src/scripts/simulerRelancesTest.ts <chemin> --list   (liste les événements du plan)
 *
 * id-événement : voir relances-plan.json généré par genererScenarioTest.ts
 * (ex. "localhost-mail-apres-j2").
 */
import fs from "node:fs";
import { db, migrate } from "../db/index.js";
import { insertRelanceTracking } from "../services/relanceTracking.js";

migrate();

interface RelanceCible {
  nom: string;
  prenom: string;
  contact: string;
}

interface RelanceEvent {
  id: string;
  spelc: string;
  type: "mail" | "sms";
  apresJour: number;
  cibles: RelanceCible[];
}

const [planPath, eventIdOrFlag] = process.argv.slice(2);
if (!planPath || !eventIdOrFlag) {
  console.error("Usage : npx tsx src/scripts/simulerRelancesTest.ts <relances-plan.json> <id-événement|--list>");
  process.exit(1);
}

const events: RelanceEvent[] = JSON.parse(fs.readFileSync(planPath, "utf-8"));

if (eventIdOrFlag === "--list") {
  for (const e of events) {
    console.log(`${e.id} — ${e.spelc}, ${e.type}, ${e.cibles.length} destinataire(s)`);
  }
  process.exit(0);
}

const event = events.find((e) => e.id === eventIdOrFlag);
if (!event) {
  console.error(`Événement "${eventIdOrFlag}" introuvable dans ${planPath}. Utiliser --list pour voir les ids disponibles.`);
  process.exit(1);
}

const already = db
  .prepare("SELECT COUNT(*) AS c FROM relance_tracking WHERE campagne_tag = ?")
  .get(`scenario-test-${event.id}`) as { c: number };
if (already.c > 0) {
  console.error(`Cette relance a déjà été simulée (${already.c} ligne(s) existantes pour campagne_tag="scenario-test-${event.id}"). Rien à faire.`);
  process.exit(1);
}

const owner = db.prepare("SELECT id FROM users WHERE role = 'admin_general' ORDER BY id LIMIT 1").get() as
  | { id: number }
  | undefined;
if (!owner) {
  console.error("Aucun compte admin_general trouvé : impossible de rattacher la simulation à un compte.");
  process.exit(1);
}

const campagneTag = `scenario-test-${event.id}`;
let ok = 0;
let echecs = 0;
for (const cible of event.cibles) {
  // ~3% d'échecs simulés (mail invalide, SMS rejeté...), comme un envoi réel.
  const sendOk = Math.random() > 0.03;
  insertRelanceTracking({
    ownerUserId: owner.id,
    type: event.type,
    scope: event.spelc,
    campagneTag,
    nom: cible.nom,
    prenom: cible.prenom,
    contact: cible.contact,
    testMode: false,
    sendOk,
    messageId: null,
    errorMessage: sendOk ? null : "Échec simulé (scénario de test)",
  });
  if (sendOk) ok++;
  else echecs++;
}

console.log(
  `Relance simulée "${event.id}" (${event.type}, ${event.spelc}) : ${ok} envoi(s) OK, ${echecs} échec(s) — aucun appel Brevo, rien envoyé réellement.`
);
console.log(`Visible dans l'onglet "Statistiques relances" de l'admin général (campagne "${campagneTag}").`);
