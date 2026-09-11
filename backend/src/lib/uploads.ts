import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Volume persistant (backend_data:/app/data en production, UPLOADS_DIR fixé par le
// Dockerfile) : contrairement à backend/assets (image-baked, remplacé à chaque rebuild),
// ce qui est écrit ici doit survivre aux redéploiements — le repli relatif ne sert qu'en
// dev, où il ne pointait pas dans le volume monté et perdait les logos à chaque rebuild.
export const UPLOADS_DIR = process.env.UPLOADS_DIR ?? path.resolve(__dirname, "../../data/uploads/logos");

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

function slugify(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "logo"
  );
}

/**
 * Décode un logo envoyé en data URI (base64) et l'écrit comme fichier réel
 * dans le volume persistant, plutôt que de stocker le blob dans la base —
 * une image en data URI est bloquée par de nombreux clients mail (Gmail,
 * Outlook.com...), voir lib/socialLinks.ts. Retourne un chemin relatif servi
 * par la route /api/uploads (index.ts) à préfixer par PUBLIC_BASE_URL pour un
 * usage dans un mail (voir buildLogoHtml) ; `null` si l'entrée n'est pas une
 * data URI image valide. Toute image précédente pour cette clé est supprimée
 * (une seule image active par propriétaire).
 */
export function saveLogoUpload(ownerKey: string, dataUri: string): string | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUri.trim());
  if (!match) return null;
  const ext = EXT_BY_MIME[match[1].toLowerCase()] ?? "png";
  const buffer = Buffer.from(match[2], "base64");
  const key = slugify(ownerKey);

  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  for (const existing of fs.readdirSync(UPLOADS_DIR)) {
    if (existing.startsWith(`${key}.`)) fs.unlinkSync(path.join(UPLOADS_DIR, existing));
  }
  const filename = `${key}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
  // Cache-bust : un remplacement garde le même nom de fichier, un navigateur/
  // client mail ayant mis l'ancienne image en cache doit voir la nouvelle.
  return `/api/uploads/logos/${filename}?v=${Date.now()}`;
}
