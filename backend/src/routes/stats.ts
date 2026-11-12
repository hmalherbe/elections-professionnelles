import { Router, type Request, type Response } from "express";
import { db } from "../db/index.js";
import { requireAuth, canAccessAcademie, canAccessSpelc } from "../middleware/auth.js";
import {
  camembert,
  camembertAdherents,
  courbeCumulative,
  courbeCumulativeAdherents,
  participationParEtablissement,
  participationTreeNational,
  scrutinsByEtablissement,
  scrutinsTab,
  type Scope,
} from "../services/stats.js";
import {
  buildEtablissementsWorkbook,
  buildParticipationTreeWorkbook,
  buildScrutinsByEtablissementWorkbook,
} from "../lib/scrutinsExport.js";

const router = Router();
router.use(requireAuth);

function spelcAcademie(spelc: string): string | null {
  const row = db.prepare("SELECT academie FROM ref_spelc WHERE spelc = ?").get(spelc) as
    | { academie: string }
    | undefined;
  return row?.academie ?? null;
}

/** Vérifie l'accès de l'utilisateur au scope demandé, renvoie une erreur HTTP le cas échéant. */
function checkScopeAccess(
  req: Request,
  res: Response,
  scope: Scope,
  academie: string | null,
  spelc: string | null
): boolean {
  const user = req.user!;
  void scope;
  if (academie && !canAccessAcademie(user, academie) && !(spelc && canAccessSpelc(user, spelcAcademie(spelc), spelc))) {
    res.status(403).json({ error: "Accès non autorisé à cette académie." });
    return false;
  }
  if (spelc && !canAccessSpelc(user, spelcAcademie(spelc), spelc)) {
    res.status(403).json({ error: "Accès non autorisé à ce Spelc." });
    return false;
  }
  if (!academie && !spelc && user.role !== "admin_general") {
    res.status(403).json({ error: "Accès non autorisé." });
    return false;
  }
  return true;
}

router.get("/participation-tree", (req, res) => {
  if (req.user!.role !== "admin_general") {
    res.status(403).json({ error: "Réservé à l'admin général." });
    return;
  }
  res.json({ tree: participationTreeNational() });
});

/**
 * Export Excel du TCD "Participation par académie" de la Vue nationale
 * (bouton "Export Excel" de cet onglet) — mêmes droits que
 * /participation-tree, voir lib/scrutinsExport.ts.
 */
router.get("/participation-tree/export", async (req, res) => {
  if (req.user!.role !== "admin_general") {
    res.status(403).json({ error: "Réservé à l'admin général." });
    return;
  }
  const wb = buildParticipationTreeWorkbook(participationTreeNational());

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="participation-par-academie.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

function parseDegre(req: Request): "1D" | "2D" | null {
  const d = req.query.degre as string | undefined;
  return d === "1D" || d === "2D" ? d : null;
}

router.get("/camembert", (req, res) => {
  const scope = (req.query.scope as Scope) ?? "national";
  const academie = (req.query.academie as string) || null;
  const spelc = (req.query.spelc as string) || null;
  if (!checkScopeAccess(req, res, scope, academie, spelc)) return;
  res.json(camembert({ scope, academie, spelc, degre: parseDegre(req) }));
});

router.get("/courbe", (req, res) => {
  const scope = (req.query.scope as Scope) ?? "national";
  const academie = (req.query.academie as string) || null;
  const spelc = (req.query.spelc as string) || null;
  if (!checkScopeAccess(req, res, scope, academie, spelc)) return;
  res.json({ points: courbeCumulative({ scope, academie, spelc, degre: parseDegre(req) }) });
});

/**
 * Mêmes données que /camembert et /courbe, restreintes aux adhérents d'un
 * Spelc (voir services/stats.ts#camembertAdherents) — utilisé par la "Vue
 * Spelc" d'un admin Spelc, en complément du territoire entier.
 */
router.get("/camembert-adherents", (req, res) => {
  const scope = (req.query.scope as Scope) ?? "national";
  const academie = (req.query.academie as string) || null;
  const spelc = (req.query.spelc as string) || null;
  if (!checkScopeAccess(req, res, scope, academie, spelc)) return;
  res.json(camembertAdherents({ scope, academie, spelc, degre: parseDegre(req) }));
});

router.get("/courbe-adherents", (req, res) => {
  const scope = (req.query.scope as Scope) ?? "national";
  const academie = (req.query.academie as string) || null;
  const spelc = (req.query.spelc as string) || null;
  if (!checkScopeAccess(req, res, scope, academie, spelc)) return;
  res.json({ points: courbeCumulativeAdherents({ scope, academie, spelc, degre: parseDegre(req) }) });
});

router.get("/scrutins", (req, res) => {
  const scope = (req.query.scope as Scope) ?? "national";
  const academie = (req.query.academie as string) || null;
  const spelc = (req.query.spelc as string) || null;
  if (!checkScopeAccess(req, res, scope, academie, spelc)) return;
  const scrutinType = (req.query.scrutinType as string) || null;
  const votant = (req.query.votant as "votant" | "non_votant") || null;
  const adherent = (req.query.adherent as "oui" | "non") || null;
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const offset = Number(req.query.offset) || 0;
  res.json(scrutinsTab({ scope, academie, spelc, scrutinType, votant, adherent }, limit, offset));
});

router.get("/scrutins-par-etablissement", (req, res) => {
  const scope = (req.query.scope as Scope) ?? "national";
  const academie = (req.query.academie as string) || null;
  const spelc = (req.query.spelc as string) || null;
  if (!checkScopeAccess(req, res, scope, academie, spelc)) return;
  const scrutinType = (req.query.scrutinType as string) || null;
  const votant = (req.query.votant as "votant" | "non_votant") || null;
  const adherent = (req.query.adherent as "oui" | "non") || null;
  const affectation = (req.query.affectation as string) || null;
  res.json(scrutinsByEtablissement({ scope, academie, spelc, scrutinType, votant, adherent, affectation }));
});

/**
 * Export Excel du tableau "Détail par établissement", mêmes filtres que
 * /scrutins-par-etablissement (bouton "Export Excel" à côté des listes
 * déroulantes dans l'onglet Scrutins) — voir lib/scrutinsExport.ts pour la
 * mise en forme hiérarchique (établissement, puis électeurs).
 */
router.get("/scrutins-par-etablissement/export", async (req, res) => {
  const scope = (req.query.scope as Scope) ?? "national";
  const academie = (req.query.academie as string) || null;
  const spelc = (req.query.spelc as string) || null;
  if (!checkScopeAccess(req, res, scope, academie, spelc)) return;
  const scrutinType = (req.query.scrutinType as string) || null;
  const votant = (req.query.votant as "votant" | "non_votant") || null;
  const adherent = (req.query.adherent as "oui" | "non") || null;
  const affectation = (req.query.affectation as string) || null;

  const data = scrutinsByEtablissement({ scope, academie, spelc, scrutinType, votant, adherent, affectation });
  const wb = buildScrutinsByEtablissementWorkbook(data, Boolean(spelc));

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="detail-par-etablissement.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

router.get("/etablissements", (req, res) => {
  const scope = (req.query.scope as Scope) ?? "national";
  const academie = (req.query.academie as string) || null;
  const spelc = (req.query.spelc as string) || null;
  if (!checkScopeAccess(req, res, scope, academie, spelc)) return;
  res.json({ etablissements: participationParEtablissement({ scope, academie, spelc }) });
});

/**
 * Export Excel du tableau "Participation par établissement" (bouton "Export
 * Excel" de cet onglet) — mêmes périmètre/droits que /etablissements, voir
 * lib/scrutinsExport.ts.
 */
router.get("/etablissements/export", async (req, res) => {
  const scope = (req.query.scope as Scope) ?? "national";
  const academie = (req.query.academie as string) || null;
  const spelc = (req.query.spelc as string) || null;
  if (!checkScopeAccess(req, res, scope, academie, spelc)) return;

  const rows = participationParEtablissement({ scope, academie, spelc });
  const wb = buildEtablissementsWorkbook(rows);

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="participation-par-etablissement.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

export default router;
