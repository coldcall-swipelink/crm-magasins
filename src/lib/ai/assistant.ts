// src/lib/ai/assistant.ts
// -----------------------------------------------------------------------------
// Point d'entrée de l'assistant IA du CRM. Choisit automatiquement le moteur IA
// selon les clés configurées (première clé présente dans cet ordre) :
//   - GROQ_API_KEY      → Groq / Llama (gratuit, limites larges — RECOMMANDÉ)
//   - GEMINI_API_KEY    → Google Gemini (gratuit, mais quotas très restreints)
//   - ANTHROPIC_API_KEY → Claude (payant à l'usage)
// Si aucune clé n'est présente, lève MISSING_API_KEY (géré par la route).
// -----------------------------------------------------------------------------
import { askGroq } from './groq';
import { askGemini } from './gemini';
import { askAnthropic } from './anthropic';
import type { ChatMessage } from './shared';

export type { ChatMessage };

export async function askCrmAssistant(history: ChatMessage[]): Promise<string> {
  if (process.env.GROQ_API_KEY) return askGroq(history);
  if (process.env.GEMINI_API_KEY) return askGemini(history);
  if (process.env.ANTHROPIC_API_KEY) return askAnthropic(history);
  throw new Error('MISSING_API_KEY');
}
