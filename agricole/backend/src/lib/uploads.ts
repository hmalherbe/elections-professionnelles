import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOADS_DIR = process.env.UPLOADS_DIR ?? path.resolve(__dirname, "../../data/uploads/logos");

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

/**
 * Décode un logo envoyé en data URI (base64) et l'écrit comme fichier réel
 * dans le volume persistant, plutôt que de stocker le blob en base — une
 * image en data URI est bloquée par de nombreux clients mail. Retourne un
 * chemin relatif servi par /api/uploads (index.ts), à préfixer par
 * PUBLIC_BASE_URL pour un usage dans un mail (voir buildLogoHtml). Un seul
 * logo actif pour l'organisation : tout fichier précédent est supprimé.
 */
export function saveLogoUpload(dataUri: string): string | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUri.trim());
  if (!match) return null;
  const ext = EXT_BY_MIME[match[1].toLowerCase()] ?? "png";
  const buffer = Buffer.from(match[2], "base64");

  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  for (const existing of fs.readdirSync(UPLOADS_DIR)) {
    if (existing.startsWith("logo.")) fs.unlinkSync(path.join(UPLOADS_DIR, existing));
  }
  const filename = `logo.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
  // Cache-bust : un remplacement garde le même nom de fichier.
  return `/api/uploads/logos/${filename}?v=${Date.now()}`;
}
