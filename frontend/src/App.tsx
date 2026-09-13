import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { AdminAcademiqueDashboard } from "./pages/AdminAcademiqueDashboard";
import { AdminGeneralDashboard } from "./pages/AdminGeneralDashboard";
import { AdminSpelcDashboard } from "./pages/AdminSpelcDashboard";
import { ForcedPasswordChange } from "./pages/ForcedPasswordChange";
import { ForgotPassword } from "./pages/ForgotPassword";
import { Login } from "./pages/Login";
import { RelanceOnlyDemo } from "./pages/RelanceOnlyDemo";
import { ResetPassword } from "./pages/ResetPassword";
import { api } from "./lib/api";
import { useAuth } from "./lib/auth";

function LoadingScreen() {
  return <div className="flex min-h-screen items-center justify-center text-slate-400">Chargement…</div>;
}

/**
 * Mode d'affichage de ce déploiement (voir backend/src/index.ts, APP_MODE) :
 * "full" (par défaut) ou "relance-only", un environnement de démonstration
 * qui saute entièrement l'écran de connexion — voir RelanceOnlyDemo. Chargé
 * une seule fois avant tout le reste, y compris avant que useAuth() ne
 * détermine s'il existe une session normale.
 */
function useAppMode(): "full" | "relance-only" | null {
  const [mode, setMode] = useState<"full" | "relance-only" | null>(null);
  useEffect(() => {
    api
      .get<{ mode: "full" | "relance-only" }>("/config")
      .then((res) => setMode(res.mode))
      .catch(() => setMode("full"));
  }, []);
  return mode;
}

export default function App() {
  const appMode = useAppMode();
  const { user, loading } = useAuth();

  if (appMode === null) return <LoadingScreen />;
  if (appMode === "relance-only") return <RelanceOnlyDemo />;

  if (loading) return <LoadingScreen />;

  if (!user) {
    return (
      <Routes>
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  if (user.mustChangePassword) return <ForcedPasswordChange />;

  if (user.role === "admin_general") {
    return (
      <Routes>
        <Route element={<Layout navItems={[{ to: "/", label: "Tableau de bord" }]} />}>
          <Route path="*" element={<AdminGeneralDashboard />} />
        </Route>
      </Routes>
    );
  }

  if (user.role === "admin_academique") {
    return (
      <Routes>
        <Route element={<Layout navItems={[{ to: "/", label: "Tableau de bord" }]} />}>
          <Route path="*" element={<AdminAcademiqueDashboard />} />
        </Route>
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout navItems={[{ to: "/", label: "Tableau de bord" }]} />}>
        <Route path="*" element={<AdminSpelcDashboard />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
