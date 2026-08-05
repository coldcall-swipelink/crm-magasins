// src/app/api/ai/chat/route.ts
// Chat de l'assistant IA du Dashboard : reçoit l'historique de conversation et
// renvoie la réponse de Claude, qui interroge les données CRM via les outils.
import { NextRequest, NextResponse } from 'next/server';
import { askCrmAssistant, type ChatMessage } from '@/lib/ai/assistant';

// Lecture DB à chaque appel : jamais mis en cache statique.
export const dynamic = 'force-dynamic';
// Les boucles d'outils peuvent enchaîner plusieurs appels : on laisse du temps.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const messages: ChatMessage[] = Array.isArray(body?.messages) ? body.messages : [];

    const cleaned = messages
      .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: m.content }))
      // Garde-fou coût/latence : on ne renvoie que les 20 derniers tours.
      .slice(-20);

    if (!cleaned.length || cleaned[cleaned.length - 1].role !== 'user') {
      return NextResponse.json({ error: 'Message utilisateur manquant.' }, { status: 400 });
    }

    const reply = await askCrmAssistant(cleaned);
    return NextResponse.json({ reply });
  } catch (err) {
    if (err instanceof Error && err.message === 'MISSING_API_KEY') {
      return NextResponse.json(
        { error: "L'assistant IA n'est pas configuré : ajoutez une clé GEMINI_API_KEY (gratuite) dans le fichier .env." },
        { status: 503 },
      );
    }
    if (err instanceof Error && err.message === 'GEMINI_QUOTA') {
      return NextResponse.json(
        { error: "Quota gratuit Gemini atteint (limite par minute ou par jour). Patientez ~1 min puis réessayez. Si cela persiste, la limite quotidienne est atteinte : réessayez demain ou activez la facturation Google (le palier gratuit reste applicable)." },
        { status: 429 },
      );
    }
    console.error('[POST /api/ai/chat]', err);
    // On fait remonter le détail réel (tronqué) : c'est un outil interne et le
    // message précis (ex. modèle introuvable, quota, timeout) aide à corriger.
    const detail = err instanceof Error ? err.message.slice(0, 400) : String(err).slice(0, 400);
    return NextResponse.json({ error: "Erreur de l'assistant IA. Réessayez.", detail }, { status: 500 });
  }
}
