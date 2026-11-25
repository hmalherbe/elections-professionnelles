import { Router } from "express";
import { verifyUnsubscribeToken } from "../lib/unsubscribeToken.js";
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

/**
 * Lien public de désinscription (mail ou SMS), cliqué directement par un
 * adhérent depuis sa boîte mail ou son téléphone — jamais authentifié,
 * jamais appelé par le frontend de l'appli. Le jeton est recalculé et
 * vérifié à la volée (voir lib/unsubscribeToken.ts) : rien à stocker par
 * avance par destinataire. Toujours une page HTML en retour (jamais de
 * JSON), puisque c'est un navigateur grand public qui l'affiche.
 */
router.get("/", (req, res) => {
  const canal = req.query.canal;
  const contact = req.query.contact;
  const token = req.query.token;
  if (
    (canal !== "mail" && canal !== "sms") ||
    typeof contact !== "string" ||
    !contact ||
    typeof token !== "string" ||
    !token
  ) {
    res.status(400).send(page("Lien invalide", "Ce lien de désinscription est incomplet ou mal formé."));
    return;
  }
  if (!verifyUnsubscribeToken(canal, contact, token)) {
    res.status(403).send(page("Lien invalide", "Ce lien de désinscription n'est pas valide."));
    return;
  }
  recordOptOutBothChannels(canal, contact);
  res.send(
    page(
      "Désinscription prise en compte",
      "Vous ne recevrez plus aucune relance (mail et SMS) pour le scrutin professionnel. Si c'est une erreur, contactez votre Spelc."
    )
  );
});

export default router;
