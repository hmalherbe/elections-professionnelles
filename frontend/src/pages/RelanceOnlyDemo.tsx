import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { AuthUser } from "../lib/types";
import { BrevoPanel } from "./AdminSpelcDashboard";

/**
 * Environnement de démonstration "relance-only" (voir backend/src/index.ts,
 * APP_MODE) : accès direct, sans écran de connexion, à la seule
 * fonctionnalité de relance des adhérents non-votants d'un Spelc désigné par
 * RELANCE_DEMO_EMAIL côté serveur. Réutilise tel quel le composant de
 * production BrevoPanel — aucune logique de relance dupliquée ni divergente.
 */
export function RelanceOnlyDemo() {
  const { user, updateAuth } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) return;
    api
      .post<{ token: string; user: AuthUser }>("/auth/demo-login")
      .then((res) => updateAuth(res.token, res.user))
      .catch((err) => setError(err.message ?? "Impossible de charger la démonstration."));
  }, [user, updateAuth]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-center text-red-600">{error}</div>
    );
  }

  if (!user) {
    return <div className="flex min-h-screen items-center justify-center text-slate-400">Chargement…</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-6 py-4">
          <p className="text-sm font-semibold text-slate-900">
            Système de suivi des élections professionnelles CCM — Spelc
          </p>
          <p className="text-xs text-slate-500">
            Maquette — Relance des adhérents non-votants{user.spelc ? ` · ${user.spelc}` : ""}
          </p>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-6">
        <BrevoPanel spelc={user.spelc!} relanceOnly />
      </main>
    </div>
  );
}
