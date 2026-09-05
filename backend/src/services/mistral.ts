import { decrypt, encrypt } from "../lib/crypto.js";
import { getSetting, setSetting } from "./settings.js";
import type { ToolDef } from "./chatTools.js";

const MISTRAL_API = "https://api.mistral.ai/v1/chat/completions";
// mistral-small-latest plutôt que mistral-large-latest : supporte aussi le
// function calling, et surtout reste accessible sur les paliers Mistral les
// plus restreints (large a renvoyé "tier_not_allowed" sur un compte réel) —
// suffisant ici puisque les réponses s'appuient sur les résultats d'outils,
// pas sur les capacités de raisonnement brut du modèle.
const MODEL = "mistral-small-latest";
const MAX_TOOL_ROUNDS = 5;

export function isMistralConfigured(): boolean {
  return Boolean(getSetting("mistral_api_key"));
}

export function saveMistralApiKey(apiKey: string): void {
  setSetting("mistral_api_key", encrypt(apiKey));
}

function getMistralApiKey(): string {
  const encrypted = getSetting("mistral_api_key");
  if (!encrypted) throw new Error("Clé API Mistral non configurée.");
  return decrypt(encrypted);
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: MistralToolCall[];
}

interface MistralToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface MistralChoice {
  message: {
    role: "assistant";
    content: string | null;
    tool_calls?: MistralToolCall[];
  };
}

async function callMistral(messages: ChatMessage[], tools: ToolDef[]): Promise<MistralChoice["message"]> {
  const apiKey = getMistralApiKey();
  const response = await fetch(MISTRAL_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? "auto" : undefined,
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Erreur API Mistral (${response.status}) : ${text.slice(0, 300)}`);
  }
  const data = (await response.json()) as { choices: MistralChoice[] };
  const choice = data.choices?.[0];
  if (!choice) throw new Error("Réponse Mistral vide.");
  return choice.message;
}

/**
 * Boucle de function calling : envoie la conversation à Mistral, exécute
 * les outils qu'il demande via `runTool`, lui renvoie les résultats, et
 * recommence jusqu'à obtenir une réponse texte finale (ou jusqu'à
 * MAX_TOOL_ROUNDS, pour éviter une boucle infinie en cas de comportement
 * inattendu du modèle).
 */
export async function chatWithTools(
  messages: ChatMessage[],
  tools: ToolDef[],
  runTool: (name: string, args: Record<string, unknown>) => unknown
): Promise<string> {
  const history = [...messages];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const message = await callMistral(history, tools);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      return message.content ?? "";
    }

    history.push({ role: "assistant", content: message.content ?? "", tool_calls: message.tool_calls });

    for (const call of message.tool_calls) {
      let resultText: string;
      try {
        const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        const result = runTool(call.function.name, args);
        resultText = JSON.stringify(result);
      } catch (err) {
        resultText = JSON.stringify({ error: (err as Error).message });
      }
      history.push({ role: "tool", tool_call_id: call.id, content: resultText });
    }
  }

  throw new Error("Le modèle n'a pas produit de réponse finale après plusieurs appels d'outils.");
}
