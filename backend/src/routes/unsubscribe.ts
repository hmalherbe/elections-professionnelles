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

/**
 * Page intermédiaire affichée sur GET (voir handleUnsubscribeConfirm) :
 * demande une confirmation explicite (bouton, donc un clic humain réel —
 * voir le POST ci-dessous) avant d'enregistrer quoi que ce soit. Un simple
 * GET n'a jamais d'effet de bord : de nombreux téléphones/opérateurs/
 * clients de messagerie visitent automatiquement les liens reçus par SMS
 * (scan anti-hameçonnage), ce qui désinscrivait silencieusement de vrais
 * destinataires dans les secondes suivant la réception, sans qu'ils aient
 * rien demandé — constaté en conditions réelles (scénario de test, cascade
 * sur ~150 contacts partageant un même mobile de test).
 */
function confirmPage(formAction: string): string {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Confirmer la désinscription</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1.5rem;color:#1e293b;text-align:center}
h1{font-size:1.25rem}
button{margin-top:1.25rem;padding:0.6rem 1.5rem;font-size:1rem;border:none;border-radius:0.375rem;background:#1e293b;color:#fff;cursor:pointer}
button:hover{background:#334155}</style></head>
<body><h1>Confirmer la désinscription</h1>
<p>Vous ne recevrez plus aucune relance (mail et SMS) pour le scrutin professionnel.</p>
<form method="POST" action="${formAction}"><button type="submit">Confirmer la désinscription</button></form>
</body></html>`;
}

/** Commun aux deux formats de lien ci-dessous (voir chacun) : vérifie le
 * jeton pour ce contact ; si invalide, un message d'erreur immédiat (aucun
 * effet de bord dans tous les cas, GET comme POST). */
function verifyOrReject(res: Response, contact: string, token: string): boolean {
  if (!contact || !token) {
    res.status(400).send(page("Lien invalide", "Ce lien de désinscription est incomplet ou mal formé."));
    return false;
  }
  if (!verifyUnsubscribeToken(contact, token)) {
    res.status(403).send(page("Lien invalide", "Ce lien de désinscription n'est pas valide."));
    return false;
  }
  return true;
}

/** GET : affiche la page de confirmation (voir confirmPage), jamais
 * d'enregistrement — voir le commentaire de confirmPage pour pourquoi. */
function handleUnsubscribeConfirm(res: Response, contact: string, token: string, formAction: string): void {
  if (!verifyOrReject(res, contact, token)) return;
  res.send(confirmPage(formAction));
}

/** POST (clic sur le bouton de confirmPage) : seul point qui enregistre
 * réellement la désinscription croisée (mail + SMS). */
function handleUnsubscribeConfirmed(res: Response, contact: string, token: string): void {
  if (!verifyOrReject(res, contact, token)) return;
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
  handleUnsubscribeConfirm(res, contact, req.params.token, req.originalUrl);
});

router.post("/:contactParam/:token", (req, res) => {
  const contact = expandContactParam(req.params.contactParam);
  handleUnsubscribeConfirmed(res, contact, req.params.token);
});

/**
 * Ancien format (/?c=...&t=...), conservé pour que les liens déjà envoyés
 * (mails/SMS reçus avant le raccourcissement ci-dessus) restent valides —
 * jamais généré par buildUnsubscribeUrl depuis ce changement. Même
 * confirmation explicite que le nouveau format ci-dessus.
 */
router.get("/", (req, res) => {
  const contact = req.query.c;
  const token = req.query.t;
  if (typeof contact !== "string" || typeof token !== "string") {
    res.status(400).send(page("Lien invalide", "Ce lien de désinscription est incomplet ou mal formé."));
    return;
  }
  handleUnsubscribeConfirm(res, contact, token, req.originalUrl);
});

router.post("/", (req, res) => {
  const contact = req.query.c;
  const token = req.query.t;
  if (typeof contact !== "string" || typeof token !== "string") {
    res.status(400).send(page("Lien invalide", "Ce lien de désinscription est incomplet ou mal formé."));
    return;
  }
  handleUnsubscribeConfirmed(res, contact, token);
});

export default router;
