import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Volume persistant (backend_data:/app/data en production, DOCUMENTS_DIR fixé par le
// Dockerfile) — le repli relatif ne sert qu'en dev, où data/ est un sous-dossier réel de
// backend/. Sans variable d'environnement, ce chemin retombait dans la couche inscriptible
// du conteneur (hors volume) et les documents étaient perdus à chaque rebuild.
export const DOCUMENTS_DIR = process.env.DOCUMENTS_DIR ?? path.resolve(__dirname, "../../data/uploads/documents");

/**
 * Écrit un document uploadé sur disque sous un nom de fichier aléatoire —
 * jamais dérivé du nom d'origine, pour éviter toute collision ou traversée
 * de chemin. Le nom d'origine et le type sont conservés en base (table
 * documents) pour l'affichage et le téléchargement. Contrairement aux logos
 * (servis publiquement, voir lib/uploads.ts), ces fichiers ne sont jamais
 * exposés en statique : le téléchargement passe par une route authentifiée
 * (routes/documents.ts) qui vérifie l'accès à l'académie/Spelc concerné.
 */
export function saveDocumentUpload(buffer: Buffer, originalName: string): string {
  fs.mkdirSync(DOCUMENTS_DIR, { recursive: true });
  const ext = path.extname(originalName).slice(0, 20);
  const filename = `${crypto.randomUUID()}${ext}`;
  fs.writeFileSync(path.join(DOCUMENTS_DIR, filename), buffer);
  return filename;
}

export function deleteDocumentFile(filename: string): void {
  const filePath = path.join(DOCUMENTS_DIR, filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}
