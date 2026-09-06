import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { AdminAcademiqueDashboard } from "./pages/AdminAcademiqueDashboard";
import { AdminGeneralDashboard } from "./pages/AdminGeneralDashboard";
import { AdminSpelcDashboard } from "./pages/AdminSpelcDashboard";
import { ForcedPasswordChange } from "./pages/ForcedPasswordChange";
import { ForgotPassword } from "./pages/ForgotPassword";
import { Login } from "./pages/Login";
import { ResetPassword } from "./pages/ResetPassword";
import { useAuth } from "./lib/auth";

function LoadingScreen() {
  return <div className="flex min-h-screen items-center justify-center text-slate-400">Chargement…</div>;
}

export default function App() {
  const { user, loading } = useAuth();

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
