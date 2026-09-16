// src/lib/pv/ics.ts
//
// Invitation .ics envoyée après la réservation.
//
// Pourquoi un .ics alors que Google envoie déjà son invitation : parce que le
// destinataire est souvent sur Outlook, et qu'un rendez-vous qui n'atterrit pas
// dans SON agenda est un rendez-vous manqué. Le fichier porte le lien visio et
// le lien « Déplacer le rendez-vous », de sorte que tout se retrouve depuis
// l'entrée d'agenda, sans revenir au mail.

export interface IcsInput {
  uid: string;
  start: Date;
  end: Date;
  magasin: string;
  organizerEmail: string;
  organizerName: string;
  attendeeEmail: string;
  meetUrl: string;
  rescheduleUrl: string;
  /** Numéro de version : incrémenté à chaque déplacement pour que les
   *  messageries remplacent l'entrée au lieu d'en ajouter une seconde. */
  sequence?: number;
  /** REQUEST (invitation) ou CANCEL (annulation). */
  method?: 'REQUEST' | 'CANCEL';
}

/** Horodatage iCalendar en UTC : 20260924T090000Z. */
function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Échappement iCalendar (RFC 5545 §3.3.11). */
function esc(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Pliage des lignes à 75 octets, comme l'exige la norme. Outlook tronque sans
 * prévenir les lignes trop longues — et c'est justement la description, avec ses
 * deux URL, qui dépasse.
 */
function fold(line: string): string {
  const octets = Buffer.from(line, 'utf8');
  if (octets.length <= 75) return line;
  const morceaux: string[] = [];
  let debut = 0;
  while (debut < octets.length) {
    // 74 octets pour la première ligne, 73 pour les suivantes (l'espace de
    // continuation compte). On recule jusqu'à une frontière de caractère UTF-8
    // pour ne jamais couper un accent en deux.
    let taille = Math.min(debut === 0 ? 74 : 73, octets.length - debut);
    while (taille > 1 && (octets[debut + taille] & 0xc0) === 0x80) taille--;
    morceaux.push(octets.subarray(debut, debut + taille).toString('utf8'));
    debut += taille;
  }
  return morceaux.join('\r\n ');
}

/** Contenu du fichier .ics (texte, à joindre en `text/calendar`). */
export function buildDemoIcs(input: IcsInput): string {
  const method = input.method || 'REQUEST';
  const description = [
    'Démo Swipelink — présentation de vos 2 CV de bouchers (15 min).',
    input.meetUrl ? `Lien visio : ${input.meetUrl}` : '',
    `Déplacer le rendez-vous : ${input.rescheduleUrl}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const lignes = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Swipelink//Parcours boucher//FR',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${esc(input.uid)}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(input.start)}`,
    `DTEND:${stamp(input.end)}`,
    `SEQUENCE:${input.sequence ?? 0}`,
    `SUMMARY:${esc(`Démo Swipelink : vos 2 CV de bouchers — ${input.magasin}`)}`,
    `DESCRIPTION:${esc(description)}`,
    `LOCATION:${esc(input.meetUrl || 'Visioconférence')}`,
    input.meetUrl ? `URL:${esc(input.meetUrl)}` : '',
    `ORGANIZER;CN=${esc(input.organizerName)}:mailto:${input.organizerEmail}`,
    `ATTENDEE;CN=${esc(input.attendeeEmail)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${input.attendeeEmail}`,
    method === 'CANCEL' ? 'STATUS:CANCELLED' : 'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    // Rappel local, en plus de ceux que le CRM envoie par e-mail et SMS.
    'BEGIN:VALARM',
    'TRIGGER:-PT60M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Démo Swipelink dans 1 h',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);

  return lignes.map(fold).join('\r\n') + '\r\n';
}
