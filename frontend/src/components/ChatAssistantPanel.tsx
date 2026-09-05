import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Card } from "./Card";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS_BY_ROLE: Record<string, string[]> = {
  admin_general: [
    "Quel est le taux de participation national au CCMMEP ?",
    "Quelles sont les 5 académies avec le plus de non-votants ?",
    "Combien d'adhérents a le Spelc Côte d'Azur, et combien ont voté ?",
  ],
  admin_academique: [
    "Quel est le taux de participation de mon académie au scrutin national ?",
    "Quels établissements ont le moins voté ?",
    "Quelle est la répartition par type de scrutin académique ?",
  ],
  admin_spelc: [
    "Combien de mes adhérents ont voté ?",
    "Quel est le taux de participation de mon Spelc ?",
    "Quels sont mes adhérents qui n'ont pas encore voté ?",
  ],
};

export function ChatAssistantPanel() {
  const { user } = useAuth();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const isAdminGeneral = user?.role === "admin_general";

  function refreshConfig() {
    api.get<{ configured: boolean }>("/chat/config").then((r) => setConfigured(r.configured));
  }
  useEffect(refreshConfig, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function saveApiKey() {
    setSavedMessage(null);
    try {
      await api.put("/chat/config", { apiKey });
      setApiKey("");
      setSavedMessage("Clé API enregistrée.");
      setConfigured(true);
    } catch (err) {
      setSavedMessage((err as Error).message);
    }
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    setError(null);
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await api.post<{ reply: string }>("/chat", { messages: next });
      setMessages([...next, { role: "assistant", content: res.reply }]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const suggestions = SUGGESTIONS_BY_ROLE[user?.role ?? ""] ?? [];

  return (
    <Card
      title="Assistant (IA)"
      subtitle="Posez une question en langage naturel sur vos données de participation — l'assistant interroge la base et ne répond qu'avec ce qu'il y trouve, dans la limite de votre périmètre."
    >
      {isAdminGeneral && (
        <div className="mb-4 rounded-md bg-slate-50 p-3">
          <label className="block text-xs font-medium text-slate-500">
            Clé API Mistral {configured && <span className="text-slate-400">(déjà configurée — laisser vide pour ne pas changer)</span>}
          </label>
          <div className="mt-1 flex flex-wrap gap-2">
            <input
              type="password"
              className="min-w-[240px] flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              placeholder="••••••••••••••••"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <button
              onClick={saveApiKey}
              className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900"
            >
              Enregistrer
            </button>
          </div>
          {savedMessage && <p className="mt-1 text-xs text-slate-600">{savedMessage}</p>}
        </div>
      )}

      {configured === false && !isAdminGeneral ? (
        <p className="text-sm text-slate-500">
          L'assistant n'est pas encore configuré. Demandez à l'admin général de renseigner la clé API Mistral.
        </p>
      ) : (
        <>
          <div className="h-80 space-y-3 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-3">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-sm text-slate-400">Exemples de questions :</p>
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="block w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-100"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                    m.role === "user" ? "bg-slate-800 text-white" : "bg-white text-slate-700 border border-slate-200"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {busy && <p className="text-sm text-slate-400">L'assistant réfléchit…</p>}
            <div ref={bottomRef} />
          </div>

          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <input
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="Posez votre question…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={busy}
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              Envoyer
            </button>
          </form>
        </>
      )}
    </Card>
  );
}
