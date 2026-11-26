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
  let votant1: "votant" | "non_votant" | null = null;
  if (req.query.votant1 === "votant" || req.query.votant1 === "non_votant") votant1 = req.query.votant1;

  let votant2: "votant" | "non_votant" | null = null;
  if (req.query.votant2 === "votant" || req.query.votant2 === "non_votant") votant2 = req.query.votant2;

  let adherent: "oui" | "non" | null = null;
  if (req.query.adherent === "oui" || req.query.adherent === "non") adherent = req.query.adherent;

  const typeScrutin = isScrutinCode(req.query.typeScrutin) ? req.query.typeScrutin : null;

  return { votant1, votant2, adherent, typeScrutin, etablissement: (req.query.etablissement as string) || null };
}

router.get("/scrutin-detail", (req, res) => {
  res.json(scrutinDetail(parseScrutinDetailFilter(req)));
});

router.get("/scrutin-detail/export", async (req, res) => {
  const data = scrutinDetail(parseScrutinDetailFilter(req));
  const wb = buildScrutinDetailWorkbook(data);

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="detail-scrutin.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

export default router;
