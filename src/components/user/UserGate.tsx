'use client';
import { useState } from 'react';
import { useCurrentUser } from '@/lib/currentUser';

// Écran de première connexion : tant qu'aucune identité n'est enregistrée
// dans le navigateur, on bloque l'app avec une saisie libre du nom.
//
// Bypass de test : si NEXT_PUBLIC_BYPASS_USER_GATE === 'true' (à activer
// uniquement en preview/test, jamais en prod), la modale est sautée et l'app
// s'ouvre directement. L'identité reste « non connectée » (null) — les actions
// liées à un utilisateur restent donc anonymes le temps des tests.
const BYPASS_GATE = process.env.NEXT_PUBLIC_BYPASS_USER_GATE === 'true';

export default function UserGate({ children }: { children: React.ReactNode }) {
  const { user, ready, login } = useCurrentUser();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Accès direct sans s'identifier : même effet que le bypass par variable
  // d'environnement, mais déclenché côté client (utile pour tester/consulter
  // l'app quand on ne peut pas définir NEXT_PUBLIC_BYPASS_USER_GATE).
  // L'identité reste « non connectée » (null) — les actions restent anonymes.
  const [skipped, setSkipped] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError('');
    try {
      await login(name);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Bypass de test : on ouvre l'app sans demander d'identité.
  if (BYPASS_GATE || skipped) return <>{children}</>;

  // Avant la lecture du localStorage, on ne montre rien (pas de flash de modale).
  if (!ready) return null;

  if (!user) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ width: 380, maxWidth: '100%', background: '#fff', borderRadius: 16, padding: 28, boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
          <div style={{ width: 44, height: 44, background: '#4f46e5', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, marginBottom: 16 }}>👋</div>
          <div style={{ fontSize: 19, fontWeight: 700, marginBottom: 6 }}>Bienvenue sur le CRM</div>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 18 }}>
            Indiquez votre nom pour vous identifier. Il sera mémorisé sur cet ordinateur pour vos prochaines connexions.
          </div>
          <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 5 }}>Votre nom</label>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
            placeholder="Ex : Bilal Yacouti"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 9, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: 14, outline: 'none', marginBottom: 12, boxSizing: 'border-box' }}
          />
          {error && <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 10 }}>{error}</div>}
          <button
            onClick={submit}
            disabled={loading || !name.trim()}
            style={{ width: '100%', padding: '11px', borderRadius: 9, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 600, fontSize: 14, cursor: loading || !name.trim() ? 'not-allowed' : 'pointer', opacity: loading || !name.trim() ? .6 : 1 }}
          >
            {loading ? 'Connexion…' : 'Continuer'}
          </button>
          <button
            onClick={() => setSkipped(true)}
            disabled={loading}
            style={{ width: '100%', marginTop: 10, padding: '6px', background: 'none', border: 'none', color: '#94a3b8', fontSize: 12.5, cursor: loading ? 'not-allowed' : 'pointer', textDecoration: 'underline' }}
          >
            Accéder sans m'identifier
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
