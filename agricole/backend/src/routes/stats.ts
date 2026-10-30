import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { camembert, courbeCumulative, participationParEtablissement } from "../services/stats.js";
import { isScrutinCode } from "../lib/scrutins.js";

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

export default router;
