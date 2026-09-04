import { Router } from "express";
import { db } from "../db/index.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { runPsaSimulation } from "../services/psaSimulation.js";

const router = Router();
router.use(requireAuth, requireRole("admin_general"));

router.post("/simulate", (req, res) => {
  const { description } = req.body ?? {};
  const result = runPsaSimulation(req.user!.id, description);
  res.status(201).json(result);
});

router.get("/runs", (_req, res) => {
  const rows = db.prepare("SELECT * FROM psa_simulation_runs ORDER BY run_at DESC").all();
  res.json({ runs: rows });
});

router.get("/runs/:runId/results", (req, res) => {
  const runId = Number(req.params.runId);
  const rows = db
    .prepare(
      `SELECT p.nom, p.prenom, p.email, e.scrutin, e.scrutin_type, e.date_emargement
       FROM psa_emargements e JOIN psa p ON p.id = e.psa_id
       WHERE e.run_id = ? ORDER BY p.nom, p.prenom, e.scrutin`
    )
    .all(runId);

  const totalPsa = (db.prepare("SELECT COUNT(*) AS c FROM psa").get() as { c: number }).c;
  const national = rows.filter((r: any) => r.scrutin === "CCMMEP");
  const local = rows.filter((r: any) => r.scrutin === "LOCAL");
  const votedNational = national.filter((r: any) => r.date_emargement).length;
  const votedLocal = local.filter((r: any) => r.date_emargement).length;

  // Courbe cumulée par jour (national + local confondus, comme les autres courbes de l'appli)
  const byDay = new Map<string, number>();
  for (const r of rows as any[]) {
    if (!r.date_emargement) continue;
    const day = String(r.date_emargement).slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  const courbe = Array.from(byDay.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }));

  res.json({
    rows,
    summary: {
      totalPsa,
      votedNational,
      votedLocal,
      tauxNational: totalPsa ? votedNational / totalPsa : 0,
      tauxLocal: totalPsa ? votedLocal / totalPsa : 0,
    },
    courbe,
  });
});

export default router;
