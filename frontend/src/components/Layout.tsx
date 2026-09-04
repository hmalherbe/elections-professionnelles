import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth";

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
    </div>
  );
}
