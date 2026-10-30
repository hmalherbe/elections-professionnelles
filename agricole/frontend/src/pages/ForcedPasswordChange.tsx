import { ChangePasswordForm } from "../components/ChangePasswordForm";

export function ForcedPasswordChange() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Changement de mot de passe requis</h1>
        <p className="mb-6 text-sm text-slate-500">
          Votre mot de passe est temporaire. Veuillez en choisir un nouveau avant de continuer.
        </p>
        <ChangePasswordForm />
      </div>
    </div>
  );
}
