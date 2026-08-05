// src/lib/ai/anthropic.ts
// -----------------------------------------------------------------------------
// Backend Claude (API Anthropic) appelé en direct via fetch — pas de dépendance
// npm. Gère la boucle de « tool use » : tant que Claude demande à appeler un
// outil CRM, on l'exécute et on lui renvoie le résultat, jusqu'à obtenir une
// réponse textuelle finale. Alternative payante à Gemini (voir assistant.ts).
// -----------------------------------------------------------------------------
import { CRM_TOOLS, runCrmTool } from './crmTools';
import { buildSystemPrompt, type ChatMessage } from './shared';

const API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-5';
const MAX_TOOL_ROUNDS = 8;

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, any> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | Block[];
}

async function callAnthropic(apiKey: string, model: string, messages: AnthropicMessage[]) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      system: buildSystemPrompt(),
      tools: CRM_TOOLS,
      messages,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 500)}`);
  }
  return (await res.json()) as { stop_reason: string; content: Block[] };
}

export async function askAnthropic(history: ChatMessage[]): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('MISSING_API_KEY');
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;

  const messages: AnthropicMessage[] = history
    .filter((m) => m.content?.trim())
    .map((m) => ({ role: m.role, content: m.content }));

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await callAnthropic(apiKey, model, messages);

    const toolUses = response.content.filter(
      (b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use',
    );

    if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
      const text = response.content
        .filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return text || "Je n'ai pas de réponse à formuler.";
    }

    messages.push({ role: 'assistant', content: response.content });

    const toolResults: Block[] = [];
    for (const tu of toolUses) {
      let result: unknown;
      try {
        result = await runCrmTool(tu.name, tu.input || {});
      } catch (err) {
        result = { error: err instanceof Error ? err.message : 'Erreur outil' };
      }
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  return "Désolé, la requête est trop complexe à traiter pour le moment. Reformulez-la plus simplement.";
}
