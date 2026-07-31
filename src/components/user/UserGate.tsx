'use client';
import { useState } from 'react';
import { useCurrentUser } from '@/lib/currentUser';

// Écran de connexion : tant qu'aucune identité n'est enregistrée dans le
// navigateur, on bloque l'app avec une authentification par email + mot de
// passe (identifiants fixés au préalable en base, par utilisateur).
//
// Bypass de test : si NEXT_PUBLIC_BYPASS_USER_GATE === 'true' (à activer
// uniquement en preview/test, jamais en prod), l'écran est sauté et l'app
// s'ouvre directement. L'identité reste « non connectée » (null) — les actions
// liées à un utilisateur restent donc anonymes le temps des tests.
const BYPASS_GATE = process.env.NEXT_PUBLIC_BYPASS_USER_GATE === 'true';

export default function UserGate({ children }: { children: React.ReactNode }) {
  const { user, ready, login } = useCurrentUser();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const canSubmit = email.trim() !== '' && password !== '';

  const submit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError('');
    try {
      await login(email.trim(), password);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Bypass de test : on ouvre l'app sans demander d'identifiants.
  if (BYPASS_GATE) return <>{children}</>;

  // Avant la lecture du localStorage, on ne montre rien (pas de flash d'écran).
  if (!ready) return null;

  if (!user) {
    const inputStyle: React.CSSProperties = {
      width: '100%', padding: '10px 12px', borderRadius: 9, border: '1px solid #e2e8f0',
      background: '#f8fafc', fontSize: 14, outline: 'none', marginBottom: 12, boxSizing: 'border-box',
    };
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ width: 380, maxWidth: '100%', background: '#fff', borderRadius: 16, padding: 28, boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
          <div style={{ width: 44, height: 44, background: '#4f46e5', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, marginBottom: 16 }}>🔐</div>
          <div style={{ fontSize: 19, fontWeight: 700, marginBottom: 6 }}>Connexion au CRM</div>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 18 }}>
            Identifiez-vous avec votre email et votre mot de passe. Votre session sera mémorisée sur cet ordinateur.
          </div>

          <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 5 }}>Email</label>
          <input
            autoFocus
            type="email"
            autoComplete="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
            placeholder="Ex : prenom@swipelink.fr"
            style={inputStyle}
          />

          <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 5 }}>Mot de passe</label>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
            placeholder="••••••••"
            style={inputStyle}
          />

          {error && <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 10 }}>{error}</div>}
          <button
            onClick={submit}
            disabled={loading || !canSubmit}
            style={{ width: '100%', padding: '11px', borderRadius: 9, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 600, fontSize: 14, cursor: loading || !canSubmit ? 'not-allowed' : 'pointer', opacity: loading || !canSubmit ? .6 : 1 }}
          >
            {loading ? 'Connexion…' : 'Se connecter'}
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
