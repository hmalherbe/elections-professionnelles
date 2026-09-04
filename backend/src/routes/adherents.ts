import { Router } from "express";
import multer from "multer";
import { db } from "../db/index.js";
import { requireAuth, requireRole, canAccessSpelc } from "../middleware/auth.js";
import { normalizeName } from "../lib/normalize.js";
import { loadWorkbook, rowsAsObjects } from "../lib/xlsx.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.use(requireAuth);

function spelcAcademie(spelc: string): string | null {
  const row = db.prepare("SELECT academie FROM ref_spelc WHERE spelc = ?").get(spelc) as
    | { academie: string }
    | undefined;
  return row?.academie ?? null;
}

router.post("/upload", requireRole("admin_spelc", "admin_general"), upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Fichier requis." });
    return;
  }
  const spelc = (req.body?.spelc as string) || req.user!.spelc || "";
  if (!spelc) {
    res.status(400).json({ error: "Spelc requis." });
    return;
  }
  if (!canAccessSpelc(req.user!, spelcAcademie(spelc), spelc)) {
    res.status(403).json({ error: "Accès non autorisé à ce Spelc." });
    return;
  }

  try {
    const wb = await loadWorkbook(req.file.buffer);
    const rows = rowsAsObjects(wb.worksheets[0]);

    const del = db.prepare("DELETE FROM adherents WHERE spelc = ?");
    const insert = db.prepare(
      `INSERT INTO adherents (spelc, nom, prenom, nom_norm, prenom_norm, mail, mobile, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    let count = 0;
    const tx = db.transaction(() => {
      del.run(spelc);
      for (const row of rows) {
        // colonnes attendues : nom, prenom, mail, numéro de mobile (ordre positionnel toléré)
        const keys = Object.keys(row).reduce<Record<string, unknown>>((acc, k) => {
          acc[k.toLowerCase().trim()] = row[k];
          return acc;
        }, {});
        const nom = keys["nom"] ?? Object.values(row)[0];
        const prenom = keys["prenom"] ?? Object.values(row)[1];
        const mail = keys["mail"] ?? keys["email"] ?? Object.values(row)[2];
        const mobile = keys["mobile"] ?? keys["numero de mobile"] ?? keys["numéro de mobile"] ?? Object.values(row)[3];
        if (!nom || !prenom) continue;
        insert.run(
          spelc,
          String(nom).trim(),
          String(prenom).trim(),
          normalizeName(String(nom)),
          normalizeName(String(prenom)),
          mail ? String(mail).trim() : null,
          mobile ? String(mobile).trim() : null,
          req.user!.id
        );
        count++;
      }
    });
    tx();
    res.status(201).json({ count });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get("/", (req, res) => {
  const spelc = req.query.spelc as string;
  if (!spelc) {
    res.status(400).json({ error: "Paramètre spelc requis." });
    return;
  }
  if (!canAccessSpelc(req.user!, spelcAcademie(spelc), spelc)) {
    res.status(403).json({ error: "Accès non autorisé à ce Spelc." });
    return;
  }
  const rows = db.prepare("SELECT id, nom, prenom, mail, mobile FROM adherents WHERE spelc = ? ORDER BY nom").all(spelc);
  res.json({ adherents: rows });
});

export default router;
