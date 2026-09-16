'use client';
// src/components/campaigns/LeadFormModal.tsx
//
// Saisie d'un lead à la main — depuis l'écran Leads, ou directement depuis une
// campagne (l'inscription suit alors la création).
//
// Les champs personnalisés sont au même niveau que les champs standard : ce
// sont eux qui donnent les variables de personnalisation, et l'écran montre le
// nom de variable obtenu ({{effectif}}) pendant la saisie — sinon on ne sait
// pas quoi écrire dans l'email.

import { useState } from 'react';
import { toast } from '@/components/ui/Toast';
import { LEAD_FIELDS, customFieldSlug } from '@/lib/campaigns/leadFields';
import { btnDef, btnPri, btnXs, card, inp, label, modal, overlay } from './ui';

/** Champs standard proposés, dans l'ordre de saisie naturel. */
const FIELDS = LEAD_FIELDS.filter(field => field.key !== 'email');

type CustomRow = { name: string; value: string };

export default function LeadFormModal({ userName, campaignId, onClose, onSaved }: {
  userName?: string;
  /** Renseigné : le lead est inscrit dans cette campagne après création. */
  campaignId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({ email: '' });
  const [custom, setCustom] = useState<CustomRow[]>([]);
  const [busy, setBusy] = useState(false);

  const set = (key: string, value: string) => setValues(current => ({ ...current, [key]: value }));

  const save = async (andAnother: boolean) => {
    if (!values.email?.trim()) { toast('L\'email est obligatoire', 'error'); return; }
    setBusy(true);
    try {
      const customFields: Record<string, string> = {};
      for (const row of custom) {
        const name = customFieldSlug(row.name);
        if (row.name.trim() && row.value.trim()) customFields[name] = row.value.trim();
      }

      const res = await fetch('/api/campaigns/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, customFields, userName, campaignId }),
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error || 'Enregistrement refusé', 'error'); return; }

      if (data.enrollError) toast(`Lead créé, mais non inscrit : ${data.enrollError}`, 'error');
      else if (data.existed) toast('Lead déjà connu — inscrit dans la campagne');
      else if (campaignId) toast('Lead créé et inscrit dans la campagne');
      else toast('Lead créé');

      onSaved();
      // « Enregistrer et ajouter un autre » : on garde la fenêtre ouverte et on
      // vide les champs, pour une saisie à la chaîne.
      if (andAnother) { setValues({ email: '' }); setCustom([]); }
      else onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={overlay}
      onClick={onClose}>
      <div onClick={event => event.stopPropagation()} style={{ ...modal, width: 'min(620px, 100%)', maxHeight: '88vh', overflow: 'auto' }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
          {campaignId ? 'Ajouter un lead à la campagne' : 'Nouveau lead'}
        </div>
        <div style={{ fontSize: 12, color: '#9aa1b4', marginBottom: 16 }}>
          Seul l&apos;email est obligatoire. Tout le reste sert à personnaliser les emails.
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={label}>Email *</label>
          <input style={inp} autoFocus value={values.email || ''} placeholder="jean.dupont@enseigne.fr"
            onChange={event => set('email', event.target.value)} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          {FIELDS.map(field => (
            <div key={field.key}>
              <label style={label}>{field.label}</label>
              <input style={inp} value={values[field.key] || ''}
                onChange={event => set(field.key, event.target.value)} />
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
          <label style={{ ...label, marginBottom: 0 }}>Champs personnalisés</label>
          <button style={{ ...btnXs, marginLeft: 'auto' }}
            onClick={() => setCustom(rows => [...rows, { name: '', value: '' }])}>
            + Ajouter un champ
          </button>
        </div>
        <div style={{ fontSize: 11, color: '#6b7283', marginBottom: 8 }}>
          Chaque champ devient une variable utilisable dans les emails.
        </div>

        {custom.map((row, index) => (
          <div key={index} style={{ display: 'flex', gap: 7, alignItems: 'center', marginBottom: 6 }}>
            <input style={{ ...inp, flex: 1 }} placeholder="Nom (ex : Effectif)" value={row.name}
              onChange={event => setCustom(rows => rows.map((r, i) => i === index ? { ...r, name: event.target.value } : r))} />
            <input style={{ ...inp, flex: 1 }} placeholder="Valeur" value={row.value}
              onChange={event => setCustom(rows => rows.map((r, i) => i === index ? { ...r, value: event.target.value } : r))} />
            <code style={{ fontSize: 11, color: '#3b71f5', width: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {row.name.trim() ? `{{${customFieldSlug(row.name)}}}` : ''}
            </code>
            <button style={btnXs} onClick={() => setCustom(rows => rows.filter((_, i) => i !== index))}>✕</button>
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button style={{ ...btnPri, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => save(false)}>
            {busy ? 'Enregistrement…' : campaignId ? 'Créer et inscrire' : 'Créer le lead'}
          </button>
          <button style={btnDef} disabled={busy} onClick={() => save(true)}>Enregistrer et ajouter un autre</button>
          <button style={{ ...btnDef, marginLeft: 'auto' }} onClick={onClose}>Annuler</button>
        </div>
      </div>
    </div>
  );
}
