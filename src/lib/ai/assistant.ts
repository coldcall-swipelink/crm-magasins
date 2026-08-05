// src/lib/ai/assistant.ts
// -----------------------------------------------------------------------------
// Point d'entrée de l'assistant IA du CRM. Choisit automatiquement le moteur IA
// selon les clés configurées :
//   - GEMINI_API_KEY    → Google Gemini (offre gratuite, recommandé)
//   - ANTHROPIC_API_KEY → Claude (payant à l'usage)
// Si aucune clé n'est présente, lève MISSING_API_KEY (géré par la route).
// -----------------------------------------------------------------------------
import { askGemini } from './gemini';
import { askAnthropic } from './anthropic';
import type { ChatMessage } from './shared';

export type { ChatMessage };

export async function askCrmAssistant(history: ChatMessage[]): Promise<string> {
  if (process.env.GEMINI_API_KEY) return askGemini(history);
  if (process.env.ANTHROPIC_API_KEY) return askAnthropic(history);
  throw new Error('MISSING_API_KEY');
}
