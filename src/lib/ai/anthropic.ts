// src/lib/ai/anthropic.ts
// -----------------------------------------------------------------------------
// Client minimal de l'API Messages d'Anthropic (Claude), appelée en direct via
// fetch — pas de dépendance npm supplémentaire. Gère la boucle de « tool use » :
// tant que Claude demande à appeler un outil CRM, on l'exécute et on lui renvoie
// le résultat, jusqu'à obtenir une réponse textuelle finale.
// -----------------------------------------------------------------------------
import { CRM_TOOLS, runCrmTool } from './crmTools';

const API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-5';
const MAX_TOOL_ROUNDS = 8;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, any> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | Block[];
}

function systemPrompt(): string {
  const today = new Date().toISOString().slice(0, 10);
  return [
    "Tu es l'assistant IA du CRM « CRM Magasins » (prospection commerciale de magasins à partir d'offres d'emploi).",
    `La date du jour est le ${today}.`,
    'Tu réponds aux questions du commercial sur ses données CRM : closings/ventes, MRR, pipeline, affaires, actions/rappels, enseignes.',
    '',
    'RÈGLES :',
    "- Utilise TOUJOURS les outils fournis pour récupérer les vraies données avant de répondre. N'invente jamais de chiffres.",
    "- Calcule les périodes toi-même à partir de la date du jour (ex. « 3 derniers mois » = les 3 derniers mois glissants) et passe des dates YYYY-MM-DD aux outils.",
    "- Un « closing » = un abonnement signé (date de closing renseignée). Le MRR est un montant MENSUEL ; l'ARR = MRR×12.",
    '- Réponds en français, de façon concise et directe. Donne le chiffre demandé en premier, puis un court détail utile si pertinent.',
    '- Formate les montants en euros (ex. « 1 250 € »).',
    "- Si une donnée n'existe pas ou si aucun résultat, dis-le simplement.",
    '- Tu es en lecture seule : tu ne peux pas modifier le CRM, seulement l\'analyser.',
  ].join('\n');
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
      system: systemPrompt(),
      tools: CRM_TOOLS,
      messages,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 500)}`);
  }
  return (await res.json()) as {
    stop_reason: string;
    content: Block[];
  };
}

// Envoie l'historique de conversation à Claude et renvoie sa réponse textuelle,
// en résolvant automatiquement les appels d'outils CRM intermédiaires.
export async function askCrmAssistant(history: ChatMessage[]): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('MISSING_API_KEY');
  }
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;

  const messages: AnthropicMessage[] = history
    .filter((m) => m.content?.trim())
    .map((m) => ({ role: m.role, content: m.content }));

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await callAnthropic(apiKey, model, messages);

    const toolUses = response.content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');

    // Réponse finale : plus aucun appel d'outil demandé.
    if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
      const text = response.content
        .filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return text || "Je n'ai pas de réponse à formuler.";
    }

    // On rejoue le message assistant (avec ses tool_use) puis on renvoie les
    // résultats d'outils dans un message user.
    messages.push({ role: 'assistant', content: response.content });

    const toolResults: Block[] = [];
    for (const tu of toolUses) {
      let result: unknown;
      try {
        result = await runCrmTool(tu.name, tu.input || {});
      } catch (err) {
        result = { error: err instanceof Error ? err.message : 'Erreur outil' };
      }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  return "Désolé, la requête est trop complexe à traiter pour le moment. Reformulez-la plus simplement.";
}
