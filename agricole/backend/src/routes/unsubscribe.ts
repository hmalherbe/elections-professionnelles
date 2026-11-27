import { Router } from "express";
import { verifyUnsubscribeToken } from "../lib/unsubscribeToken.js";
import { recordOptOut } from "../services/optout.js";

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
 * GET n'a jamais d'effet de bord : de nombreux clients de messagerie/
 * passerelles de sécurité (ex. Microsoft Safe Links) visitent
 * automatiquement les liens reçus par mail (scan anti-hameçonnage), ce qui
 * désinscrivait silencieusement de vrais destinataires dès réception du
 * mail, sans qu'ils aient rien demandé (constaté en conditions réelles
 * côté application éducation nationale, même mécanisme de lien).
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
<p>Vous ne recevrez plus aucune relance par mail pour le scrutin professionnel agricole.</p>
<form method="POST" action="${formAction}"><button type="submit">Confirmer la désinscription</button></form>
</body></html>`;
}

function parseContactToken(req: { query: Record<string, unknown> }): { contact: string; token: string } | null {
  const contact = req.query.c;
  const token = req.query.t;
  if (typeof contact !== "string" || !contact || typeof token !== "string" || !token) return null;
  return { contact, token };
}

/**
 * Lien public de désinscription, cliqué directement par un adhérent depuis
 * sa boîte mail — jamais authentifié, jamais appelé par le frontend de
 * l'appli. Le jeton est recalculé et vérifié à la volée (voir
 * lib/unsubscribeToken.ts) : rien à stocker par avance par destinataire.
 * Toujours une page HTML en retour (jamais de JSON), puisque c'est un
 * navigateur grand public qui l'affiche.
 */
router.get("/", (req, res) => {
  const parsed = parseContactToken(req);
  if (!parsed) {
    res.status(400).send(page("Lien invalide", "Ce lien de désinscription est incomplet ou mal formé."));
    return;
  }
  if (!verifyUnsubscribeToken(parsed.contact, parsed.token)) {
    res.status(403).send(page("Lien invalide", "Ce lien de désinscription n'est pas valide."));
    return;
  }
  res.send(confirmPage(req.originalUrl));
});

/** Clic réel sur le bouton de confirmPage : seul point qui enregistre
 * réellement la désinscription. */
router.post("/", (req, res) => {
  const parsed = parseContactToken(req);
  if (!parsed) {
    res.status(400).send(page("Lien invalide", "Ce lien de désinscription est incomplet ou mal formé."));
    return;
  }
  if (!verifyUnsubscribeToken(parsed.contact, parsed.token)) {
    res.status(403).send(page("Lien invalide", "Ce lien de désinscription n'est pas valide."));
    return;
  }
  recordOptOut(parsed.contact);
  res.send(
    page(
      "Désinscription prise en compte",
      "Vous ne recevrez plus aucune relance par mail pour le scrutin professionnel agricole. Si c'est une erreur, contactez l'administrateur."
    )
  );
});

export default router;
