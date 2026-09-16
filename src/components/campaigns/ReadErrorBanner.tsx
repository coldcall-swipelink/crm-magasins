'use client';
// src/components/campaigns/ReadErrorBanner.tsx
//
// Le bandeau qu'affiche un écran dont la lecture a échoué.
//
// Il existe parce qu'une liste vide et une liste qui n'a pas pu être lue se
// ressemblent trop : afficher « aucun lead » sur une requête tombée revient à
// annoncer une perte de données qui n'a pas eu lieu.
//
// Quand la panne est un schéma en retard sur le code déployé, le bandeau porte
// AUSSI le bouton qui la répare. Dire à quelqu'un de coller une URL dans sa
// barre d'adresse, c'est lui laisser une corvée qu'on sait faire à sa place.

import { useState } from 'react';
import { toast } from '@/components/ui/Toast';
import { T, btnXs } from './ui';

export default function ReadErrorBanner({ message, schemaLag, onRetry }: {
  message: string;
  /** La base est en retard : le bouton de rattrapage a un sens. */
  schemaLag?: boolean;
  onRetry: () => void;
}) {
  const [repairing, setRepairing] = useState(false);

  const repair = async () => {
    setRepairing(true);
    try {
      const res = await fetch('/api/campaigns/schema-repair', { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        toast(data?.errors?.[0]?.error || 'Rattrapage impossible', 'error');
        return;
      }
      toast(`Base rattrapée (${data.applied} instruction(s))`);
      onRetry();
    } catch (err) {
      toast(`Rattrapage impossible : ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setRepairing(false);
    }
  };

  return (
    <div style={{
      background: 'rgba(248,113,113,.10)', border: '1px solid rgba(248,113,113,.42)',
      borderRadius: 10, padding: '12px 15px', marginBottom: 14,
      fontSize: 12.5, color: '#fca5a5', lineHeight: 1.6,
    }}>
      <div style={{ fontWeight: 700, marginBottom: 3 }}>La liste n&apos;a pas pu être lue</div>
      {message}
      <div style={{ marginTop: 8, display: 'flex', gap: 7, alignItems: 'center' }}>
        {schemaLag && (
          <button style={{ ...btnXs, opacity: repairing ? 0.6 : 1 }} disabled={repairing} onClick={repair}>
            {repairing ? 'Rattrapage…' : 'Rattraper la base maintenant'}
          </button>
        )}
        <button style={btnXs} onClick={onRetry}>Réessayer</button>
        {schemaLag && (
          <span style={{ fontSize: 11, color: T.textFaint }}>
            Aucune donnée n&apos;est touchée : uniquement la création de ce qui manque.
          </span>
        )}
      </div>
    </div>
  );
}
