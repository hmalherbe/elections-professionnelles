import { Router } from "express";
import bcrypt from "bcryptjs";
import multer from "multer";
import { db } from "../db/index.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  loadAcademieScrutinsWorkbook,
  loadDepartementsWorkbook,
  loadPsaWorkbook,
  clearDeptCache,
} from "../services/reference.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.use(requireAuth, requireRole("admin_general"));

router.get("/users", (_req, res) => {
  const rows = db
    .prepare("SELECT id, email, role, academie, spelc, created_at FROM users ORDER BY created_at DESC")
    .all();
  res.json({ users: rows });
});

router.post("/users", (req, res) => {
  const { email, password, role, academie, spelc } = req.body ?? {};
  if (!email || !password || !role) {
    res.status(400).json({ error: "email, password et role sont requis." });
    return;
  }
  if (!["admin_general", "admin_academique", "admin_spelc"].includes(role)) {
    res.status(400).json({ error: "Rôle invalide." });
    return;
  }
  if (role === "admin_academique" && !academie) {
    res.status(400).json({ error: "Une académie est requise pour un admin académique." });
    return;
  }
  if (role === "admin_spelc" && !spelc) {
    res.status(400).json({ error: "Un Spelc est requis pour un admin Spelc." });
    return;
  }
  try {
    const info = db
      .prepare(
        "INSERT INTO users (email, password_hash, role, academie, spelc) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        String(email).toLowerCase().trim(),
        bcrypt.hashSync(String(password), 10),
        role,
        academie ?? null,
        spelc ?? null
      );
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (err) {
    res.status(409).json({ error: "Un compte existe déjà avec cet email." });
  }
});

router.delete("/users/:id", (req, res) => {
  db.prepare("DELETE FROM users WHERE id = ? AND role != 'admin_general'").run(req.params.id);
  res.status(204).end();
});

router.post("/reference/departements", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Fichier requis." });
    return;
  }
  try {
    const result = await loadDepartementsWorkbook(req.file.buffer);
    clearDeptCache();
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post("/reference/academie-scrutins", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Fichier requis." });
    return;
  }
  try {
    const result = await loadAcademieScrutinsWorkbook(req.file.buffer);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post("/reference/psa", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Fichier requis." });
    return;
  }
  try {
    const result = await loadPsaWorkbook(req.file.buffer);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get("/reference/academies", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT DISTINCT academie FROM ref_academie_scrutins
       UNION SELECT DISTINCT academie FROM ref_departements ORDER BY academie`
    )
    .all() as { academie: string }[];
  res.json({ academies: rows.map((r) => r.academie) });
});

router.get("/reference/spelcs", (req, res) => {
  const academie = req.query.academie as string | undefined;
  const rows = academie
    ? db.prepare("SELECT spelc, accord, academie FROM ref_spelc WHERE academie = ? ORDER BY spelc").all(academie)
    : db.prepare("SELECT spelc, accord, academie FROM ref_spelc ORDER BY spelc").all();
  res.json({ spelcs: rows });
});

router.get("/psa", (_req, res) => {
  const rows = db.prepare("SELECT * FROM psa ORDER BY nom").all();
  res.json({ psa: rows });
});

export default router;
