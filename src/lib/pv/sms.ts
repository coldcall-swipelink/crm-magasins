// src/lib/pv/sms.ts
//
// SMS de rappel, via Twilio.
//
// Appel direct à l'API REST, sans le SDK : un POST en formulaire et deux
// en-têtes. Ajouter une dépendance de 3 Mo pour cela n'aurait pas de sens, et
// le module reste lisible de bout en bout.
//
// Non configuré (variables absentes) → la fonction le dit et ne lève pas : le
// rappel e-mail, lui, part quand même. Un SMS manquant ne doit pas faire
// échouer un rappel.

const TWILIO_BASE = 'https://api.twilio.com/2010-04-01';

export function isTwilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      (process.env.TWILIO_FROM || process.env.TWILIO_MESSAGING_SERVICE_SID),
  );
}

/**
 * Numéro français au format international attendu par Twilio (E.164).
 * « 06 12 34 56 78 » → « +33612345678 ». Renvoie une chaîne vide si le numéro
 * n'est pas exploitable — mieux vaut ne pas envoyer que d'envoyer à côté.
 */
export function toE164(phone: string): string {
  const brut = (phone || '').replace(/[\s.\-()]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(brut)) return brut;
  if (/^0[1-9]\d{8}$/.test(brut)) return `+33${brut.slice(1)}`;
  if (/^33[1-9]\d{8}$/.test(brut)) return `+${brut}`;
  return '';
}

export type SmsResult = { ok: boolean; sid?: string; skipped?: string; error?: string };

/** Envoie un SMS. Ne lève jamais. */
export async function sendSms(to: string, body: string): Promise<SmsResult> {
  if (!isTwilioConfigured()) return { ok: false, skipped: 'twilio_non_configure' };
  const destinataire = toE164(to);
  if (!destinataire) return { ok: false, skipped: 'numero_inexploitable' };

  const sid = process.env.TWILIO_ACCOUNT_SID as string;
  const token = process.env.TWILIO_AUTH_TOKEN as string;

  const params = new URLSearchParams({ To: destinataire, Body: body });
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
    params.set('MessagingServiceSid', process.env.TWILIO_MESSAGING_SERVICE_SID);
  } else {
    params.set('From', process.env.TWILIO_FROM as string);
  }

  try {
    const res = await fetch(`${TWILIO_BASE}/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, error: `Twilio ${res.status} : ${await res.text()}` };
    const data = (await res.json()) as { sid?: string };
    return { ok: true, sid: data.sid };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
