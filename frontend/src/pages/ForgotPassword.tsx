import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.post<{ message: string }>("/auth/forgot-password", { email });
      setMessage(res.message);
    } catch (err) {
      setError((err as Error).message || "Une erreur est survenue.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Mot de passe oublié</h1>
        <p className="mb-6 text-sm text-slate-500">
          Indiquez l'adresse e-mail de votre compte : si elle existe, un lien de réinitialisation vous sera envoyé.
        </p>
        {message ? (
          <p className="text-sm text-slate-600">{message}</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                autoComplete="username"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {busy ? "Envoi en cours…" : "Envoyer le lien de réinitialisation"}
            </button>
          </form>
        )}
        <Link to="/" className="mt-4 block text-center text-sm text-slate-500 hover:underline">
          Retour à la connexion
        </Link>
      </div>
    </div>
  );
}
