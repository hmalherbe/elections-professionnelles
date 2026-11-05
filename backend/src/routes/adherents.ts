import { Router } from "express";
import multer from "multer";
import { db } from "../db/index.js";
import { requireAuth, requireRole, canAccessSpelc } from "../middleware/auth.js";
import { normalizeName } from "../lib/normalize.js";
import { loadWorkbook, rowsAsObjects } from "../lib/xlsx.js";
import { parseCsvBuffer } from "../lib/csv.js";
import {
  fuzzyMatchSpelc,
  listFuzzyMatches,
  refreshFuzzyCandidates,
  reviewFuzzyMatch,
} from "../services/fuzzyMatching.js";

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
    const isCsv = /\.csv$/i.test(req.file.originalname);
    const rows: Record<string, unknown>[] = isCsv
      ? parseCsvBuffer(req.file.buffer)
      : rowsAsObjects((await loadWorkbook(req.file.buffer)).worksheets[0]);

    const del = db.prepare("DELETE FROM adherents WHERE spelc = ?");
    const insert = db.prepare(
      `INSERT INTO adherents (spelc, nom, prenom, nom_norm, prenom_norm, nom_naissance, nom_naissance_norm, mail, mobile, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    let count = 0;
    const tx = db.transaction(() => {
      del.run(spelc);
      for (const row of rows) {
        // colonnes attendues : nom, prenom, mail, numéro de mobile (ordre positionnel
        // toléré) puis, en option, nom de naissance — reconnue uniquement par son
        // en-tête, jamais par position (voir plus bas).
        const keys = Object.keys(row).reduce<Record<string, unknown>>((acc, k) => {
          acc[k.toLowerCase().trim()] = row[k];
          return acc;
        }, {});
        const nom = keys["nom"] ?? Object.values(row)[0];
        const prenom = keys["prenom"] ?? Object.values(row)[1];
        const mail = keys["mail"] ?? keys["email"] ?? Object.values(row)[2];
        const mobile = keys["mobile"] ?? keys["numero de mobile"] ?? keys["numéro de mobile"] ?? Object.values(row)[3];
        // Pas de repli positionnel pour nom_naissance (champ facultatif récent, sans
        // convention d'ordre établie) : une colonne supplémentaire non reconnue dans
        // un fichier sans "Nom de naissance" ne doit jamais être prise pour ce champ.
        const nomNaissance = keys["nom de naissance"] ?? keys["nom_naissance"];
        if (!nom || !prenom) continue;
        insert.run(
          spelc,
          String(nom).trim(),
          String(prenom).trim(),
          normalizeName(String(nom)),
          normalizeName(String(prenom)),
          nomNaissance ? String(nomNaissance).trim() : null,
          nomNaissance ? normalizeName(String(nomNaissance)) : null,
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

/**
 * Import groupé des adhérents pour tous les Spelcs en un seul fichier
 * (colonnes : spelc, nom, prenom, mail, mobile). Remplace entièrement la
 * liste de chaque Spelc mentionné dans le fichier (les Spelcs absents du
 * fichier ne sont pas touchés).
 */
router.post("/import-all", requireRole("admin_general"), upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Fichier requis." });
    return;
  }
  try {
    const isCsv = /\.csv$/i.test(req.file.originalname);
    const rows: Record<string, unknown>[] = isCsv
      ? parseCsvBuffer(req.file.buffer)
      : rowsAsObjects((await loadWorkbook(req.file.buffer)).worksheets[0]);

    const knownSpelcs = new Set(
      (db.prepare("SELECT spelc FROM ref_spelc").all() as { spelc: string }[]).map((r) => r.spelc)
    );

    const del = db.prepare("DELETE FROM adherents WHERE spelc = ?");
    const insert = db.prepare(
      `INSERT INTO adherents (spelc, nom, prenom, nom_norm, prenom_norm, nom_naissance, nom_naissance_norm, mail, mobile, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const bySpelc = new Map<string, Record<string, unknown>[]>();
    const errors: { row: number; message: string }[] = [];
    rows.forEach((row, idx) => {
      const keys = Object.keys(row).reduce<Record<string, unknown>>((acc, k) => {
        acc[k.toLowerCase().trim()] = row[k];
        return acc;
      }, {});
      const spelc = String(keys["spelc"] ?? "").trim();
      const nom = keys["nom"];
      const prenom = keys["prenom"];
      if (!spelc && !nom && !prenom) return; // ligne vide
      if (!spelc) {
        errors.push({ row: idx + 2, message: "Colonne spelc requise." });
        return;
      }
      if (!knownSpelcs.has(spelc)) {
        errors.push({ row: idx + 2, message: `Spelc inconnu : "${spelc}".` });
        return;
      }
      const arr = bySpelc.get(spelc) ?? [];
      arr.push(row);
      bySpelc.set(spelc, arr);
    });

    let totalAdherents = 0;
    const tx = db.transaction(() => {
      for (const [spelc, spelcRows] of bySpelc.entries()) {
        del.run(spelc);
        for (const row of spelcRows) {
          const keys = Object.keys(row).reduce<Record<string, unknown>>((acc, k) => {
            acc[k.toLowerCase().trim()] = row[k];
            return acc;
          }, {});
          const nom = keys["nom"];
          const prenom = keys["prenom"];
          const mail = keys["mail"] ?? keys["email"];
          const mobile = keys["mobile"] ?? keys["numero de mobile"] ?? keys["numéro de mobile"];
          const nomNaissance = keys["nom de naissance"] ?? keys["nom_naissance"];
          if (!nom || !prenom) continue;
          insert.run(
            spelc,
            String(nom).trim(),
            String(prenom).trim(),
            normalizeName(String(nom)),
            normalizeName(String(prenom)),
            nomNaissance ? String(nomNaissance).trim() : null,
            nomNaissance ? normalizeName(String(nomNaissance)) : null,
            mail ? String(mail).trim() : null,
            mobile ? String(mobile).trim() : null,
            req.user!.id
          );
          totalAdherents++;
        }
      }
    });
    tx();

    res.status(201).json({ spelcsProcessed: bySpelc.size, totalAdherents, errors });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

/** Supprime tous les adhérents, tous Spelcs confondus. */
router.delete("/all", requireRole("admin_general"), (_req, res) => {
  const info = db.prepare("DELETE FROM adherents").run();
  res.json({ deleted: info.changes });
});

// admin_general (tous Spelcs) ou admin_spelc (son propre Spelc) uniquement :
// la liste des adhérents (nom, prénom, mail, mobile) est une donnée propre au
// Spelc, jamais accessible à l'admin académique même pour un Spelc de sa
// propre académie (canAccessSpelc l'autoriserait sinon, comme pour l'accès
// aux documents de scope Spelc — voir services/chatTools.ts).
router.get("/", requireRole("admin_spelc", "admin_general"), (req, res) => {
  const spelc = req.query.spelc as string;
  if (!spelc) {
    res.status(400).json({ error: "Paramètre spelc requis." });
    return;
  }
  if (!canAccessSpelc(req.user!, spelcAcademie(spelc), spelc)) {
    res.status(403).json({ error: "Accès non autorisé à ce Spelc." });
    return;
  }
  const rows = db
    .prepare("SELECT id, nom, prenom, nom_naissance, mail, mobile FROM adherents WHERE spelc = ? ORDER BY nom")
    .all(spelc);
  res.json({ adherents: rows });
});

/**
 * Rapprochement approximatif (nom/prénom proches, pas identiques) entre
 * adhérents et émargements — voir services/fuzzyMatching.ts. Une suggestion
 * n'est jamais appliquée automatiquement : elle doit être validée ici par un
 * admin Spelc (son propre Spelc) ou l'admin général (n'importe lequel).
 */
router.get("/fuzzy-matches", requireRole("admin_spelc", "admin_general"), (req, res) => {
  const spelc = req.query.spelc as string;
  if (!spelc) {
    res.status(400).json({ error: "Paramètre spelc requis." });
    return;
  }
  if (!canAccessSpelc(req.user!, spelcAcademie(spelc), spelc)) {
    res.status(403).json({ error: "Accès non autorisé à ce Spelc." });
    return;
  }
  const status = (req.query.status as "en_attente" | "valide" | "rejete" | undefined) || undefined;
  res.json({ matches: listFuzzyMatches(spelc, status) });
});

/** Recherche de nouveaux candidats approximatifs pour ce Spelc (bouton "Rechercher des rapprochements"). */
router.post("/fuzzy-matches/refresh", requireRole("admin_spelc", "admin_general"), (req, res) => {
  const spelc = (req.body?.spelc as string) || req.user!.spelc || "";
  if (!spelc) {
    res.status(400).json({ error: "Spelc requis." });
    return;
  }
  if (!canAccessSpelc(req.user!, spelcAcademie(spelc), spelc)) {
    res.status(403).json({ error: "Accès non autorisé à ce Spelc." });
    return;
  }
  res.json(refreshFuzzyCandidates(spelc));
});

router.put("/fuzzy-matches/:id", requireRole("admin_spelc", "admin_general"), (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body ?? {};
  if (status !== "valide" && status !== "rejete") {
    res.status(400).json({ error: "Statut invalide (attendu : valide ou rejete)." });
    return;
  }
  const spelc = fuzzyMatchSpelc(id);
  if (!spelc) {
    res.status(404).json({ error: "Suggestion introuvable." });
    return;
  }
  if (!canAccessSpelc(req.user!, spelcAcademie(spelc), spelc)) {
    res.status(403).json({ error: "Accès non autorisé à ce Spelc." });
    return;
  }
  const ok = reviewFuzzyMatch(id, status, req.user!.id);
  if (!ok) {
    res.status(404).json({ error: "Suggestion introuvable." });
    return;
  }
  res.json({ ok: true });
});

export default router;
