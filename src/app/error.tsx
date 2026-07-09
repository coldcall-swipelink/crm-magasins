'use client';

// Frontière d'erreur globale de l'app (App Router). S'affiche à la place de
// l'écran blanc « Application error: a server-side exception has occurred »
// dès qu'un Server Component plante — typiquement quand la base de données
// est injoignable (projet Supabase en pause, DATABASE_URL invalide, etc.).
import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Visible dans les logs (console navigateur + logs Vercel côté serveur).
    console.error('Erreur applicative :', error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: '#f8fafc',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#0f172a',
      }}
    >
      <div
        style={{
          maxWidth: 560,
          width: '100%',
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          padding: '28px 32px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 40, marginBottom: 8 }}>🔌</div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 10px' }}>
          Le service est momentanément indisponible
        </h1>
        <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.6, margin: '0 0 18px' }}>
          L&apos;application n&apos;arrive pas à joindre la base de données. C&apos;est
          souvent temporaire : si la base Supabase était en pause (inactivité), il
          suffit de la relancer depuis le dashboard Supabase, puis de réessayer ici.
          Aucune donnée n&apos;est perdue.
        </p>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => reset()}
            style={{
              padding: '9px 18px',
              borderRadius: 8,
              border: 'none',
              background: '#4f46e5',
              color: '#fff',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Réessayer
          </button>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '9px 18px',
              borderRadius: 8,
              border: '1px solid #e2e8f0',
              background: '#f1f5f9',
              color: '#334155',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Recharger la page
          </button>
        </div>

        {error?.digest && (
          <p style={{ fontSize: 11, color: '#94a3b8', margin: '18px 0 0' }}>
            Code d&apos;erreur : {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
