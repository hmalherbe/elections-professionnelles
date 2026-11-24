import { Router } from "express";
import { db } from "../db/index.js";
import dayjs from "dayjs";
import { requireAuth, requireRole, canAccessSpelc } from "../middleware/auth.js";
import { renderTemplate, buildIfTestCases, type TemplateFields } from "../lib/template.js";
import { wrapEmailHtml, ensureSiteLink } from "../lib/emailLayout.js";
import { sendBrevoEmails, sendBrevoSms, fetchAccountInfo, getBrevoApiKey, sleep } from "../services/brevo.js";
import { currentImportIds } from "../services/stats.js";
import { spelcAcademies } from "../services/reference.js";
import { getTestContactSettings } from "../services/settings.js";
import { getSpelcSettings, updateSpelcSettings } from "../services/spelcSettings.js";
import { buildLogoHtml, buildBannerHtml, buildSocialLinksHtml, type SocialLinks } from "../lib/socialLinks.js";
import { appendRelanceLog } from "../lib/relanceLog.js";
import {
  insertRelanceTracking,
  hasAlreadySent,
  listRelanceTrackingByScope,
  clearRelanceTrackingByScope,
  refreshPendingRelanceTracking,
  getMailSeriesByScope,
  getSmsSeriesByScope,
} from "../services/relanceTracking.js";
import { normalizeFrenchMobile } from "../lib/phone.js";
import { isValidSmsSender, suggestSmsSender } from "../lib/smsSender.js";
import { isRelanceOnly } from "../lib/appMode.js";
import { smsQuotaStatus } from "../services/smsQuota.js";
import { smsSegmentCount, analyzeSmsEncoding } from "../lib/smsSegments.js";

/** Préfixe le tag Brevo d'une campagne SMS par le nom du Spelc, pour que les
 * envois de chaque Spelc soient identifiables à la fois dans le tableau de
 * bord Brevo et dans le suivi interne (qui utilise déjà `scope`, indépendant
 * du tag, pour le calcul du plafond de crédits — voir services/smsQuota.ts).
 * Utilisé uniquement pour le SMS de test (tag fixe "test-modele") : les
 * campagnes réelles ont désormais un tag entièrement généré, voir
 * campagneTagAuto() ci-dessous. */
function smsCampagneTag(spelc: string, tag: string): string {
  return `${spelc}-${tag}`;
}

/**
 * Tag de campagne d'une relance réelle (mail ou SMS) — généré automatiquement,
 * plus de saisie libre par l'admin Spelc : "relance-mail-<date>-<Spelc>" ou
 * "relance-SMS-<date>-<Spelc>", daté du jour de l'envoi.
 */
function campagneTagAuto(kind: "mail" | "sms", spelc: string): string {
  const date = dayjs().format("YYYY-MM-DD");
  return kind === "mail" ? `relance-mail-${date}-${spelc}` : `relance-SMS-${date}-${spelc}`;
}

/** Bannière de campagne nationale fixe (champ {{logo_rugby}}), image-baked
 * (backend/assets), pas de gestion par l'admin Spelc. */
const RUGBY_BANNER_PATH = "/api/assets/logo/rugby.png";

/** Démo "relance-only" : pas de gestion de logo par l'admin (voir
 * AdminSpelcDashboard.tsx), donc le logo du Spelc fédéral est fixe, ajouté en
 * tête de chaque mail plutôt que laissé au modèle (voir DEFAULT_EMAIL_TEMPLATE_SIMPLE
 * qui ne le référence plus depuis qu'il a été vidé). */
function withDemoLogo(html: string): string {
  return isRelanceOnly() ? buildLogoHtml("/api/assets/logo/spelc.png") + html : html;
}

/** Crédits mail restants sur le compte Brevo (miroir de findMailCredits,
 * AdminSpelcDashboard.tsx) — seul le bandeau d'avertissement côté
 * interface s'appuyait dessus jusqu'ici ; une campagne mail pouvait donc
 * être lancée même avec des crédits insuffisants, sans aucun blocage
 * serveur (voir /campaigns/email ci-dessous). */
function findMailCredits(plan: { type: string; credits: number }[]): number | null {
  return plan.find((p) => !p.type.toLowerCase().includes("sms"))?.credits ?? null;
}

/** Délai entre deux envois Brevo successifs d'une même campagne, pour ne
 * pas saturer l'API (plusieurs Spelcs partagent la même clé Brevo) — la
 * limite de débit Brevo elle-même est gérée par fetchWithRetry côté
 * services/brevo.ts (voir sendBrevoEmails/sendBrevoSms). */
const SEND_THROTTLE_MS = 100;

const router = Router();
router.use(requireAuth);

function assertSpelcAccess(req: import("express").Request, res: import("express").Response, spelc: string): boolean {
  if (!canAccessSpelc(req.user!, spelcAcademies(spelc), spelc)) {
    res.status(403).json({ error: "Accès non autorisé à ce Spelc." });
    return false;
  }
  return true;
}

/**
 * Clé API Brevo : unique pour tous les syndicats adhérents, configurée par
 * l'admin général (onglet "Paramètres", voir /admin/brevo-settings) — plus
 * de clé par compte admin Spelc. Crédits mail/SMS restants sur ce compte,
 * lus en lecture seule ici par un admin Spelc pour avertir avant l'envoi
 * d'une campagne (voir /campaigns/preview côté frontend).
 */
router.get("/account", requireRole("admin_spelc", "admin_general"), async (_req, res) => {
  const apiKey = getBrevoApiKey();
  if (!apiKey) {
    res.status(400).json({ error: "Clé API Brevo non configurée (contactez l'administrateur général)." });
    return;
  }
  const info = await fetchAccountInfo(apiKey);
  if (!info) {
    res.status(400).json({ error: "Impossible de récupérer les informations du compte Brevo (clé invalide ?)." });
    return;
  }
  res.json(info);
});

router.get("/templates/email", requireRole("admin_spelc", "admin_general"), (req, res) => {
  const spelc = req.query.spelc as string;
  if (!spelc || !assertSpelcAccess(req, res, spelc)) return;
  const row = db.prepare("SELECT subject, body FROM email_templates WHERE spelc = ?").get(spelc) as
    | { subject: string; body: string }
    | undefined;
  res.json(row ?? { subject: "", body: "" });
});

router.put("/templates/email", requireRole("admin_spelc", "admin_general"), (req, res) => {
  const spelc = (req.body?.spelc as string) || req.user!.spelc || "";
  if (!spelc || !assertSpelcAccess(req, res, spelc)) return;
  const { subject = "", body = "" } = req.body ?? {};
  db.prepare(
    `INSERT INTO email_templates (spelc, subject, body, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(spelc) DO UPDATE SET subject = excluded.subject, body = excluded.body, updated_at = datetime('now')`
  ).run(spelc, String(subject), String(body));
  res.json({ ok: true });
});

router.get("/templates/sms", requireRole("admin_spelc", "admin_general"), (req, res) => {
  const spelc = req.query.spelc as string;
  if (!spelc || !assertSpelcAccess(req, res, spelc)) return;
  const row = db.prepare("SELECT body FROM sms_templates WHERE spelc = ?").get(spelc) as
    | { body: string }
    | undefined;
  res.json(row ?? { body: "" });
});

router.put("/templates/sms", requireRole("admin_spelc", "admin_general"), (req, res) => {
  const spelc = (req.body?.spelc as string) || req.user!.spelc || "";
  if (!spelc || !assertSpelcAccess(req, res, spelc)) return;
  const { body = "" } = req.body ?? {};
  db.prepare(
    `INSERT INTO sms_templates (spelc, body, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(spelc) DO UPDATE SET body = excluded.body, updated_at = datetime('now')`
  ).run(spelc, String(body));
  res.json({ ok: true });
});

/** Tous les Spelc connus du référentiel (voir ref_spelc / GET /admin/reference/spelcs). */
function allSpelcNames(): string[] {
  return (db.prepare("SELECT spelc FROM ref_spelc ORDER BY spelc").all() as { spelc: string }[]).map((r) => r.spelc);
}

/**
 * Écrase le modèle de mail de TOUS les Spelc par ce contenu — chaque Spelc
 * n'ayant jusqu'ici qu'un modèle propre à son propre compte (table
 * email_templates, clé primaire spelc), rien ne permettait de propager un
 * modèle "officiel" à tous les comptes admin Spelc sans passer un par un par
 * chaque compte. Réservé à l'admin général ; écrase sans confirmation
 * supplémentaire le modèle existant de chaque Spelc, y compris une
 * éventuelle personnalisation déjà en place.
 */
router.put("/templates/email/apply-to-all", requireRole("admin_general"), (req, res) => {
  const { subject = "", body = "" } = req.body ?? {};
  const spelcs = allSpelcNames();
  const upsert = db.prepare(
    `INSERT INTO email_templates (spelc, subject, body, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(spelc) DO UPDATE SET subject = excluded.subject, body = excluded.body, updated_at = datetime('now')`
  );
  db.transaction((names: string[]) => {
    for (const s of names) upsert.run(s, String(subject), String(body));
  })(spelcs);
  res.json({ applied: spelcs.length });
});

/** Équivalent SMS de /templates/email/apply-to-all, voir ce commentaire. */
router.put("/templates/sms/apply-to-all", requireRole("admin_general"), (req, res) => {
  const { body = "" } = req.body ?? {};
  const spelcs = allSpelcNames();
  const upsert = db.prepare(
    `INSERT INTO sms_templates (spelc, body, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(spelc) DO UPDATE SET body = excluded.body, updated_at = datetime('now')`
  );
  db.transaction((names: string[]) => {
    for (const s of names) upsert.run(s, String(body));
  })(spelcs);
  res.json({ applied: spelcs.length });
});

/**
 * Réglages propres à un Spelc pour ses relances : logo + réseaux sociaux
 * insérés dans ses modèles de mail, et mail/mobile de test propres à ce
 * Spelc (utilisés en priorité sur le mail/mobile de test global de l'admin
 * général, réservé lui aux relances PSA).
 */
router.get("/spelc-settings", requireRole("admin_spelc", "admin_general"), (req, res) => {
  const spelc = req.query.spelc as string;
  if (!spelc || !assertSpelcAccess(req, res, spelc)) return;
  res.json(getSpelcSettings(spelc));
});

router.put("/spelc-settings", requireRole("admin_spelc", "admin_general"), (req, res) => {
  const spelc = (req.body?.spelc as string) || req.user!.spelc || "";
  if (!spelc || !assertSpelcAccess(req, res, spelc)) return;
  const { logoDataUri, socialLinks, testEmail, testMobile, smsSender } = req.body ?? {};
  if (typeof smsSender === "string" && smsSender && !isValidSmsSender(smsSender)) {
    res.status(400).json({
      error: "Expéditeur SMS invalide : 11 caractères maximum, lettres et chiffres uniquement, au moins une lettre.",
    });
    return;
  }
  updateSpelcSettings(spelc, {
    logoDataUri: typeof logoDataUri === "string" ? logoDataUri : undefined,
    socialLinks: socialLinks && typeof socialLinks === "object" ? (socialLinks as SocialLinks) : undefined,
    testEmail: typeof testEmail === "string" ? testEmail : undefined,
    testMobile: typeof testMobile === "string" ? testMobile : undefined,
    smsSender: typeof smsSender === "string" ? smsSender : undefined,
  });
  res.json({ ok: true });
});

interface Recipient {
  nom: string;
  prenom: string;
  mail: string | null;
  mobile: string | null;
  /** Établissement (local en priorité, sinon national) de l'émargement
   * ayant permis le rapprochement — null si l'adhérent n'a été retrouvé
   * dans aucun des deux scrutins, ou si l'émargement n'en précise pas. */
  etablissement: string | null;
  votantLocal: number | null;
  scrutinLocal: string | null;
  votantNational: number | null;
  /** Un adhérent sans aucune ligne d'émargement correspondante (nom/prénom non
   * retrouvé dans l'import du scrutin) n'est pas forcément un non-votant —
   * on n'a tout simplement aucune donnée sur lui pour ce scrutin. Distingue
   * ce cas de "retrouvé, mais n'a pas encore voté". */
  localMatched: number;
  nationalMatched: number;
}

interface EmargementIdentityRow {
  nom_norm: string;
  prenom_norm: string;
  votant: number;
  scrutin_type: string | null;
  affectation: string | null;
}

/** Émargements de ce seul Spelc (local ou national) pour les imports donnés
 * — jamais tout l'import national : voir la note sur buildAdherentIdentitySets
 * (services/fuzzyMatching.ts) sur le coût d'une sous-requête corrélée réévaluée
 * pour chaque ligne d'un import national de plusieurs centaines de milliers
 * d'électeurs. Ce filtre `spelc = ?` (indexé) élimine ce risque dès la
 * requête : le reste de l'appariement se fait ensuite en mémoire, sur un
 * volume borné à ce seul Spelc. */
function loadEmargementIdentities(spelc: string, importIds: number[]): EmargementIdentityRow[] {
  if (importIds.length === 0) return [];
  const placeholders = importIds.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT nom_norm, prenom_norm, votant, scrutin_type, affectation FROM emargements WHERE spelc = ? AND import_id IN (${placeholders})`
    )
    .all(spelc, ...importIds) as EmargementIdentityRow[];
}

/** Index "nom_norm|prenom_norm" -> vote agrégé (votant si AU MOINS une ligne
 * votante, dernier scrutin_type/affectation non nul rencontré) — équivalent
 * du MAX(el.votant)/MAX(el.scrutin_type) GROUP BY de l'ancienne requête SQL. */
function indexEmargements(
  rows: EmargementIdentityRow[]
): Map<string, { votant: number; scrutinType: string | null; affectation: string | null }> {
  const map = new Map<string, { votant: number; scrutinType: string | null; affectation: string | null }>();
  for (const r of rows) {
    const key = `${r.nom_norm}|${r.prenom_norm}`;
    const existing = map.get(key);
    if (existing) {
      if (r.votant) existing.votant = 1;
      if (r.scrutin_type) existing.scrutinType = r.scrutin_type;
      if (r.affectation) existing.affectation = r.affectation;
    } else {
      map.set(key, { votant: r.votant ? 1 : 0, scrutinType: r.scrutin_type ?? null, affectation: r.affectation ?? null });
    }
  }
  return map;
}

/**
 * Adhérents du Spelc, croisés par nom/prénom à la fois avec le scrutin
 * national CCMMEP et avec les scrutins locaux (1D+2D) — nécessaire pour les
 * champs de template CCMMEP_non_votant / scrutin_local_non_votant /
 * scrutin_local. Rapprochement exact ET approximatif validé (comme avant),
 * mais calculé en mémoire plutôt que par une sous-requête SQL corrélée par
 * ligne (voir loadEmargementIdentities ci-dessus) : avec le fichier national
 * CCMMEP (toutes académies, potentiellement des centaines de milliers de
 * lignes), l'ancienne requête — un LEFT JOIN dont la condition ON mêle une
 * égalité ET un OR EXISTS corrélé à l'adhérent — empêchait SQLite d'utiliser
 * l'index sur emargements(spelc, ...) et finissait par scanner l'intégralité
 * de la table national pour chaque adhérent, d'où un temps de réponse de
 * plusieurs dizaines de secondes.
 */
function matchedAdherents(spelc: string): Recipient[] {
  const academies = spelcAcademies(spelc);
  if (academies.length === 0) return [];
  // Un Spelc peut être à cheval sur plusieurs académies (ex.
  // "Centre-Poitou-Charente" sur Orléans-Tours ET Poitiers) : un de ses
  // adhérents peut être électeur dans n'importe laquelle selon son
  // département, donc on cherche dans les émargements locaux de TOUTES.
  const localImportIds = academies.flatMap((academie) => currentImportIds("academique", academie));
  const nationalImportIds = currentImportIds("national", null);
  if (localImportIds.length === 0 && nationalImportIds.length === 0) return [];

  const adherentRows = db
    .prepare("SELECT id, nom, prenom, mail, mobile, nom_norm, prenom_norm FROM adherents WHERE spelc = ?")
    .all(spelc) as { id: number; nom: string; prenom: string; mail: string | null; mobile: string | null; nom_norm: string; prenom_norm: string }[];
  if (adherentRows.length === 0) return [];

  // Rattachées à l'identité (nom/prénom normalisés) de l'adhérent, pas à un
  // adherent_id qui ne survit pas à un réimport du fichier adhérents — voir
  // le commentaire de la table adherent_fuzzy_matches dans db/index.ts.
  const fuzzyByIdentity = new Map<string, { nom_norm: string; prenom_norm: string }[]>();
  const fuzzyRows = db
    .prepare(
      `SELECT adherent_nom_norm, adherent_prenom_norm, candidate_nom_norm, candidate_prenom_norm FROM adherent_fuzzy_matches
       WHERE status = 'valide' AND spelc = ?`
    )
    .all(spelc) as { adherent_nom_norm: string; adherent_prenom_norm: string; candidate_nom_norm: string; candidate_prenom_norm: string }[];
  for (const r of fuzzyRows) {
    const key = `${r.adherent_nom_norm}|${r.adherent_prenom_norm}`;
    const arr = fuzzyByIdentity.get(key) ?? [];
    arr.push({ nom_norm: r.candidate_nom_norm, prenom_norm: r.candidate_prenom_norm });
    fuzzyByIdentity.set(key, arr);
  }

  const localIndex = indexEmargements(loadEmargementIdentities(spelc, localImportIds));
  const nationalIndex = indexEmargements(loadEmargementIdentities(spelc, nationalImportIds));

  function lookup(
    a: { nom_norm: string; prenom_norm: string },
    index: Map<string, { votant: number; scrutinType: string | null; affectation: string | null }>
  ) {
    const exact = index.get(`${a.nom_norm}|${a.prenom_norm}`);
    if (exact) return exact;
    for (const candidate of fuzzyByIdentity.get(`${a.nom_norm}|${a.prenom_norm}`) ?? []) {
      const viaFuzzy = index.get(`${candidate.nom_norm}|${candidate.prenom_norm}`);
      if (viaFuzzy) return viaFuzzy;
    }
    return null;
  }

  return adherentRows.map((a) => {
    const local = lookup(a, localIndex);
    const national = lookup(a, nationalIndex);
    return {
      nom: a.nom,
      prenom: a.prenom,
      mail: a.mail,
      mobile: a.mobile,
      etablissement: local?.affectation ?? national?.affectation ?? null,
      votantLocal: local ? local.votant : null,
      scrutinLocal: local ? local.scrutinType : null,
      votantNational: national ? national.votant : null,
      localMatched: local ? 1 : 0,
      nationalMatched: national ? 1 : 0,
    };
  });
}

function templateFieldsFor(r: Recipient, spelc: string): TemplateFields {
  const scrutinLocal = r.scrutinLocal ?? "";
  const votantLocal = Boolean(r.votantLocal);
  const settings = getSpelcSettings(spelc);
  return {
    nom: r.nom,
    prenom: r.prenom,
    scrutin_local: scrutinLocal,
    CCMMEP_non_votant: Boolean(r.nationalMatched) && !r.votantNational,
    scrutin_local_non_votant: Boolean(r.localMatched) && !votantLocal,
    // alias conservés pour compatibilité avec d'anciens modèles
    scrutin: scrutinLocal,
    votant: votantLocal,
    logo_spelc: buildLogoHtml(settings.logoDataUri),
    logo_rugby: buildBannerHtml(RUGBY_BANNER_PATH, "Transformez l'essai ! Votez 2 fois Spelc"),
    reseaux_sociaux: buildSocialLinksHtml(settings.socialLinks),
  };
}

/** Mail/mobile de test propres au Spelc si configurés, sinon ceux globaux de l'admin général. */
function resolveTestContact(spelc: string): { testEmail: string | null; testMobile: string | null } {
  const spelcSettings = getSpelcSettings(spelc);
  const global = getTestContactSettings();
  return {
    testEmail: spelcSettings.testEmail || global.testEmail,
    testMobile: spelcSettings.testMobile || global.testMobile,
  };
}

/** Expéditeur SMS de ce Spelc si configuré, sinon une suggestion calculée à partir de son nom. */
function resolveSmsSender(spelc: string): string {
  return getSpelcSettings(spelc).smsSender || suggestSmsSender(spelc);
}

/**
 * Une personne est ciblée par une relance si elle est retrouvée dans les
 * émargements d'AU MOINS un des deux scrutins et n'y a pas encore voté. Un
 * adhérent absent des deux listes d'émargement (nom/prénom non reconnu, ou
 * simplement pas électeur à ce scrutin) n'est jamais ciblé : on n'a aucune
 * donnée de vote sur lui, ce n'est pas un non-votant.
 */
function needsRelance(r: Recipient): boolean {
  return (Boolean(r.nationalMatched) && !r.votantNational) || (Boolean(r.localMatched) && !r.votantLocal);
}

function firstNonVotantAdherent(spelc: string): Recipient | null {
  return matchedAdherents(spelc).find(needsRelance) ?? null;
}

/**
 * Envoie un mail/SMS de test unique, en utilisant le contenu actuellement
 * saisi (pas forcément encore enregistré) et les champs dynamiques du
 * premier adhérent non-votant du Spelc — pour prévisualiser le rendu réel
 * sans attendre d'enregistrer puis de lancer une vraie campagne.
 */
router.post("/templates/email/test", requireRole("admin_spelc", "admin_general"), async (req, res) => {
  const spelc = (req.body?.spelc as string) || req.user!.spelc || "";
  if (!spelc || !assertSpelcAccess(req, res, spelc)) return;
  const { subject = "", body = "" } = req.body ?? {};
  const testEmail = resolveTestContact(spelc).testEmail;
  if (!testEmail) {
    res.status(400).json({ error: "Renseigner votre mail." });
    return;
  }
  const apiKey = getBrevoApiKey();
  if (!apiKey) {
    res.status(400).json({ error: "Clé API Brevo non configurée (contactez l'administrateur général)." });
    return;
  }
  const recipient = firstNonVotantAdherent(spelc);
  if (!recipient) {
    res.status(400).json({ error: "Aucun adhérent non-votant disponible pour prévisualiser le modèle." });
    return;
  }
  const fields = templateFieldsFor(recipient, spelc);
  const result = await sendBrevoEmails({
    apiKey,
    to: [{ email: testEmail, name: `${recipient.prenom} ${recipient.nom}` }],
    subject: renderTemplate(String(subject), fields),
    htmlContent: wrapEmailHtml(withDemoLogo(renderTemplate(ensureSiteLink(String(body)), fields))),
    tag: "test-modele",
  });
  appendRelanceLog({
    timestamp: new Date().toISOString(),
    type: "mail",
    provider: "Brevo",
    scope: spelc,
    campagneTag: "test-modele",
    nom: recipient.nom,
    prenom: recipient.prenom,
    contact: testEmail,
    testMode: true,
    success: result.sent > 0,
  });
  insertRelanceTracking({
    ownerUserId: req.user!.id,
    type: "mail",
    scope: spelc,
    campagneTag: "test-modele",
    nom: recipient.nom,
    prenom: recipient.prenom,
    contact: testEmail,
    testMode: true,
    sendOk: result.sent > 0,
    messageId: result.messageId,
    errorMessage: result.errorMessage,
  });
  res.json({ sent: result.sent, errors: result.errors, errorMessage: result.errorMessage });
});

router.post("/templates/sms/test", requireRole("admin_spelc", "admin_general"), async (req, res) => {
  const spelc = (req.body?.spelc as string) || req.user!.spelc || "";
  if (!spelc || !assertSpelcAccess(req, res, spelc)) return;
  const { body = "" } = req.body ?? {};
  const testMobile = resolveTestContact(spelc).testMobile;
  if (!testMobile) {
    res.status(400).json({ error: "Renseigner le numéro de mobile." });
    return;
  }
  const apiKey = getBrevoApiKey();
  if (!apiKey) {
    res.status(400).json({ error: "Clé API Brevo non configurée (contactez l'administrateur général)." });
    return;
  }
  if (smsQuotaStatus(spelc).reached) {
    res.status(400).json({ error: "Plafond de crédits SMS atteint pour ce Spelc : plus aucun envoi SMS possible." });
    return;
  }
  const recipient = firstNonVotantAdherent(spelc);
  if (!recipient) {
    res.status(400).json({ error: "Aucun adhérent non-votant disponible pour prévisualiser le modèle." });
    return;
  }
  const fields = templateFieldsFor(recipient, spelc);
  const campagneTag = smsCampagneTag(spelc, "test-modele");
  const content = renderTemplate(String(body), fields);
  const result = await sendBrevoSms({
    apiKey,
    recipients: [normalizeFrenchMobile(testMobile)],
    content,
    tag: campagneTag,
    sender: resolveSmsSender(spelc),
  });
  appendRelanceLog({
    timestamp: new Date().toISOString(),
    type: "sms",
    provider: "Brevo",
    scope: spelc,
    campagneTag,
    nom: recipient.nom,
    prenom: recipient.prenom,
    contact: testMobile,
    testMode: true,
    success: result.sent > 0,
  });
  insertRelanceTracking({
    ownerUserId: req.user!.id,
    type: "sms",
    scope: spelc,
    campagneTag,
    nom: recipient.nom,
    prenom: recipient.prenom,
    contact: normalizeFrenchMobile(testMobile),
    testMode: true,
    sendOk: result.sent > 0,
    messageId: result.messageId,
    errorMessage: result.errorMessage,
    credits: smsSegmentCount(content),
  });
  res.json({ sent: result.sent, errors: result.errors, errorMessage: result.errorMessage });
});

/**
 * Parmi `recipients`, ceux dont la situation RÉELLE (sans aucun forçage)
 * correspond déjà exactement à `overrides` — ex. pour le cas "CCMMEP non
 * voté et scrutin local non voté", un adhérent réellement non-votant aux
 * deux scrutins, pas un adhérent quelconque sur qui on forcerait ces deux
 * champs. Utilisé pour montrer un adhérent authentiquement représentatif de
 * chaque cas de test plutôt que toujours le même (voir buildIfTestCases),
 * avec un repli sur le forçage de champs seulement si aucun adhérent réel
 * ne correspond à cette combinaison précise.
 */
function recipientsMatchingCase(recipients: Recipient[], spelc: string, overrides: Record<string, boolean>): Recipient[] {
  return recipients.filter((r) => {
    const fields = templateFieldsFor(r, spelc);
    return Object.entries(overrides).every(([key, value]) => Boolean(fields[key]) === value);
  });
}

/**
 * Aperçu du mail de relance (contenu actuellement saisi à l'écran, pas
 * forcément encore enregistré) — même pipeline de rendu que l'envoi réel
 * (renderTemplate + wrapEmailHtml + ensureSiteLink), mais sans aucun envoi.
 * Un cas par condition {{#if ...}} distincte du modèle (voir
 * buildIfTestCases) : pour chaque cas, on cherche un adhérent réellement
 * dans cette situation (recipientsMatchingCase) pour montrer un rendu
 * authentique avec un nom différent par cas plutôt que toujours le même ;
 * à défaut (aucun adhérent réel ne correspond à cette combinaison), on
 * retombe sur le premier adhérent non-votant avec les deux champs booléens
 * forcés, comme avant. Un modèle sans aucun {{#if}} ne produit qu'un seul
 * cas (comportement inchangé).
 */
router.post("/templates/email/preview", requireRole("admin_spelc", "admin_general"), (req, res) => {
  const spelc = (req.body?.spelc as string) || req.user!.spelc || "";
  if (!spelc || !assertSpelcAccess(req, res, spelc)) return;
  const { subject = "", body = "" } = req.body ?? {};
  const fallbackRecipient = firstNonVotantAdherent(spelc);
  if (!fallbackRecipient) {
    res.status(400).json({ error: "Aucun adhérent non-votant disponible pour prévisualiser le modèle." });
    return;
  }
  const pool = matchedAdherents(spelc);
  const testCases = buildIfTestCases(`${String(subject)}\n${String(body)}`);
  res.json({
    cases: testCases.map(({ label, overrides }) => {
      const recipient = recipientsMatchingCase(pool, spelc, overrides)[0] ?? fallbackRecipient;
      const fields = { ...templateFieldsFor(recipient, spelc), ...overrides };
      return {
        label: `${label} — ${recipient.prenom} ${recipient.nom}`,
        subject: renderTemplate(String(subject), fields),
        html: wrapEmailHtml(withDemoLogo(renderTemplate(ensureSiteLink(String(body)), fields))),
      };
    }),
  });
});

/**
 * Aperçu du SMS de relance : un cas par condition {{#if ...}} distincte du
 * modèle (voir buildIfTestCases, même principe que l'aperçu du mail). Pour
 * chaque cas, on cherche d'abord les adhérents réellement dans cette
 * situation (recipientsMatchingCase) — à défaut (aucun adhérent réel ne
 * correspond), on retombe sur tous les adhérents ciblés avec les champs
 * forcés, comme avant. Dans les deux cas, celui dont le message rendu
 * consomme le plus de crédits est retenu : le pire cas de facturation pour
 * cette branche (pas forcément le message le plus long en caractères : un
 * message plus court mais encodé en UCS-2, voir smsSegmentCount, peut
 * coûter plus cher qu'un message plus long resté en GSM-7). Un modèle sans
 * aucun {{#if}} ne produit qu'un seul cas (comportement inchangé).
 */
router.post("/templates/sms/preview", requireRole("admin_spelc", "admin_general"), (req, res) => {
  const spelc = (req.body?.spelc as string) || req.user!.spelc || "";
  if (!spelc || !assertSpelcAccess(req, res, spelc)) return;
  const { body = "" } = req.body ?? {};
  const recipients = matchedAdherents(spelc).filter((r) => r.mobile).filter(needsRelance);
  if (recipients.length === 0) {
    res.status(400).json({ error: "Aucun adhérent non-votant avec mobile disponible pour prévisualiser le modèle." });
    return;
  }
  const testCases = buildIfTestCases(String(body));
  const cases = testCases.map(({ label, overrides }) => {
    const genuineMatches = recipientsMatchingCase(recipients, spelc, overrides);
    const pool = genuineMatches.length > 0 ? genuineMatches : recipients;
    let worst = "";
    let worstCredits = 0;
    let worstRecipient: Recipient | null = null;
    for (const r of pool) {
      const fields = { ...templateFieldsFor(r, spelc), ...overrides };
      const rendered = renderTemplate(String(body), fields);
      const credits = smsSegmentCount(rendered);
      if (credits > worstCredits || (credits === worstCredits && rendered.length > worst.length)) {
        worst = rendered;
        worstCredits = credits;
        worstRecipient = r;
      }
    }
    const encodingInfo = analyzeSmsEncoding(worst);
    return {
      label: worstRecipient ? `${label} — ${worstRecipient.prenom} ${worstRecipient.nom}` : label,
      content: worst,
      length: worst.length,
      credits: worstCredits,
      encoding: encodingInfo.encoding,
      maxCharsPerSegment: encodingInfo.maxCharsPerSegment,
      offendingChars: encodingInfo.offendingChars,
    };
  });
  res.json({ cases });
});

/**
 * Nombre de destinataires que toucherait réellement une campagne — calculé
 * avec exactement la même logique de ciblage que les envois réels ci-dessous,
 * pour que l'admin Spelc puisse comparer ce nombre à ses crédits Brevo
 * restants avant de lancer l'envoi plutôt que de le découvrir après coup.
 */
router.get("/campaigns/preview", requireRole("admin_spelc"), (req, res) => {
  const spelc = req.user!.spelc!;

  const adherents = matchedAdherents(spelc);
  // Tant qu'aucun fichier d'émargement n'a été importé, matchedAdherents()
  // renvoie [] (voir plus haut) : on ne peut encore confirmer ni vote ni
  // rapprochement pour personne, donc tout le monde reste à relancer — le
  // total des adhérents uploadés. Dès qu'un import existe, matchedAdherents()
  // renvoie une ligne par adhérent (retrouvé ou non), et needsRelance() exige
  // d'être retrouvé (exact ou rapprochement validé) ET non-votant : un
  // adhérent jamais retrouvé n'est donc plus compté, pour rester cohérent
  // avec le ciblage réel des envois (mailRecipients/smsRecipients
  // ci-dessous, qui appliquent déjà ce même filtre).
  const totalAdherents = (db.prepare("SELECT COUNT(*) AS c FROM adherents WHERE spelc = ?").get(spelc) as { c: number }).c;
  const restantARelancer = adherents.length === 0 ? totalAdherents : adherents.filter(needsRelance).length;

  const mailRecipients = adherents.filter((r) => r.mail).filter(needsRelance);
  const smsRecipients = adherents.filter((r) => r.mobile).filter(needsRelance);

  res.json({ mailRecipients: mailRecipients.length, smsRecipients: smsRecipients.length, restantARelancer });
});

/**
 * Détail nommé des adhérents restant à relancer (même filtre que
 * `restantARelancer` ci-dessus) — voir la carte "Adhérents à relancer" du
 * tableau de bord Spelc : liste triable/filtrable, contrairement au simple
 * compteur de /campaigns/preview.
 */
router.get("/campaigns/recipients", requireRole("admin_spelc"), (req, res) => {
  const spelc = req.user!.spelc!;
  const recipients = matchedAdherents(spelc)
    .filter(needsRelance)
    .map((r) => ({
      nom: r.nom,
      prenom: r.prenom,
      etablissement: r.etablissement,
      mail: r.mail,
      mobile: r.mobile,
    }));
  res.json({ recipients });
});

/**
 * Date/heure du dernier import académique (1er et 2nd degré) de la ou des
 * académies de ce Spelc — pour que l'admin Spelc sache si le fichier
 * d'émargement utilisé pour cibler ses relances est à jour, directement
 * depuis cette page (sans avoir à aller vérifier l'onglet Imports de l'admin
 * académique). Un Spelc à cheval sur plusieurs académies (ex.
 * "Centre-Poitou-Charente" sur Orléans-Tours et Poitiers) a une ligne par
 * académie : chacune a son propre scrutin local, importé séparément.
 */
router.get("/last-imports", requireRole("admin_spelc"), (req, res) => {
  const spelc = req.user!.spelc!;
  const academies = spelcAcademies(spelc);
  const result = academies.map((academie) => {
    const ids = currentImportIds("academique", academie);
    if (ids.length === 0) return { academie, degre1D: null, degre2D: null };
    const rows = db
      .prepare(`SELECT degre, imported_at FROM imports WHERE id IN (${ids.map(() => "?").join(",")})`)
      .all(...ids) as { degre: string; imported_at: string }[];
    return {
      academie,
      degre1D: rows.find((r) => r.degre === "1D")?.imported_at ?? null,
      degre2D: rows.find((r) => r.degre === "2D")?.imported_at ?? null,
    };
  });
  res.json({ academies: result });
});

router.post("/campaigns/email", requireRole("admin_spelc"), async (req, res) => {
  const spelc = req.user!.spelc!;
  const { onlyNonVotants = true } = req.body ?? {};
  const apiKey = getBrevoApiKey();
  if (!apiKey) {
    res.status(400).json({ error: "Clé API Brevo non configurée (contactez l'administrateur général)." });
    return;
  }
  const template = db.prepare("SELECT subject, body FROM email_templates WHERE spelc = ?").get(spelc) as
    | { subject: string; body: string }
    | undefined;
  if (!template) {
    res.status(400).json({ error: "Aucun modèle de mail configuré." });
    return;
  }

  let recipients = matchedAdherents(spelc).filter((r) => r.mail);
  if (onlyNonVotants) recipients = recipients.filter(needsRelance);

  const to = recipients.map((r) => ({
    email: r.mail!,
    name: `${r.prenom} ${r.nom}`,
    nom: r.nom,
    prenom: r.prenom,
    subject: renderTemplate(template.subject, templateFieldsFor(r, spelc)),
    html: wrapEmailHtml(withDemoLogo(renderTemplate(ensureSiteLink(template.body), templateFieldsFor(r, spelc)))),
  }));

  // Vérification des crédits mail Brevo AVANT l'envoi : jusqu'ici seul un
  // bandeau informatif côté interface (voir AdminSpelcDashboard.tsx)
  // prévenait, sans empêcher l'admin de lancer quand même une campagne
  // vouée à échouer en partie faute de crédits.
  const account = await fetchAccountInfo(apiKey);
  if (account) {
    const mailCredits = findMailCredits(account.plan);
    if (mailCredits !== null && to.length > mailCredits) {
      res.status(400).json({
        error: `Crédits mail Brevo insuffisants : ${to.length} destinataire(s) ciblé(s), mais seulement ${mailCredits} crédit(s) mail restant(s) sur le compte Brevo.`,
      });
      return;
    }
  }

  const campagneTag = campagneTagAuto("mail", spelc);

  // Brevo n'acceptant pas un contenu par destinataire en un seul appel groupé sans template,
  // on envoie chaque email individuellement avec son contenu personnalisé.
  let sent = 0;
  let errors = 0;
  let alreadySent = 0;
  for (const item of to) {
    // Protège contre un double envoi de la même relance (double-clic,
    // requête relancée après un délai, deux onglets ouverts en même temps) :
    // si ce destinataire a déjà reçu cette campagne (même tag, donc même
    // jour) avec succès, on ne renvoie pas — voir hasAlreadySent.
    if (hasAlreadySent(spelc, "mail", campagneTag, item.email)) {
      alreadySent++;
      continue;
    }
    const result = await sendBrevoEmails({
      apiKey,
      to: [{ email: item.email, name: item.name }],
      subject: item.subject,
      htmlContent: item.html,
      tag: campagneTag,
    });
    sent += result.sent;
    errors += result.errors;
    appendRelanceLog({
      timestamp: new Date().toISOString(),
      type: "mail",
      provider: "Brevo",
      scope: spelc,
      campagneTag,
      nom: item.nom,
      prenom: item.prenom,
      contact: item.email,
      testMode: false,
      success: result.sent > 0,
    });
    insertRelanceTracking({
      ownerUserId: req.user!.id,
      type: "mail",
      scope: spelc,
      campagneTag,
      nom: item.nom,
      prenom: item.prenom,
      contact: item.email,
      testMode: false,
      sendOk: result.sent > 0,
      messageId: result.messageId,
      errorMessage: result.errorMessage,
    });
    await sleep(SEND_THROTTLE_MS);
  }

  res.status(201).json({ sent, errors, alreadySent, total: to.length });
});

router.post("/campaigns/sms", requireRole("admin_spelc"), async (req, res) => {
  const spelc = req.user!.spelc!;
  const { onlyNonVotants = true } = req.body ?? {};
  const apiKey = getBrevoApiKey();
  if (!apiKey) {
    res.status(400).json({ error: "Clé API Brevo non configurée (contactez l'administrateur général)." });
    return;
  }
  if (smsQuotaStatus(spelc).reached) {
    const quotaStatus = smsQuotaStatus(spelc);
    res.status(400).json({
      error: `Plafond de crédits SMS atteint pour ce Spelc (${quotaStatus.used}/${quotaStatus.quota}) : plus aucune campagne SMS possible.`,
    });
    return;
  }
  const template = db.prepare("SELECT body FROM sms_templates WHERE spelc = ?").get(spelc) as
    | { body: string }
    | undefined;
  if (!template) {
    res.status(400).json({ error: "Aucun modèle de SMS configuré." });
    return;
  }

  let recipients = matchedAdherents(spelc).filter((r) => r.mobile);
  if (onlyNonVotants) recipients = recipients.filter(needsRelance);

  const campagneTag = campagneTagAuto("sms", spelc);
  const smsSender = resolveSmsSender(spelc);
  let sent = 0;
  let errors = 0;
  let alreadySent = 0;
  // Plus de plafond manuel par envoi (voir AdminSpelcDashboard.tsx) : on
  // vérifie le plafond de crédits SMS du Spelc (services/smsQuota.ts) avant
  // CHAQUE envoi plutôt qu'une seule fois au début, pour ne jamais le
  // dépasser au fil d'une campagne qui toucherait plus de destinataires que
  // de crédits restants. Ce plafond compte désormais les crédits réels
  // (voir smsQuota.ts/smsSegmentCount), pas simplement le nombre de SMS.
  let quotaReached = false;
  for (const r of recipients) {
    if (smsQuotaStatus(spelc).reached) {
      quotaReached = true;
      break;
    }
    const content = renderTemplate(template.body, templateFieldsFor(r, spelc));
    const contact = normalizeFrenchMobile(r.mobile!);
    // Protège contre un double envoi de la même relance (double-clic,
    // requête relancée après un délai, deux onglets ouverts en même
    // temps) : si ce destinataire a déjà reçu cette campagne (même tag,
    // donc même jour) avec succès, on ne renvoie pas — voir hasAlreadySent.
    if (hasAlreadySent(spelc, "sms", campagneTag, contact)) {
      alreadySent++;
      continue;
    }
    const result = await sendBrevoSms({
      apiKey,
      recipients: [contact],
      content,
      tag: campagneTag,
      sender: smsSender,
    });
    sent += result.sent;
    errors += result.errors;
    appendRelanceLog({
      timestamp: new Date().toISOString(),
      type: "sms",
      provider: "Brevo",
      scope: spelc,
      campagneTag,
      nom: r.nom,
      prenom: r.prenom,
      contact,
      testMode: false,
      success: result.sent > 0,
    });
    insertRelanceTracking({
      ownerUserId: req.user!.id,
      type: "sms",
      scope: spelc,
      campagneTag,
      nom: r.nom,
      prenom: r.prenom,
      contact,
      testMode: false,
      sendOk: result.sent > 0,
      messageId: result.messageId,
      errorMessage: result.errorMessage,
      credits: smsSegmentCount(content),
    });
    await sleep(SEND_THROTTLE_MS);
  }

  res.status(201).json({ sent, errors, alreadySent, total: recipients.length, quotaReached });
});

/**
 * Statut du plafond de crédits SMS de ce Spelc (quota national réparti,
 * crédits déjà consommés, atteint ou non) — voir services/smsQuota.ts.
 * Aucun plafond configuré pour ce Spelc : quota = null, jamais bloquant.
 */
router.get("/sms-quota", requireRole("admin_spelc", "admin_general"), (req, res) => {
  const spelc = req.query.spelc as string;
  if (!spelc || !assertSpelcAccess(req, res, spelc)) return;
  res.json(smsQuotaStatus(spelc));
});

/** Série quotidienne pour la courbe de suivi des mails, calculée à partir du suivi par personne. */
router.get("/tracking/mail", requireRole("admin_spelc", "admin_general"), (req, res) => {
  const spelc = req.query.spelc as string;
  if (!spelc || !assertSpelcAccess(req, res, spelc)) return;
  res.json({ rows: getMailSeriesByScope(spelc) });
});

/** Série quotidienne pour la courbe de suivi des SMS, même principe. */
router.get("/tracking/sms", requireRole("admin_spelc", "admin_general"), (req, res) => {
  const spelc = req.query.spelc as string;
  if (!spelc || !assertSpelcAccess(req, res, spelc)) return;
  res.json({ rows: getSmsSeriesByScope(spelc) });
});

/**
 * Suivi par personne des relances de ce Spelc : statut d'envoi et clics,
 * mis à jour au fil du temps par le sondage périodique de l'API Brevo (voir
 * services/relanceTracking.ts) — le statut final et les clics n'arrivent
 * jamais au moment de l'envoi lui-même.
 */
router.get("/relance-tracking", requireRole("admin_spelc", "admin_general"), (req, res) => {
  const spelc = req.query.spelc as string;
  if (!spelc || !assertSpelcAccess(req, res, spelc)) return;
  const limit = Math.min(Number(req.query.limit) || 500, 2000);
  res.json({ rows: listRelanceTrackingByScope(spelc, limit) });
});

/** Sonde Brevo immédiatement pour les relances en attente de ce Spelc (bouton "Vérifier maintenant"). */
router.post("/relance-tracking/refresh", requireRole("admin_spelc", "admin_general"), async (req, res) => {
  const spelc = (req.body?.spelc as string) || req.user!.spelc || "";
  if (!spelc || !assertSpelcAccess(req, res, spelc)) return;
  const result = await refreshPendingRelanceTracking({ ownerUserId: req.user!.id, scope: spelc });
  res.json(result);
});

/** Efface tout le suivi détaillé des relances de ce Spelc (bouton "Effacer le suivi"). */
router.delete("/relance-tracking", requireRole("admin_spelc", "admin_general"), (req, res) => {
  const spelc = req.query.spelc as string;
  if (!spelc || !assertSpelcAccess(req, res, spelc)) return;
  const deleted = clearRelanceTrackingByScope(spelc);
  res.json({ deleted });
});

export default router;
