import { Router, type Response } from "express";
import { canalFromContact, expandContactParam, verifyUnsubscribeToken } from "../lib/unsubscribeToken.js";
import { recordOptOutBothChannels } from "../services/optout.js";

const router = Router();

function page(title: string, message: string): string {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1.5rem;color:#1e293b;text-align:center}
h1{font-size:1.25rem}</style></head>
<body><h1>${title}</h1><p>${message}</p></body></html>`;
}

/** Commun aux deux formats de lien ci-dessous (voir chacun) : vérifie le
 * jeton pour ce contact et, si valide, enregistre la désinscription croisée
 * (mail + SMS), toujours avec la même page HTML en retour. */
function handleUnsubscribe(res: Response, contact: string, token: string): void {
  if (!contact || !token) {
    res.status(400).send(page("Lien invalide", "Ce lien de désinscription est incomplet ou mal formé."));
    return;
  }
  if (!verifyUnsubscribeToken(contact, token)) {
    res.status(403).send(page("Lien invalide", "Ce lien de désinscription n'est pas valide."));
    return;
  }
  recordOptOutBothChannels(canalFromContact(contact), contact);
  res.send(
    page(
      "Désinscription prise en compte",
      "Vous ne recevrez plus aucune relance (mail et SMS) pour le scrutin professionnel. Si c'est une erreur, contactez votre Spelc."
    )
  );
}

/**
 * Lien public de désinscription (mail ou SMS), cliqué directement par un
 * adhérent depuis sa boîte mail ou son téléphone — jamais authentifié,
 * jamais appelé par le frontend de l'appli. Le jeton est recalculé et
 * vérifié à la volée (voir lib/unsubscribeToken.ts) : rien à stocker par
 * avance par destinataire. Toujours une page HTML en retour (jamais de
 * JSON), puisque c'est un navigateur grand public qui l'affiche.
 *
 * Nouveau format, court (voir buildUnsubscribeUrl) : /<contact sans
 * indicatif>/<jeton>. Monté à la fois sous /api/u (accès direct) et sous /u
 * via infra/nginx.conf (réécrit vers /api/u — c'est ce chemin très court,
 * sur un domaine dédié, qui est effectivement inséré dans les mails/SMS).
 */
router.get("/:contactParam/:token", (req, res) => {
  const contact = expandContactParam(req.params.contactParam);
  handleUnsubscribe(res, contact, req.params.token);
});

/**
 * Ancien format (/?c=...&t=...), conservé pour que les liens déjà envoyés
 * (mails/SMS reçus avant le raccourcissement ci-dessus) restent valides —
 * jamais généré par buildUnsubscribeUrl depuis ce changement.
 */
router.get("/", (req, res) => {
  const contact = req.query.c;
  const token = req.query.t;
  if (typeof contact !== "string" || typeof token !== "string") {
    res.status(400).send(page("Lien invalide", "Ce lien de désinscription est incomplet ou mal formé."));
    return;
  }
  handleUnsubscribe(res, contact, token);
});

export default router;
