// src/lib/pv/pitch.ts
//
// « Pourquoi c'est gratuit ? » — le contexte commercial affiché dans le volet
// gauche de la page du parcours (rdv.swipelink.fr/boucher), adapté à l'enseigne.
//
// La page est un site web, pas un mail : elle n'est pas soumise aux filtres
// anti-spam, on peut donc y écrire « gratuit » sans détour. Le mail, lui, ne
// doit contenir NI « gratuit » NI « offert » — ces deux mots l'envoyaient en
// courrier indésirable. « 0 € » et « aucune facturation » passent, et disent la
// même chose : c'est la variante `texteMail`, utilisée par le paragraphe « On y
// gagne quoi, nous ? » du mail (cf. src/lib/pv/mail.ts). Elle est aussi PLUS
// COURTE : le mail se lit en quelques secondes, la page a la place d'expliquer.
//
// Le message change selon l'enseigne parce que la RAISON de la gratuité change :
//
//   Intermarché  — nous travaillons déjà avec plus de 45 magasins et visons le
//                  référencement au Groupement des Mousquetaires ;
//   E.Leclerc    — nous SOMMES référencés au GALEC ;
//   Super U / Hyper U — même démarche qu'Intermarché, la cible étant la
//                  Coopérative U ;
//   autres       — pitch générique, qui s'appuie sur les deux premiers.
//
// Ce que nous faisons ne change pas, quelle que soit l'enseigne : on chasse des
// profils selon les critères du directeur, on les présente en visio, on les
// donne, et il en fait ce qu'il veut.
//
// Les nombres de magasins sont modifiables par variable d'environnement, sans
// redéployer : PV_PITCH_INTERMARCHE_COUNT, PV_PITCH_LECLERC_COUNT, PV_PITCH_U_COUNT.

import { brandSlug } from '@/lib/pv/brands';
import { formatPhoneFr, phoneHref, pvConsultant, pvConsultantPhone } from '@/lib/pv/config';

export interface PvPitch {
  /** Slug d'enseigne qui a choisi le texte (« intermarche », « leclerc », « u », « »). */
  enseigne: string;
  /** Nom de l'enseigne tel qu'il est écrit dans le texte (« Intermarché »). */
  enseigneNom: string;
  /** Étiquette du bloc (« 100 % gratuit »). */
  badge: string;
  /** Titre du bloc. */
  titre: string;
  /** Paragraphes d'explication, dans l'ordre. Le premier est mis en avant. */
  texte: string[];
  /**
   * Les mêmes idées pour le MAIL, en plus court : sans « gratuit » ni
   * « offert », avec « 0 € » et « aucune facturation » à la place. Deux
   * entrées, toujours — une phrase chacune.
   */
  texteMail: [string, string];
  /**
   * Ligne d'appel propre au MAIL, après « On y gagne quoi, nous ? » : « Ça
   * paraît trop beau pour être vrai ? Appelez Hugo au… ». Vide = pas de ligne.
   * Le numéro lui-même est dans `contact`.
   */
  appelMail: string;
  /** Ce que nous faisons concrètement, en trois points. */
  etapes: string[];
  /** « Si vous avez des questions, appelez Hugo au 07 69 71 98 45 ». */
  contact: PvPitchContact;
}

export interface PvPitchContact {
  prenom: string;
  /** Numéro tel qu'affiché (« 07 69 71 98 45 »). */
  telephone: string;
  /** Lien cliquable (« tel:+33769719845 »). */
  href: string;
}

function contact(): PvPitchContact {
  const digits = pvConsultantPhone();
  return { prenom: pvConsultant().prenom, telephone: formatPhoneFr(digits), href: phoneHref(digits) };
}

/** Nombre de magasins annoncé pour une enseigne, ou null quand rien n'est configuré. */
function configuredCount(name: string, fallback: number | null): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * « travaille aujourd'hui avec plus de 45 Intermarché » ou, sans nombre
 * configuré, « accompagne déjà des Intermarché ».
 */
function partenariat(count: number | null, pluriel: string): string {
  return count != null
    ? `travaille aujourd'hui avec plus de ${count} ${pluriel}`
    : `accompagne déjà des ${pluriel}`;
}

const BADGE = '100 % gratuit';
const TITRE = "Pourquoi c'est gratuit\u202F?";

const ETAPES = [
  'Nous chassons des bouchers selon vos critères',
  'Nous vous les présentons en visio, en 15 minutes',
  'Nous vous donnons leurs profils : vous en faites ce que vous voulez',
];

/** Le pitch adapté à l'enseigne du magasin. */
export function pitchFor(brandName: string | null | undefined): PvPitch {
  const slug = brandSlug(brandName);

  if (slug === 'intermarche') {
    const n = configuredCount('PV_PITCH_INTERMARCHE_COUNT', 45);
    return {
      enseigne: slug,
      enseigneNom: 'Intermarché',
      badge: BADGE,
      titre: TITRE,
      texte: [
        `Swipelink ${partenariat(n, 'Intermarché')}.`,
        "Notre objectif : obtenir le référencement au Groupement des Mousquetaires. Pour y arriver, nous faisons tester notre service gratuitement à tous les magasins.",
      ],
      texteMail: [
        `Swipelink ${partenariat(n, 'Intermarché')}.`,
        'Nous visons le référencement au Groupement des Mousquetaires : chaque magasin peut donc tester, pour 0 €.',
      ],
      etapes: ETAPES,
      contact: contact(),
      appelMail: '',
    };
  }

  if (slug === 'leclerc') {
    const n = configuredCount('PV_PITCH_LECLERC_COUNT', 40);
    const c = contact();
    return {
      enseigne: slug,
      enseigneNom: 'E.Leclerc',
      badge: BADGE,
      titre: TITRE,
      texte: [
        `Swipelink est déjà référencé au GALEC, et plus de ${n} centres Leclerc utilisent cette solution pour leurs recrutements les plus difficiles.`,
        'Pour faire connaître la solution, nous avons décidé de la faire tester à tous les centres Leclerc de France, sans aucune facturation ni engagement.',
      ],
      texteMail: [
        `Swipelink est référencé au GALEC : plus de ${n} centres Leclerc l'utilisent déjà.`,
        'Nous le faisons tester à tous les centres Leclerc, sans facturation ni engagement.',
      ],
      etapes: ETAPES,
      contact: c,
      appelMail: `Trop beau pour être vrai\u202F? Appelez ${c.prenom} au ${c.telephone}.`,
    };
  }

  if (slug === 'u') {
    const n = configuredCount('PV_PITCH_U_COUNT', null);
    return {
      enseigne: slug,
      enseigneNom: 'U',
      badge: BADGE,
      titre: TITRE,
      texte: [
        `Swipelink ${partenariat(n, 'Super U et Hyper U')}.`,
        'Notre objectif : obtenir le référencement à la Coopérative U. Pour y arriver, nous faisons tester notre service gratuitement à tous les magasins.',
      ],
      texteMail: [
        `Swipelink ${partenariat(n, 'Super U et Hyper U')}.`,
        'Nous visons le référencement à la Coopérative U : chaque magasin peut donc tester, pour 0 €.',
      ],
      etapes: ETAPES,
      contact: contact(),
      appelMail: '',
    };
  }

  const nItm = configuredCount('PV_PITCH_INTERMARCHE_COUNT', 45);
  return {
    enseigne: slug,
    enseigneNom: (brandName || '').trim(),
    badge: BADGE,
    titre: TITRE,
    texte: [
      `Swipelink ${partenariat(nItm, 'Intermarché')} et est référencé au GALEC (E.Leclerc).`,
      'Nous vous proposons de tester notre service gratuitement, sans engagement.',
    ],
    texteMail: [
      `Swipelink ${partenariat(nItm, 'Intermarché')} et est référencé au GALEC (E.Leclerc).`,
      'Testez notre service pour 0 €, sans engagement.',
    ],
    etapes: ETAPES,
    contact: contact(),
    appelMail: '',
  };
}

function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const CHECK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5 10 17 19 7.5"/></svg>';
const PHONE_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6.2 6.2l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>';

/**
 * Le bloc HTML du pitch, tel que la page l'affiche.
 *
 * Rendu côté serveur (src/app/boucher/route.ts) pour que le directeur lise le
 * contexte dès le premier écran, sans attendre /api/pv/context. La page sait
 * produire exactement le même bloc en JavaScript (renderPitch) — c'est ce
 * qu'elle fait en mode démo. Les deux rendus doivent rester identiques.
 */
export function pitchHtml(pitch: PvPitch): string {
  return (
    `<div class="pitch" id="pitch" data-ready="1" data-enseigne="${escape(pitch.enseigne)}">` +
    pitchInnerHtml(pitch) +
    `</div>`
  );
}

/** L'intérieur du bloc — le même que renderPitch() dans la page. */
export function pitchInnerHtml(pitch: PvPitch): string {
  const paragraphes = pitch.texte.map(t => `<p>${escape(t)}</p>`).join('');
  const etapes = pitch.etapes
    .map(e => `<li><span class="pitch-ck">${CHECK_SVG}</span><span>${escape(e)}</span></li>`)
    .join('');
  return (
    `<button class="pitch-h" id="pitchToggle" type="button" aria-expanded="false" aria-controls="pitchBody">` +
    `<span class="pitch-tag">${escape(pitch.badge)}</span>` +
    `<span class="pitch-t">${escape(pitch.titre)}</span>` +
    `<span class="pitch-chev" aria-hidden="true"></span>` +
    `</button>` +
    `<div class="pitch-b" id="pitchBody">${paragraphes}<ul class="pitch-l">${etapes}</ul></div>` +
    `<a class="pitch-call" id="pitchCall" href="${escape(pitch.contact.href)}">${PHONE_SVG}<span>Si vous avez des questions, appelez ` +
    `<b>${escape(pitch.contact.prenom)}</b> au <b class="pitch-num">${escape(pitch.contact.telephone)}</b></span></a>`
  );
}
