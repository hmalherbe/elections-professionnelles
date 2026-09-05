import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Card } from "./Card";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const SEPARATOR_ROW = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitTableRow(line: string): string[] {
  let cells = line.trim();
  if (cells.startsWith("|")) cells = cells.slice(1);
  if (cells.endsWith("|")) cells = cells.slice(0, -1);
  return cells.split("|").map((c) => c.trim());
}

/**
 * Mistral répond parfois avec un tableau au format Markdown (texte brut,
 * colonnes séparées par des "|" et une ligne de tirets) — illisible tel
 * quel dans une bulle de chat en police proportionnelle, les tirets ne
 * s'alignant jamais avec le contenu. On détecte ce format et on le rend en
 * vraie balise <table>, sans dépendre d'un parseur Markdown complet ni de
 * dangerouslySetInnerHTML (le contenu reste du texte, jamais du HTML).
 */
function renderAssistantContent(content: string) {
  const lines = content.split("\n");
  const blocks: { type: "text" | "table"; lines: string[] }[] = [];
  let i = 0;
  while (i < lines.length) {
    const isHeaderCandidate = lines[i].includes("|");
    const isSeparator = i + 1 < lines.length && SEPARATOR_ROW.test(lines[i + 1]);
    if (isHeaderCandidate && isSeparator) {
      const tableLines = [lines[i]];
      i += 2; // saute l'en-tête + la ligne de séparation
      while (i < lines.length && lines[i].includes("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: "table", lines: tableLines });
    } else {
      const textLines: string[] = [];
      while (i < lines.length && !(lines[i].includes("|") && i + 1 < lines.length && SEPARATOR_ROW.test(lines[i + 1]))) {
        textLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: "text", lines: textLines });
    }
  }

  return blocks.map((block, bi) => {
    if (block.type === "text") {
      const text = block.lines.join("\n").trim();
      return text ? (
        <p key={bi} className="whitespace-pre-wrap">
          {text}
        </p>
      ) : null;
    }
    const [header, ...rows] = block.lines.map(splitTableRow);
    return (
      <div key={bi} className="overflow-x-auto">
        <table className="min-w-full border-collapse text-xs">
          <thead>
            <tr>
              {header.map((cell, ci) => (
                <th key={ci} className="border-b border-slate-300 px-2 py-1 text-left font-semibold text-slate-600">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className="odd:bg-slate-50">
                {row.map((cell, ci) => (
                  <td key={ci} className="border-b border-slate-100 px-2 py-1 text-slate-700">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  });
}

// Questions choisies pour obliger l'assistant à croiser plusieurs outils
// (pas juste lire un seul chiffre) : comparaisons, écarts, seuils dans le
// temps... un bon test de sa capacité à vraiment combiner les données.
const SUGGESTIONS_BY_ROLE: Record<string, string[]> = {
  admin_general: [
    "Quelles sont les 3 académies avec le meilleur taux de participation et les 3 avec le plus faible, et quel est l'écart entre elles ?",
    "Le Spelc Côte d'Azur est-il plus engagé que la moyenne de son académie ?",
    "Pour le Spelc Côte d'Azur, quelle est la différence de taux de vote entre les adhérents et les non-adhérents ?",
    "À quelle date le taux de participation national a-t-il dépassé 50 %, et quel est l'écart avec le taux final ?",
    "Quels sont les établissements avec le plus d'inscrits mais un taux de participation inférieur à la moyenne nationale ?",
  ],
  admin_academique: [
    "Quel est l'écart entre le taux de participation de mon académie au scrutin national et celui du scrutin académique local ?",
    "Quels sont les 3 établissements avec le plus d'inscrits mais le taux de participation le plus faible ?",
    "Quelle est la répartition des votants par type de scrutin académique, et lequel a le meilleur taux de participation ?",
    "À quelle date mon académie a-t-elle dépassé 50 % de participation au scrutin national ?",
    "Quels établissements de mon académie n'ont pas encore atteint 30 % de participation ?",
  ],
  admin_spelc: [
    "Quelle est la différence de taux de vote entre mes adhérents et mes non-adhérents ?",
    "Quel est l'écart entre le taux de participation de mon Spelc au scrutin national et au scrutin académique local ?",
    "Parmi mes adhérents, quelle proportion a déjà voté, et combien n'ont pas encore voté ?",
    "Quels sont mes établissements avec le plus d'inscrits mais un taux de participation inférieur à celui de mon Spelc ?",
    "À quelle date le taux de participation de mon Spelc a-t-il dépassé 50 %, et quel est l'écart avec le taux final ?",
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
              <p className="text-sm text-slate-400">
                Posez une question, ou choisissez une idée de question ci-dessous.
              </p>
            )}
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[80%] whitespace-pre-wrap rounded-lg bg-slate-800 px-3 py-2 text-sm text-white">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={i} className="flex justify-start">
                  <div className="max-w-full space-y-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                    {renderAssistantContent(m.content)}
                  </div>
                </div>
              )
            )}
            {busy && <p className="text-sm text-slate-400">L'assistant réfléchit…</p>}
            <div ref={bottomRef} />
          </div>

          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

          {suggestions.length > 0 && (
            <select
              className="mt-3 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600"
              value=""
              disabled={busy}
              onChange={(e) => {
                if (e.target.value) send(e.target.value);
                e.target.value = "";
              }}
            >
              <option value="">💡 Idées de questions…</option>
              {suggestions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}

          <form
            className="mt-2 flex gap-2"
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
