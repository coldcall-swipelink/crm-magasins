'use client';

// Secours ultime : capture les erreurs survenant dans le layout racine
// lui-même (au-dessus de src/app/error.tsx). Doit rendre ses propres
// balises <html>/<body> car il remplace le layout racine.
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Erreur applicative (global) :', error);
  }, [error]);

  return (
    <html lang="fr">
      <body style={{ margin: 0 }}>
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
              L&apos;application n&apos;arrive pas à joindre la base de données.
              C&apos;est souvent temporaire : relancez la base Supabase si elle
              était en pause, puis réessayez. Aucune donnée n&apos;est perdue.
            </p>
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
            {error?.digest && (
              <p style={{ fontSize: 11, color: '#94a3b8', margin: '18px 0 0' }}>
                Code d&apos;erreur : {error.digest}
              </p>
            )}
          </div>
        </div>
      </body>
    </html>
  );
}
