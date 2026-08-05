'use client';
// -----------------------------------------------------------------------------
// Assistant IA du Dashboard : bulle flottante (bas-droite) ouvrant un panneau
// de chat branché sur Claude (route POST /api/ai/chat). Claude répond en
// interrogeant les vraies données du CRM (closings, pipeline, affaires, etc.).
// -----------------------------------------------------------------------------
import { useEffect, useRef, useState } from 'react';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  'Combien de closings sur les 3 derniers mois ?',
  'Quel est mon MRR total ?',
  'Répartition des affaires par étape',
  "Quelles actions sont en retard ?",
];

export default function AiChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || loading) return;
    setError(null);
    const next: Msg[] = [...messages, { role: 'user', content: question }];
    setMessages(next);
    setInput('');
    setLoading(true);
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        const base = data?.error || "Erreur de l'assistant.";
        throw new Error(data?.detail ? `${base}\n\nDétail : ${data.detail}` : base);
      }
      setMessages((m) => [...m, { role: 'assistant', content: data.reply }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de l'assistant.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Bouton flottant */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Assistant IA"
        style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 60,
          width: 56, height: 56, borderRadius: '50%', border: 'none', cursor: 'pointer',
          background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', color: '#fff',
          fontSize: 24, boxShadow: '0 8px 24px rgba(79,70,229,.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'transform .15s',
        }}
      >
        {open ? '✕' : '✨'}
      </button>

      {/* Panneau de chat */}
      {open && (
        <div
          style={{
            position: 'fixed', bottom: 92, right: 24, zIndex: 60,
            width: 'min(400px, calc(100vw - 32px))', height: 'min(560px, calc(100vh - 130px))',
            background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0',
            boxShadow: '0 16px 48px rgba(15,23,42,.22)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}
        >
          {/* En-tête */}
          <div style={{ padding: '14px 16px', background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', color: '#fff', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(255,255,255,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17 }}>✨</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Assistant IA</div>
              <div style={{ fontSize: 11, opacity: 0.85 }}>Interroge tes données CRM</div>
            </div>
            {messages.length > 0 && (
              <button
                onClick={() => { setMessages([]); setError(null); }}
                title="Nouvelle conversation"
                style={{ background: 'rgba(255,255,255,.18)', border: 'none', color: '#fff', fontSize: 11, padding: '5px 9px', borderRadius: 7, cursor: 'pointer' }}
              >
                Effacer
              </button>
            )}
          </div>

          {/* Messages */}
          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 14, background: '#f8fafc' }}>
            {messages.length === 0 && (
              <div>
                <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 12, lineHeight: 1.5 }}>
                  👋 Posez une question sur votre CRM. Par exemple :
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      style={{
                        textAlign: 'left', fontSize: 12.5, color: '#4338ca', background: '#eef2ff',
                        border: '1px solid #e0e7ff', borderRadius: 10, padding: '9px 12px', cursor: 'pointer', lineHeight: 1.4,
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
                <div
                  style={{
                    maxWidth: '85%', fontSize: 13, lineHeight: 1.5, padding: '9px 12px', borderRadius: 12,
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    background: m.role === 'user' ? '#4f46e5' : '#fff',
                    color: m.role === 'user' ? '#fff' : '#0f172a',
                    border: m.role === 'user' ? 'none' : '1px solid #e2e8f0',
                    borderBottomRightRadius: m.role === 'user' ? 3 : 12,
                    borderBottomLeftRadius: m.role === 'user' ? 12 : 3,
                  }}
                >
                  {m.content}
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 10 }}>
                <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, borderBottomLeftRadius: 3, padding: '11px 14px', display: 'flex', gap: 4 }}>
                  <Dot delay={0} /><Dot delay={0.15} /><Dot delay={0.3} />
                </div>
              </div>
            )}

            {error && (
              <div style={{ fontSize: 12, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '9px 12px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {error}
              </div>
            )}
          </div>

          {/* Saisie */}
          <form
            onSubmit={(e) => { e.preventDefault(); send(input); }}
            style={{ padding: 12, borderTop: '1px solid #e2e8f0', display: 'flex', gap: 8, background: '#fff' }}
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Posez votre question…"
              disabled={loading}
              style={{
                flex: 1, height: 40, padding: '0 12px', borderRadius: 10, border: '1px solid #e2e8f0',
                fontSize: 13, outline: 'none', color: '#0f172a', background: loading ? '#f8fafc' : '#fff',
              }}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              style={{
                width: 40, height: 40, borderRadius: 10, border: 'none', flexShrink: 0,
                background: loading || !input.trim() ? '#c7d2fe' : '#4f46e5', color: '#fff', fontSize: 16,
                cursor: loading || !input.trim() ? 'default' : 'pointer',
              }}
            >
              ➤
            </button>
          </form>
        </div>
      )}

      <style>{`@keyframes aichat-bounce{0%,80%,100%{transform:translateY(0);opacity:.4}40%{transform:translateY(-4px);opacity:1}}`}</style>
    </>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      style={{
        width: 7, height: 7, borderRadius: '50%', background: '#94a3b8',
        display: 'inline-block', animation: `aichat-bounce 1s ${delay}s infinite ease-in-out`,
      }}
    />
  );
}
