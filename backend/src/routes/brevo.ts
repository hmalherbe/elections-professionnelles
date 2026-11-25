import { Router } from "express";
import multer from "multer";
import * as unzipper from "unzipper";
import { db } from "../db/index.js";
import dayjs from "dayjs";
import { requireAuth, requireRole, canAccessSpelc } from "../middleware/auth.js";
import { renderTemplate, buildIfTestCases, type TemplateFields } from "../lib/template.js";
import { wrapEmailHtml, ensureSiteLink } from "../lib/emailLayout.js";
import { sendBrevoEmails, sendBrevoSms, fetchAccountInfo, getBrevoApiKey, sleep } from "../services/brevo.js";
import { currentImportIds } from "../services/stats.js";
import { runImport } from "../services/imports.js";
import { parseEmargementsJson } from "../parsers/emargements.js";
import { loadWorkbook, rowsAsObjects } from "../lib/xlsx.js";
import { spelcAcademies, isSmsPlannedFor } from "../services/reference.js";
import { getTestContactSettings } from "../services/settings.js";
import { getSpelcSettings, updateSpelcSettings } from "../services/spelcSettings.js";
import { buildLogoHtml, buildBannerHtml, buildSocialLinksHtml, type SocialLinks } from "../lib/socialLinks.js";
import { appendRelanceLog } from "../lib/relanceLog.js";
import {
  insertRelanceTracking,
  hasAlreadySent,
  listRelanceTrackingByScope,
  clearRelanceTrackingByScope,
  clearAllRelanceTracking,
  refreshPendingRelanceTracking,
  getMailSeriesByScope,
  getSmsSeriesByScope,
} from "../services/relanceTracking.js";
import { normalizeFrenchMobile } from "../lib/phone.js";
import { isValidSmsSender, suggestSmsSender } from "../lib/smsSender.js";
import { isRelanceOnly } from "../lib/appMode.js";
import { smsQuotaStatus } from "../services/smsQuota.js";
import { smsSegmentCount, analyzeSmsEncoding } from "../lib/smsSegments.js";
import { buildUnsubscribeUrl } from "../lib/unsubscribeToken.js";
import { isOptedOut, listOptOuts, removeOptOut } from "../services/optout.js";

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

/** Crédits Brevo facturés par SMS envoyé, pour la simulation de relances
 * (voir /campaigns/simulate) — taux réel constaté par l'admin général sur
 * des envois réels de ce compte (numéro français, expéditeur
 * alphanumérique), à préférer ici à l'estimation par segments GSM-7/UCS-2
 * (lib/smsSegments.ts), qui suppose 1-2 crédits/SMS et sous-estimait le
 * coût réel observé. */
const CREDITS_PER_SMS = 4;

/** Zips de scénario de test (8 jours de fichiers CCMMEP + académiques) —
 * potentiellement volumineux, voir /campaigns/simulate-zip. */
const campaignZipUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

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
  /** Degré (1D/2D) de l'émargement local ayant permis le rapprochement —
   * null si non retrouvé au scrutin local, ou si le degré n'a pas pu être
   * déterminé (en pratique n'arrive jamais pour un scrutin local, dont le
   * degré est toujours imposé par le fichier importé — voir
   * services/imports.ts#runImport, forcedDegre). Sert à filtrer la carte
   * "Adhérents à relancer" par 1er/2nd degré (voir /campaigns/recipients). */
  degreLocal: string | null;
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
  degre: string;
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
      `SELECT nom_norm, prenom_norm, votant, scrutin_type, affectation, degre FROM emargements WHERE spelc = ? AND import_id IN (${placeholders})`
    )
    .all(spelc, ...importIds) as EmargementIdentityRow[];
}

/** Index "nom_norm|prenom_norm" -> vote agrégé (votant si AU MOINS une ligne
 * votante, dernier scrutin_type/affectation/degre non nul (ou non
 * INDETERMINE pour degre) rencontré) — équivalent du
 * MAX(el.votant)/MAX(el.scrutin_type) GROUP BY de l'ancienne requête SQL. */
function indexEmargements(
  rows: EmargementIdentityRow[]
): Map<string, { votant: number; scrutinType: string | null; affectation: string | null; degre: string | null }> {
  const map = new Map<string, { votant: number; scrutinType: string | null; affectation: string | null; degre: string | null }>();
  for (const r of rows) {
    const key = `${r.nom_norm}|${r.prenom_norm}`;
    const existing = map.get(key);
    if (existing) {
      if (r.votant) existing.votant = 1;
      if (r.scrutin_type) existing.scrutinType = r.scrutin_type;
      if (r.affectation) existing.affectation = r.affectation;
      if (r.degre && r.degre !== "INDETERMINE") existing.degre = r.degre;
    } else {
      map.set(key, {
        votant: r.votant ? 1 : 0,
        scrutinType: r.scrutin_type ?? null,
        affectation: r.affectation ?? null,
        degre: r.degre && r.degre !== "INDETERMINE" ? r.degre : null,
      });
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
    index: Map<string, { votant: number; scrutinType: string | null; affectation: string | null; degre: string | null }>
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
      degreLocal: local?.degre ?? null,
      votantNational: national ? national.votant : null,
      localMatched: local ? 1 : 0,
      nationalMatched: national ? 1 : 0,
    };
  });
}

function templateFieldsFor(r: Recipient, spelc: string, canal: "mail" | "sms"): TemplateFields {
  const scrutinLocal = r.scrutinLocal ?? "";
  const votantLocal = Boolean(r.votantLocal);
  const settings = getSpelcSettings(spelc);
  const contact = canal === "mail" ? r.mail?.trim().toLowerCase() || null : r.mobile ? normalizeFrenchMobile(r.mobile) : null;
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
    // Lien de désinscription propre à ce destinataire et à ce canal (voir
    // lib/unsubscribeToken.ts) — à insérer dans le modèle (mail ou SMS) via
    // {{lien_desinscription}}. Vide si aucun contact de ce canal (ne devrait
    // pas arriver en envoi réel, seulement en aperçu sur un adhérent sans
    // mobile/mail renseigné).
    lien_desinscription: contact ? buildUnsubscribeUrl(canal, contact) : "",
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
  const fields = templateFieldsFor(recipient, spelc, "mail");
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
  const fields = templateFieldsFor(recipient, spelc, "sms");
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
    credits: result.creditsUsed ?? smsSegmentCount(content),
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
    // Canal arbitraire ("mail") : seuls les champs booléens (CCMMEP_non_votant,
    // scrutin_local_non_votant) sont comparés aux overrides, lien_desinscription
    // n'intervient jamais dans ce test.
    const fields = templateFieldsFor(r, spelc, "mail");
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
      const fields = { ...templateFieldsFor(recipient, spelc, "mail"), ...overrides };
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
      const fields = { ...templateFieldsFor(r, spelc, "sms"), ...overrides };
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

  const mailRecipients = adherents
    .filter((r) => r.mail)
    .filter(needsRelance)
    .filter((r) => !isOptedOut("mail", r.mail!.trim().toLowerCase()));
  const smsRecipients = adherents
    .filter((r) => r.mobile)
    .filter(needsRelance)
    .filter((r) => !isOptedOut("sms", normalizeFrenchMobile(r.mobile!)));

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
      ccmmepNonVotant: Boolean(r.nationalMatched) && !r.votantNational,
      localNonVotant: Boolean(r.localMatched) && !r.votantLocal,
      degreLocal: r.degreLocal,
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
  // Jamais de mail à une adresse désinscrite (voir routes/unsubscribe.ts).
  recipients = recipients.filter((r) => !isOptedOut("mail", r.mail!.trim().toLowerCase()));

  const to = recipients.map((r) => ({
    email: r.mail!,
    name: `${r.prenom} ${r.nom}`,
    nom: r.nom,
    prenom: r.prenom,
    subject: renderTemplate(template.subject, templateFieldsFor(r, spelc, "mail")),
    html: wrapEmailHtml(withDemoLogo(renderTemplate(ensureSiteLink(template.body), templateFieldsFor(r, spelc, "mail")))),
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
  // Jamais de SMS à un mobile désinscrit (voir routes/unsubscribe.ts).
  recipients = recipients.filter((r) => !isOptedOut("sms", normalizeFrenchMobile(r.mobile!)));

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
    const content = renderTemplate(template.body, templateFieldsFor(r, spelc, "sms"));
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
      credits: result.creditsUsed ?? smsSegmentCount(content),
    });
    await sleep(SEND_THROTTLE_MS);
  }

  res.status(201).json({ sent, errors, alreadySent, total: recipients.length, quotaReached });
});

interface SimulateSpelcDayResult {
  spelc: string;
  mailCount: number;
  /** Combien de SMS auraient été nécessaires ce jour-là (avant tout blocage par le plafond). */
  smsTargeted: number;
  /** Combien auraient pu être réellement envoyés avant d'atteindre le plafond — voir smsBlocked. */
  smsSent: number;
  /** smsTargeted - smsSent : combien de SMS auraient été bloqués par le plafond ce jour-là. */
  smsBlocked: number;
  /** smsSent * CREDITS_PER_SMS. */
  creditsThisDay: number;
  /** Crédits réellement déjà consommés (relance_tracking) + simulés sur les jours précédents de ce même scénario + ce jour. */
  creditsCumulative: number;
  smsQuota: number | null;
  quotaExceeded: boolean;
}

interface SimulateZipDayResult {
  jour: string;
  perSpelc: SimulateSpelcDayResult[];
  totalMail: number;
  totalSmsSent: number;
  totalSmsBlocked: number;
  totalCredits: number;
}

interface ZipFileError {
  filename: string;
  error: string;
}

/**
 * Importe un unique scénario de test multi-jours (zip contenant un fichier
 * JSON national par jour sous "national/", et un fichier Excel académique
 * par (académie, degré, jour) sous "academique/<YYYY-MM-DD>/<Académie>__
 * <Degré>.xlsx" — même format de nom de fichier académique que
 * /imports/academique-zip) et calcule, jour par jour dans l'ordre
 * chronologique, les relances mail/SMS qui seraient effectuées — SANS
 * JAMAIS envoyer réellement ni rien enregistrer dans relance_tracking
 * (aucun appel Brevo). Les imports (national et académique), eux, sont
 * RÉELS : chaque jour traité remplace l'état national courant et met à
 * jour l'état académique courant (comme un import quotidien classique),
 * dans l'ordre des jours pour que l'état final corresponde au dernier jour
 * du scénario.
 *
 * Le plafond de crédits SMS est simulé de façon CUMULATIVE sur l'ensemble
 * du scénario : on part des crédits réellement déjà consommés par chaque
 * Spelc (services/smsQuota.ts), puis chaque jour simulé y ajoute les
 * crédits de ce jour — dès qu'un Spelc atteindrait son plafond en cours de
 * journée, les SMS restants de cette journée (et de toutes les suivantes
 * tant que le dépassement persiste) sont comptés comme "bloqués"
 * (smsBlocked), jamais comme envoyés, à l'image de la vérification faite
 * avant chaque envoi réel (voir /campaigns/sms). Le plan de relance SMS
 * (isSmsPlannedFor, carte "Relances SMS des Spelc" de l'onglet
 * Référentiels) reste également respecté jour par jour.
 */
router.post(
  "/campaigns/simulate-zip",
  requireRole("admin_general"),
  campaignZipUpload.single("file"),
  async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "Fichier zip requis." });
      return;
    }

    let directory: unzipper.CentralDirectory;
    try {
      directory = await unzipper.Open.buffer(req.file.buffer);
    } catch {
      res.status(400).json({ error: "Fichier zip invalide ou corrompu." });
      return;
    }

    const academiesConnues = new Set(
      (db.prepare("SELECT academie FROM ref_academie_scrutins").all() as { academie: string }[]).map((r) => r.academie)
    );
    // Tolère une date avec ou sans tirets dans le nom (YYYY-MM-DD ou
    // YYYYMMDD) : reconstruite avec tirets, quel que soit le format reçu.
    const DATE_RE = /(\d{4})-?(\d{2})-?(\d{2})/;

    const nationalByDay = new Map<string, { raw: unknown; filename: string }>();
    const academiqueByDay = new Map<string, { academie: string; degre: "1D" | "2D"; raw: unknown; filename: string }[]>();
    const errors: ZipFileError[] = [];

    for (const entry of directory.files) {
      if (entry.type !== "File") continue;
      const path = entry.path;

      if (/^national\//i.test(path) && path.toLowerCase().endsWith(".json")) {
        const m = path.match(DATE_RE);
        if (!m) {
          errors.push({ filename: path, error: "Date introuvable dans le nom du fichier (attendu YYYY-MM-DD)." });
          continue;
        }
        const jourNational = `${m[1]}-${m[2]}-${m[3]}`;
        try {
          const buffer = await entry.buffer();
          const raw = JSON.parse(buffer.toString("utf-8"));
          nationalByDay.set(jourNational, { raw, filename: path });
        } catch (err) {
          errors.push({ filename: path, error: (err as Error).message });
        }
        continue;
      }

      const academiqueMatch = path.match(/^academique\/(\d{4})-?(\d{2})-?(\d{2})\/(.+)\.xlsx$/i);
      if (academiqueMatch) {
        const [, y, mo, d, base] = academiqueMatch;
        const jour = `${y}-${mo}-${d}`;
        const sepIndex = base.lastIndexOf("__");
        if (sepIndex === -1) {
          errors.push({ filename: path, error: 'Nom de fichier inattendu (attendu : "<Académie>__<Degré>.xlsx").' });
          continue;
        }
        const academie = base.slice(0, sepIndex);
        const degre = base.slice(sepIndex + 2);
        if (degre !== "1D" && degre !== "2D") {
          errors.push({ filename: path, error: `Degré "${degre}" invalide (attendu "1D" ou "2D").` });
          continue;
        }
        if (!academiesConnues.has(academie)) {
          errors.push({ filename: path, error: `Académie "${academie}" inconnue du référentiel.` });
          continue;
        }
        try {
          const buffer = await entry.buffer();
          const workbook = await loadWorkbook(buffer);
          const sheet = workbook.worksheets[0];
          if (!sheet) {
            errors.push({ filename: path, error: "Fichier Excel sans feuille." });
            continue;
          }
          const raw = { items: rowsAsObjects(sheet) };
          const list = academiqueByDay.get(jour) ?? [];
          list.push({ academie, degre, raw, filename: path });
          academiqueByDay.set(jour, list);
        } catch (err) {
          errors.push({ filename: path, error: (err as Error).message });
        }
      }
    }

    const days = Array.from(new Set([...nationalByDay.keys(), ...academiqueByDay.keys()])).sort();
    if (days.length === 0) {
      res.status(400).json({
        error: 'Aucun fichier reconnu dans le zip (attendu : "national/*.json" et "academique/<jour>/<Académie>__<Degré>.xlsx").',
        errors,
      });
      return;
    }

    const spelcs = allSpelcNames();
    const quotaBySpelc = new Map(spelcs.map((s) => [s, smsQuotaStatus(s)]));
    // Crédits simulés cumulés depuis le début de CE scénario (en plus des
    // crédits déjà réellement consommés, lus une fois dans quotaBySpelc) —
    // jamais persisté, remis à zéro à chaque nouvel appel de cette route.
    const simulatedCredits = new Map(spelcs.map((s) => [s, 0]));

    const results: SimulateZipDayResult[] = [];

    // Contrairement à l'import national (toujours remplacé par runImport),
    // un import académique n'est jamais supprimé automatiquement — en usage
    // normal, c'est voulu (historique des imports, onglet admin académique).
    // Mais un scénario multi-jours crée ici, dans une seule requête, un
    // nouvel import académique par (académie, degré) à CHAQUE jour traité :
    // sans nettoyage, la table emargements grossit de jour en jour (celle de
    // la veille devenue inutile dès que celle du jour reste), ralentissant
    // chaque jour suivant jusqu'à saturer la mémoire/le disque sur un
    // scénario de plusieurs jours. On ne supprime donc QUE l'import
    // académique précédent créé par CETTE requête (jamais un import réel
    // préexistant, uploadé normalement par un admin académique).
    const lastAcademiqueImportId = new Map<string, number>();
    const deleteImport = db.prepare("DELETE FROM imports WHERE id = ?");

    for (const jour of days) {
      const nationalEntry = nationalByDay.get(jour);
      if (nationalEntry) {
        try {
          runImport(nationalEntry.raw, {
            scope: "national",
            academie: null,
            degre: null,
            filename: nationalEntry.filename,
            importedBy: req.user!.id,
            snapshotDate: jour,
          });
        } catch (err) {
          errors.push({ filename: nationalEntry.filename, error: (err as Error).message });
        }
      }
      for (const { academie, degre, raw, filename } of academiqueByDay.get(jour) ?? []) {
        try {
          const { importId } = runImport(raw, {
            scope: "academique",
            academie,
            degre,
            filename,
            importedBy: req.user!.id,
            snapshotDate: jour,
          });
          const key = `${academie}|${degre}`;
          const previousId = lastAcademiqueImportId.get(key);
          if (previousId !== undefined) deleteImport.run(previousId);
          lastAcademiqueImportId.set(key, importId);
        } catch (err) {
          errors.push({ filename, error: (err as Error).message });
        }
      }

      const perSpelc: SimulateSpelcDayResult[] = [];
      let totalMail = 0;
      let totalSmsSent = 0;
      let totalSmsBlocked = 0;
      let totalCredits = 0;

      for (const spelc of spelcs) {
        const recipients = matchedAdherents(spelc).filter(needsRelance);
        const smsPlanned = isSmsPlannedFor(spelc, jour);

        const mailTag = campagneTagAuto("mail", spelc);
        const mailTargets = recipients.filter(
          (r) =>
            r.mail &&
            !hasAlreadySent(spelc, "mail", mailTag, r.mail!) &&
            !isOptedOut("mail", r.mail!.trim().toLowerCase())
        );

        const smsTag = campagneTagAuto("sms", spelc);
        const smsCandidates = smsPlanned
          ? recipients.filter(
              (r) =>
                r.mobile &&
                !hasAlreadySent(spelc, "sms", smsTag, normalizeFrenchMobile(r.mobile!)) &&
                !isOptedOut("sms", normalizeFrenchMobile(r.mobile!))
            )
          : [];

        const quota = quotaBySpelc.get(spelc)!.quota;
        const baseUsed = quotaBySpelc.get(spelc)!.used;
        const simulatedSoFar = simulatedCredits.get(spelc)!;
        const remainingCredits = quota === null ? Infinity : Math.max(0, quota - baseUsed - simulatedSoFar);
        const maxSendable = quota === null ? smsCandidates.length : Math.floor(remainingCredits / CREDITS_PER_SMS);
        const smsSent = Math.min(smsCandidates.length, maxSendable);
        const smsBlocked = smsCandidates.length - smsSent;
        const creditsThisDay = smsSent * CREDITS_PER_SMS;
        const creditsCumulative = baseUsed + simulatedSoFar + creditsThisDay;
        simulatedCredits.set(spelc, simulatedSoFar + creditsThisDay);

        totalMail += mailTargets.length;
        totalSmsSent += smsSent;
        totalSmsBlocked += smsBlocked;
        totalCredits += creditsThisDay;

        if (mailTargets.length === 0 && smsCandidates.length === 0) continue;
        perSpelc.push({
          spelc,
          mailCount: mailTargets.length,
          smsTargeted: smsCandidates.length,
          smsSent,
          smsBlocked,
          creditsThisDay,
          creditsCumulative,
          smsQuota: quota,
          quotaExceeded: smsBlocked > 0,
        });
      }

      results.push({ jour, perSpelc, totalMail, totalSmsSent, totalSmsBlocked, totalCredits });
    }

    res.json({ days: results, errors });
  }
);

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

/**
 * Efface tout le suivi détaillé des relances mail/SMS, TOUS Spelc confondus
 * (onglet Paramètres, zone de danger) — pour repartir d'un historique
 * propre (ex. avant un nouveau test grandeur nature sur la sandbox), sans
 * toucher aux émargements/adhérents/imports (voir /admin/reset-imported-data
 * pour ceux-ci). Remet aussi à zéro la protection anti-double-envoi du jour
 * et le plafond de crédits SMS par Spelc.
 */
router.delete("/relance-tracking/all", requireRole("admin_general"), (_req, res) => {
  const deleted = clearAllRelanceTracking();
  res.json({ deleted });
});

/** Liste des désinscriptions (mail et SMS) — onglet Paramètres, admin général. */
router.get("/optout", requireRole("admin_general"), (_req, res) => {
  res.json({ optouts: listOptOuts() });
});

/** Réinscription manuelle (ex. désinscription faite par erreur). */
router.delete("/optout", requireRole("admin_general"), (req, res) => {
  const canal = req.query.canal;
  const contact = req.query.contact;
  if ((canal !== "mail" && canal !== "sms") || typeof contact !== "string" || !contact) {
    res.status(400).json({ error: "canal (mail/sms) et contact requis." });
    return;
  }
  const ok = removeOptOut(canal, contact);
  res.json({ ok });
});

export default router;
