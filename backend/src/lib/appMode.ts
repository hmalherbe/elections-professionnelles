/** "full" (par défaut) ou "relance-only" pour un déploiement de démonstration
 * réduit à la seule fonctionnalité de relance des adhérents (voir
 * routes/auth.ts POST /demo-login et le verrou de routes dans index.ts). */
export const APP_MODE = process.env.APP_MODE === "relance-only" ? "relance-only" : "full";

export function isRelanceOnly(): boolean {
  return APP_MODE === "relance-only";
}
