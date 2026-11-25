import { Router } from "express";
import multer from "multer";
import { db } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { normalizeName } from "../lib/normalize.js";
import { loadWorkbook, rowsAsObjects } from "../lib/xlsx.js";
import { parseCsvBuffer } from "../lib/csv.js";
import {
  listCurrentElecteurs,
  listFuzzyMatches,
  listUnmatchedAdherents,
  manuallyMatchAdherent,
  refreshFuzzyCandidates,
  reviewFuzzyMatch,
} from "../services/fuzzyMatching.js";

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
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM adherent_fuzzy_matches").run();
    return db.prepare("DELETE FROM adherents").run();
  });
  const info = tx();
  res.json({ deleted: info.changes });
});

/**
 * Rapprochement approximatif (nom/prénom proches, pas identiques) entre
 * adhérents et émargements — voir services/fuzzyMatching.ts. Une suggestion
 * n'est jamais appliquée automatiquement : elle doit être validée ici.
 */
router.get("/fuzzy-matches", (req, res) => {
  const status = (req.query.status as "en_attente" | "valide" | "rejete" | undefined) || undefined;
  res.json({ matches: listFuzzyMatches(status) });
});

/** Recherche de nouveaux candidats approximatifs (bouton "Rechercher des rapprochements"). */
router.post("/fuzzy-matches/refresh", (_req, res) => {
  res.json(refreshFuzzyCandidates());
});

/**
 * Détail nommé des adhérents non retrouvés par correspondance exacte (le
 * compteur affiché après "Rechercher des rapprochements") : statut
 * ambigu/aucun candidat/déjà en file, pour comprendre qui ils sont.
 */
router.get("/fuzzy-matches/unmatched", (_req, res) => {
  res.json({ adherents: listUnmatchedAdherents() });
});

/** Liste complète des électeurs des scrutins courants, triée
 * alphabétiquement — peuple la liste déroulante de rapprochement manuel. */
router.get("/electeurs", (_req, res) => {
  res.json({ electeurs: listCurrentElecteurs() });
});

/**
 * Rapprochement manuel explicite d'un adhérent avec un électeur choisi dans
 * la liste complète (UnmatchedAdherentsPanel) — toujours enregistré
 * "valide" directement, voir manuallyMatchAdherent().
 */
router.post("/fuzzy-matches/manual", (req, res) => {
  const { adherentId, candidateNom, candidatePrenom } = req.body ?? {};
  if (!Number.isInteger(adherentId) || !candidateNom || !candidatePrenom) {
    res.status(400).json({ error: "adherentId, candidateNom et candidatePrenom requis." });
    return;
  }
  const ok = manuallyMatchAdherent(adherentId, String(candidateNom), String(candidatePrenom), req.user!.id);
  if (!ok) {
    res.status(404).json({ error: "Adhérent introuvable." });
    return;
  }
  res.json({ ok: true });
});

router.put("/fuzzy-matches/:id", (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body ?? {};
  if (status !== "valide" && status !== "rejete") {
    res.status(400).json({ error: "Statut invalide (attendu : valide ou rejete)." });
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
