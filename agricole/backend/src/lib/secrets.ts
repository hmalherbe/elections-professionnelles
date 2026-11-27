/**
 * Lit un secret depuis la première variable d'environnement définie parmi
 * `envVarNames`, avec une valeur de repli (`devFallback`) UNIQUEMENT hors
 * production (développement local, tests unitaires) — en production
 * (NODE_ENV=production, toujours vrai sur les conteneurs déployés, voir
 * infra/Dockerfile.backend `ENV NODE_ENV=production`), l'absence de toutes
 * les variables fait échouer le démarrage plutôt que de signer les jetons
 * JWT ou chiffrer les clés API Brevo stockées en base avec une valeur
 * connue de quiconque lit ce dépôt — un secret de repli silencieux
 * reviendrait à une authentification/un chiffrement cassés par défaut.
 */
export function requiredSecret(envVarNames: string[], devFallback: string): string {
  for (const name of envVarNames) {
    const value = process.env[name];
    if (value) return value;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `Secret manquant en production : définir l'une de ces variables d'environnement : ${envVarNames.join(", ")}.`
    );
  }
  return devFallback;
}
