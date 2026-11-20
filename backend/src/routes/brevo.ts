import { Router } from "express";
import { db } from "../db/index.js";
import { requireAuth, requireRole, canAccessSpelc } from "../middleware/auth.js";
import { renderTemplate, type TemplateFields } from "../lib/template.js";
import { wrapEmailHtml, ensureSiteLink } from "../lib/emailLayout.js";
import { sendBrevoEmails, sendBrevoSms, fetchAccountInfo, getBrevoApiKey } from "../services/brevo.js";
import { currentImportIds } from "../services/stats.js";
import { getTestContactSettings } from "../services/settings.js";
import { getSpelcSettings, updateSpelcSettings } from "../services/spelcSettings.js";
import { buildLogoHtml, buildSocialLinksHtml, type SocialLinks } from "../lib/socialLinks.js";
import { appendRelanceLog } from "../lib/relanceLog.js";
import {
  insertRelanceTracking,
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

/** Préfixe le tag Brevo d'une campagne SMS par le nom du Spelc, pour que les
 * envois de chaque Spelc soient identifiables à la fois dans le tableau de
 * bord Brevo et dans le suivi interne (qui utilise déjà `scope`, indépendant
 * du tag, pour le calcul du plafond de crédits — voir services/smsQuota.ts). */
function smsCampagneTag(spelc: string, tag: string): string {
  return `${spelc}-${tag}`;
}

/** Démo "relance-only" : pas de gestion de logo par l'admin (voir
 * AdminSpelcDashboard.tsx), donc le logo du Spelc fédéral est fixe, ajouté en
 * tête de chaque mail plutôt que laissé au modèle (voir DEFAULT_EMAIL_TEMPLATE_SIMPLE
 * qui ne le référence plus depuis qu'il a été vidé). */
function withDemoLogo(html: string): string {
  return isRelanceOnly() ? buildLogoHtml("/api/assets/logo/spelc.png") + html : html;
}

const MAX_TEST_RECIPIENTS = 20;
const DEFAULT_TEST_RECIPIENTS = 3;

function clampTestLimit(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_TEST_RECIPIENTS;
  return Math.min(Math.floor(n), MAX_TEST_RECIPIENTS);
}

/** Plafond d'envoi SMS (réel ou test) pour éviter de consommer tous les crédits d'un coup. */
const MAX_SMS_SEND_LIMIT = 500;
const DEFAULT_SMS_SEND_LIMIT = 20;

function clampSmsLimit(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_SMS_SEND_LIMIT;
  return Math.min(Math.floor(n), MAX_SMS_SEND_LIMIT);
}

const router = Router();
router.use(requireAuth);

function spelcAcademie(spelc: string): string | null {
  const row = db.prepare("SELECT academie FROM ref_spelc WHERE spelc = ?").get(spelc) as
    | { academie: string }
    | undefined;
  return row?.academie ?? null;
}

function assertSpelcAccess(req: import("express").Request, res: import("express").Response, spelc: string): boolean {
  if (!canAccessSpelc(req.user!, spelcAcademie(spelc), spelc)) {
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
    .prepare(`SELECT nom_norm, prenom_norm, votant, scrutin_type FROM emargements WHERE spelc = ? AND import_id IN (${placeholders})`)
    .all(spelc, ...importIds) as EmargementIdentityRow[];
}

/** Index "nom_norm|prenom_norm" -> vote agrégé (votant si AU MOINS une ligne
 * votante, dernier scrutin_type non nul rencontré) — équivalent du
 * MAX(el.votant)/MAX(el.scrutin_type) GROUP BY de l'ancienne requête SQL. */
function indexEmargements(rows: EmargementIdentityRow[]): Map<string, { votant: number; scrutinType: string | null }> {
  const map = new Map<string, { votant: number; scrutinType: string | null }>();
  for (const r of rows) {
    const key = `${r.nom_norm}|${r.prenom_norm}`;
    const existing = map.get(key);
    if (existing) {
      if (r.votant) existing.votant = 1;
      if (r.scrutin_type) existing.scrutinType = r.scrutin_type;
    } else {
      map.set(key, { votant: r.votant ? 1 : 0, scrutinType: r.scrutin_type ?? null });
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
  const academie = spelcAcademie(spelc);
  if (!academie) return [];
  const localImportIds = currentImportIds("academique", academie);
  const nationalImportIds = currentImportIds("national", null);
  if (localImportIds.length === 0 && nationalImportIds.length === 0) return [];

  const adherentRows = db
    .prepare("SELECT id, nom, prenom, mail, mobile, nom_norm, prenom_norm FROM adherents WHERE spelc = ?")
    .all(spelc) as { id: number; nom: string; prenom: string; mail: string | null; mobile: string | null; nom_norm: string; prenom_norm: string }[];
  if (adherentRows.length === 0) return [];

  const fuzzyByAdherent = new Map<number, { nom_norm: string; prenom_norm: string }[]>();
  const ids = adherentRows.map((a) => a.id);
  const idPlaceholders = ids.map(() => "?").join(",");
  const fuzzyRows = db
    .prepare(
      `SELECT adherent_id, candidate_nom_norm, candidate_prenom_norm FROM adherent_fuzzy_matches
       WHERE status = 'valide' AND adherent_id IN (${idPlaceholders})`
    )
    .all(...ids) as { adherent_id: number; candidate_nom_norm: string; candidate_prenom_norm: string }[];
  for (const r of fuzzyRows) {
    const arr = fuzzyByAdherent.get(r.adherent_id) ?? [];
    arr.push({ nom_norm: r.candidate_nom_norm, prenom_norm: r.candidate_prenom_norm });
    fuzzyByAdherent.set(r.adherent_id, arr);
  }

  const localIndex = indexEmargements(loadEmargementIdentities(spelc, localImportIds));
  const nationalIndex = indexEmargements(loadEmargementIdentities(spelc, nationalImportIds));

  function lookup(a: { id: number; nom_norm: string; prenom_norm: string }, index: Map<string, { votant: number; scrutinType: string | null }>) {
    const exact = index.get(`${a.nom_norm}|${a.prenom_norm}`);
    if (exact) return exact;
    for (const candidate of fuzzyByAdherent.get(a.id) ?? []) {
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
    logo: buildLogoHtml(settings.logoDataUri),
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
  const result = await sendBrevoSms({
    apiKey,
    recipients: [normalizeFrenchMobile(testMobile)],
    content: renderTemplate(String(body), fields),
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
  });
  res.json({ sent: result.sent, errors: result.errors, errorMessage: result.errorMessage });
});

/**
 * Nombre de destinataires que toucherait réellement une campagne avec les
 * réglages actuels (mode test + limites incluses) — calculé avec exactement
 * la même logique de ciblage que les envois réels ci-dessous, pour que
 * l'admin Spelc puisse comparer ce nombre à ses crédits Brevo restants avant
 * de lancer l'envoi plutôt que de le découvrir après coup.
 */
router.get("/campaigns/preview", requireRole("admin_spelc"), (req, res) => {
  const spelc = req.user!.spelc!;
  const testMode = req.query.testMode === "true";
  const testLimit = clampTestLimit(req.query.testLimit);
  const smsLimit = clampSmsLimit(req.query.smsLimit);

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

  let mailRecipients = (testMode ? adherents : adherents.filter((r) => r.mail)).filter(needsRelance);
  if (testMode) mailRecipients = mailRecipients.slice(0, testLimit);

  let smsRecipients = (testMode ? adherents : adherents.filter((r) => r.mobile)).filter(needsRelance);
  smsRecipients = smsRecipients.slice(0, smsLimit);

  res.json({ mailRecipients: mailRecipients.length, smsRecipients: smsRecipients.length, restantARelancer });
});

/**
 * Date/heure du dernier import académique (1er et 2nd degré) de l'académie
 * de ce Spelc — pour que l'admin Spelc sache si le fichier d'émargement
 * utilisé pour cibler ses relances est à jour, directement depuis cette
 * page (sans avoir à aller vérifier l'onglet Imports de l'admin académique).
 */
router.get("/last-imports", requireRole("admin_spelc"), (req, res) => {
  const spelc = req.user!.spelc!;
  const academie = spelcAcademie(spelc);
  if (!academie) {
    res.json({ degre1D: null, degre2D: null });
    return;
  }
  const ids = currentImportIds("academique", academie);
  if (ids.length === 0) {
    res.json({ degre1D: null, degre2D: null });
    return;
  }
  const rows = db
    .prepare(`SELECT degre, imported_at FROM imports WHERE id IN (${ids.map(() => "?").join(",")})`)
    .all(...ids) as { degre: string; imported_at: string }[];
  res.json({
    degre1D: rows.find((r) => r.degre === "1D")?.imported_at ?? null,
    degre2D: rows.find((r) => r.degre === "2D")?.imported_at ?? null,
  });
});

router.post("/campaigns/email", requireRole("admin_spelc"), async (req, res) => {
  const spelc = req.user!.spelc!;
  const { tag, onlyNonVotants = true, testMode, testLimit } = req.body ?? {};
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
  const testEmail = testMode ? resolveTestContact(spelc).testEmail : null;
  if (testMode && !testEmail) {
    res.status(400).json({ error: "Renseigner votre mail." });
    return;
  }

  let recipients = testMode ? matchedAdherents(spelc) : matchedAdherents(spelc).filter((r) => r.mail);
  if (onlyNonVotants) recipients = recipients.filter(needsRelance);
  if (testMode) recipients = recipients.slice(0, clampTestLimit(testLimit));

  const to = recipients.map((r) => ({
    email: testMode ? String(testEmail) : r.mail!,
    name: `${r.prenom} ${r.nom}`,
    nom: r.nom,
    prenom: r.prenom,
    subject: renderTemplate(template.subject, templateFieldsFor(r, spelc)),
    html: wrapEmailHtml(withDemoLogo(renderTemplate(ensureSiteLink(template.body), templateFieldsFor(r, spelc)))),
  }));

  const campagneTag = (tag ?? "relance") + (testMode ? "-test" : "");

  // Brevo n'acceptant pas un contenu par destinataire en un seul appel groupé sans template,
  // on envoie chaque email individuellement avec son contenu personnalisé.
  let sent = 0;
  let errors = 0;
  for (const item of to) {
    const result = await sendBrevoEmails({
      apiKey,
      to: [{ email: item.email, name: item.name }],
      subject: item.subject,
      htmlContent: item.html,
      tag: tag ?? "relance",
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
      testMode: Boolean(testMode),
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
      testMode: Boolean(testMode),
      sendOk: result.sent > 0,
      messageId: result.messageId,
      errorMessage: result.errorMessage,
    });
  }

  res.status(201).json({ sent, errors, total: to.length });
});

router.post("/campaigns/sms", requireRole("admin_spelc"), async (req, res) => {
  const spelc = req.user!.spelc!;
  const { tag, onlyNonVotants = true, testMode, smsLimit } = req.body ?? {};
  const apiKey = getBrevoApiKey();
  if (!apiKey) {
    res.status(400).json({ error: "Clé API Brevo non configurée (contactez l'administrateur général)." });
    return;
  }
  const quotaStatus = smsQuotaStatus(spelc);
  if (quotaStatus.reached) {
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
  const testMobile = testMode ? resolveTestContact(spelc).testMobile : null;
  if (testMode && !testMobile) {
    res.status(400).json({ error: "Renseigner le numéro de mobile." });
    return;
  }

  let recipients = testMode ? matchedAdherents(spelc) : matchedAdherents(spelc).filter((r) => r.mobile);
  if (onlyNonVotants) recipients = recipients.filter(needsRelance);
  recipients = recipients.slice(0, clampSmsLimit(smsLimit));

  const campagneTag = smsCampagneTag(spelc, (tag ?? "relance") + (testMode ? "-test" : ""));
  const smsSender = resolveSmsSender(spelc);
  let sent = 0;
  let errors = 0;
  for (const r of recipients) {
    const content = renderTemplate(template.body, templateFieldsFor(r, spelc));
    const contact = testMode ? String(testMobile) : r.mobile!;
    const result = await sendBrevoSms({
      apiKey,
      recipients: [normalizeFrenchMobile(contact)],
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
      testMode: Boolean(testMode),
      success: result.sent > 0,
    });
    insertRelanceTracking({
      ownerUserId: req.user!.id,
      type: "sms",
      scope: spelc,
      campagneTag,
      nom: r.nom,
      prenom: r.prenom,
      contact: normalizeFrenchMobile(contact),
      testMode: Boolean(testMode),
      sendOk: result.sent > 0,
      messageId: result.messageId,
      errorMessage: result.errorMessage,
    });
  }

  res.status(201).json({ sent, errors, total: recipients.length });
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
