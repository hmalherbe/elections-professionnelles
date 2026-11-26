import { Router, type Request } from "express";
import { requireAuth } from "../middleware/auth.js";
import { camembert, courbeCumulative, participationParEtablissement, scrutinDetail } from "../services/stats.js";
import { isScrutinCode } from "../lib/scrutins.js";
import { buildScrutinDetailWorkbook } from "../lib/scrutinExport.js";

const router = Router();
router.use(requireAuth);

router.get("/camembert", (req, res) => {
  const scrutin = req.query.scrutin;
  if (!isScrutinCode(scrutin)) {
    res.status(400).json({ error: "Paramètre scrutin invalide (scrutin1 ou scrutin2)." });
    return;
  }
  res.json(camembert(scrutin));
});

router.get("/courbe", (req, res) => {
  const scrutin = req.query.scrutin;
  if (!isScrutinCode(scrutin)) {
    res.status(400).json({ error: "Paramètre scrutin invalide (scrutin1 ou scrutin2)." });
    return;
  }
  res.json({ points: courbeCumulative(scrutin) });
});

router.get("/etablissements", (req, res) => {
  const scrutin = req.query.scrutin;
  if (!isScrutinCode(scrutin)) {
    res.status(400).json({ error: "Paramètre scrutin invalide (scrutin1 ou scrutin2)." });
    return;
  }
  res.json({ etablissements: participationParEtablissement(scrutin) });
});

function parseScrutinDetailFilter(req: Request) {
  const scrutin = req.query.scrutin;
  if (!isScrutinCode(scrutin)) return null;

  let votant: "votant" | "non_votant" | null = null;
  if (req.query.votant === "votant" || req.query.votant === "non_votant") votant = req.query.votant;

  let adherent: "oui" | "non" | null = null;
  if (req.query.adherent === "oui" || req.query.adherent === "non") adherent = req.query.adherent;

  return { scrutin, votant, adherent, etablissement: (req.query.etablissement as string) || null };
}

router.get("/scrutin-detail", (req, res) => {
  const filter = parseScrutinDetailFilter(req);
  if (!filter) {
    res.status(400).json({ error: "Paramètre scrutin invalide (scrutin1 ou scrutin2)." });
    return;
  }
  res.json(scrutinDetail(filter));
});

router.get("/scrutin-detail/export", async (req, res) => {
  const filter = parseScrutinDetailFilter(req);
  if (!filter) {
    res.status(400).json({ error: "Paramètre scrutin invalide (scrutin1 ou scrutin2)." });
    return;
  }
  const data = scrutinDetail(filter);
  const wb = buildScrutinDetailWorkbook(data);

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="detail-scrutin.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

export default router;
