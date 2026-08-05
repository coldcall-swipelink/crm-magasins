// src/lib/ai/gemini.ts
// -----------------------------------------------------------------------------
// Backend Google Gemini (offre gratuite, clé Google AI Studio) appelé en direct
// via fetch — aucune dépendance npm. Gère la boucle de « function calling » :
// tant que Gemini demande à appeler un outil CRM, on l'exécute et on lui renvoie
// le résultat, jusqu'à obtenir une réponse textuelle finale.
// -----------------------------------------------------------------------------
import { CRM_TOOLS, runCrmTool } from './crmTools';
import { buildSystemPrompt, type ChatMessage } from './shared';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-2.0-flash';
const MAX_TOOL_ROUNDS = 8;

// Convertit un schéma JSON (celui de nos outils) vers le schéma OpenAPI attendu
// par Gemini (types en MAJUSCULES).
function toGeminiSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return { type: 'STRING' };
  const typeMap: Record<string, string> = {
    string: 'STRING', number: 'NUMBER', integer: 'INTEGER',
    boolean: 'BOOLEAN', object: 'OBJECT', array: 'ARRAY',
  };
  const out: any = { type: typeMap[schema.type as string] || 'STRING' };
  if (schema.description) out.description = schema.description;
  if (Array.isArray(schema.enum)) out.enum = schema.enum;
  if (schema.type === 'object' && schema.properties) {
    out.properties = {};
    for (const [k, v] of Object.entries(schema.properties)) out.properties[k] = toGeminiSchema(v);
  }
  if (schema.type === 'array' && schema.items) out.items = toGeminiSchema(schema.items);
  return out;
}

// Déclarations d'outils au format Gemini. Gemini refuse un objet `parameters`
// vide : pour les outils sans paramètre, on omet complètement le champ.
function geminiTools() {
  const functionDeclarations = CRM_TOOLS.map((t) => {
    const decl: any = { name: t.name, description: t.description };
    const props = (t.input_schema as any)?.properties;
    if (props && Object.keys(props).length > 0) {
      decl.parameters = toGeminiSchema(t.input_schema);
    }
    return decl;
  });
  return [{ functionDeclarations }];
}

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, any> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}
interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export async function askGemini(history: ChatMessage[]): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('MISSING_API_KEY');
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  const contents: GeminiContent[] = history
    .filter((m) => m.content?.trim())
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

  const tools = geminiTools();
  const systemInstruction = { parts: [{ text: buildSystemPrompt() }] };

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await fetch(`${API_BASE}/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        system_instruction: systemInstruction,
        contents,
        tools,
        generationConfig: { maxOutputTokens: 1500, temperature: 0 },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // Quota du palier gratuit dépassé (limite par minute ou par jour) : message
      // dédié plutôt que l'erreur brute, car ce n'est pas un bug applicatif.
      if (res.status === 429) throw new Error('GEMINI_QUOTA');
      throw new Error(`Gemini API ${res.status}: ${text.slice(0, 500)}`);
    }

    const data = (await res.json()) as { candidates?: { content?: GeminiContent }[] };
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const calls = parts.filter((p) => p.functionCall);

    // Réponse finale : aucun appel d'outil demandé.
    if (calls.length === 0) {
      const text = parts.filter((p) => p.text).map((p) => p.text).join('\n').trim();
      return text || "Je n'ai pas de réponse à formuler.";
    }

    // On rejoue le tour du modèle (avec ses functionCall), puis on renvoie les
    // résultats d'outils dans un tour « user ».
    contents.push({ role: 'model', parts });

    const responseParts: GeminiPart[] = [];
    for (const c of calls) {
      const fc = c.functionCall!;
      let result: unknown;
      try {
        result = await runCrmTool(fc.name, fc.args || {});
      } catch (err) {
        result = { error: err instanceof Error ? err.message : 'Erreur outil' };
      }
      responseParts.push({
        functionResponse: {
          name: fc.name,
          response: result && typeof result === 'object' ? (result as Record<string, unknown>) : { value: result },
        },
      });
    }
    contents.push({ role: 'user', parts: responseParts });
  }

  return "Désolé, la requête est trop complexe à traiter pour le moment. Reformulez-la plus simplement.";
}
