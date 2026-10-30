import { Router } from "express";
import multer from "multer";
import { db } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { normalizeName } from "../lib/normalize.js";
import { loadWorkbook, rowsAsObjects } from "../lib/xlsx.js";
import { parseCsvBuffer } from "../lib/csv.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.use(requireAuth);

/**
 * Fichier global des adhérents (nom, prenom, mail, etablissement),
 * importé une seule fois avant le début des élections : remplace
 * intégralement la liste précédente (pas de notion de Spelc local ici).
 */
router.post("/import", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Fichier requis." });
    return;
  }
  try {
    const isCsv = /\.csv$/i.test(req.file.originalname);
    const rows: Record<string, unknown>[] = isCsv
      ? parseCsvBuffer(req.file.buffer)
      : rowsAsObjects((await loadWorkbook(req.file.buffer)).worksheets[0]);

    const del = db.prepare("DELETE FROM adherents");
    const insert = db.prepare(
      `INSERT INTO adherents (nom, prenom, nom_norm, prenom_norm, mail, etablissement, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    let count = 0;
    const tx = db.transaction(() => {
      del.run();
      for (const row of rows) {
        const keys = Object.keys(row).reduce<Record<string, unknown>>((acc, k) => {
          acc[k.toLowerCase().trim()] = row[k];
          return acc;
        }, {});
        const nom = keys["nom"] ?? Object.values(row)[0];
        const prenom = keys["prenom"] ?? Object.values(row)[1];
        const mail = keys["mail"] ?? keys["email"] ?? Object.values(row)[2];
        const etablissement = keys["etablissement"] ?? keys["établissement"] ?? Object.values(row)[3];
        if (!nom || !prenom) continue;
        insert.run(
          String(nom).trim(),
          String(prenom).trim(),
          normalizeName(String(nom)),
          normalizeName(String(prenom)),
          mail ? String(mail).trim() : null,
          etablissement ? String(etablissement).trim() : null,
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

router.get("/", (_req, res) => {
  const rows = db.prepare("SELECT id, nom, prenom, mail, etablissement FROM adherents ORDER BY nom").all();
  res.json({ adherents: rows });
});

router.delete("/all", (_req, res) => {
  const info = db.prepare("DELETE FROM adherents").run();
  res.json({ deleted: info.changes });
});

export default router;
