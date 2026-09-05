import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { ChangePasswordForm } from "./ChangePasswordForm";

const roleLabels: Record<string, string> = {
  admin_general: "Administrateur général",
  admin_academique: "Administrateur académique",
  admin_spelc: "Administrateur Spelc",
};

interface NavItem {
  to: string;
  label: string;
}

export function Layout({ navItems }: { navItems: NavItem[] }) {
  const { user, logout } = useAuth();
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Élections professionnelles 2026</p>
            <p className="text-xs text-slate-500">3 au 10 décembre 2026</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm text-slate-700">{user?.email}</p>
              <p className="text-xs text-slate-500">
                {user ? roleLabels[user.role] : ""}
                {user?.academie ? ` · ${user.academie}` : ""}
                {user?.spelc ? ` · ${user.spelc}` : ""}
              </p>
            </div>
            <button
              onClick={() => setShowPasswordForm(true)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            >
              Changer mon mot de passe
            </button>
            <button
              onClick={logout}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            >
              Déconnexion
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1 px-6">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `border-b-2 px-3 py-2 text-sm font-medium ${
                  isActive
                    ? "border-emerald-600 text-emerald-700"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6">
        <Outlet />
      </main>
      {showPasswordForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-lg">
            <h2 className="mb-1 text-base font-semibold text-slate-900">Changer mon mot de passe</h2>
            <p className="mb-4 text-sm text-slate-500">Applicable à tous les comptes, y compris l'admin général.</p>
            <ChangePasswordForm
              onSuccess={() => setShowPasswordForm(false)}
              onCancel={() => setShowPasswordForm(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
