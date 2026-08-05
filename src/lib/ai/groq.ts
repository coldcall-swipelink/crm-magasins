// src/lib/ai/groq.ts
// -----------------------------------------------------------------------------
// Backend Groq (offre gratuite généreuse, sans carte bancaire) appelé via son
// API compatible OpenAI — aucune dépendance npm. Gère la boucle de « function
// calling » : tant que le modèle demande à appeler un outil CRM, on l'exécute et
// on lui renvoie le résultat, jusqu'à une réponse textuelle finale.
// -----------------------------------------------------------------------------
import { CRM_TOOLS, runCrmTool } from './crmTools';
import { buildSystemPrompt, type ChatMessage } from './shared';

const API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const MAX_TOOL_ROUNDS = 8;

// Format d'outil attendu par l'API compatible OpenAI de Groq.
function groqTools() {
  return CRM_TOOLS.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
interface GroqMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export async function askGroq(history: ChatMessage[]): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('MISSING_API_KEY');
  const model = process.env.GROQ_MODEL || DEFAULT_MODEL;

  const messages: GroqMessage[] = [
    { role: 'system', content: buildSystemPrompt() },
    ...history.filter((m) => m.content?.trim()).map((m) => ({ role: m.role, content: m.content })),
  ];
  const tools = groqTools();

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        tools,
        tool_choice: 'auto',
        temperature: 0,
        max_tokens: 1500,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 429) throw new Error('PROVIDER_QUOTA');
      throw new Error(`Groq API ${res.status}: ${text.slice(0, 500)}`);
    }

    const data = (await res.json()) as { choices?: { message?: GroqMessage }[] };
    const msg = data.choices?.[0]?.message;
    if (!msg) return "Je n'ai pas de réponse à formuler.";

    const toolCalls = msg.tool_calls ?? [];

    // Réponse finale : aucun appel d'outil demandé.
    if (toolCalls.length === 0) {
      return (msg.content || '').trim() || "Je n'ai pas de réponse à formuler.";
    }

    // On rejoue le message assistant (avec ses tool_calls) puis on renvoie un
    // message « tool » par appel.
    messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: toolCalls });

    for (const tc of toolCalls) {
      let result: unknown;
      try {
        const args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        result = await runCrmTool(tc.function.name, args);
      } catch (err) {
        result = { error: err instanceof Error ? err.message : 'Erreur outil' };
      }
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
    }
  }

  return "Désolé, la requête est trop complexe à traiter pour le moment. Reformulez-la plus simplement.";
}
