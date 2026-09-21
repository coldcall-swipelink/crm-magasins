// src/lib/pv/templates.ts
//
// Lecture des deux modèles HTML du pilote : la page du parcours et le mail.
//
// Ils vivent tels quels dans src/pv-assets/ — fichiers HTML complets, pas des
// composants React. C'est délibéré : ce sont des documents autonomes, relus et
// retouchés par des yeux humains (rendu Outlook, dégradés, logo), et les
// découper en JSX les rendrait impossibles à ouvrir dans un navigateur ou à
// tester dans Litmus.
//
// Ils sont lus depuis le disque à la première demande, puis gardés en mémoire :
// une fonction serverless les relit donc au plus une fois par instance.
// next.config.mjs les inclut explicitement dans la trace de déploiement
// (outputFileTracingIncludes), sans quoi Vercel ne les embarquerait pas.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const cache = new Map<string, string>();

function readAsset(fichier: string): string {
  const cached = cache.get(fichier);
  if (cached) return cached;
  const contenu = readFileSync(join(process.cwd(), 'src', 'pv-assets', fichier), 'utf8');
  cache.set(fichier, contenu);
  return contenu;
}

/** Page du parcours « 2 CV de bouchers » (écrans glissants + réservation). */
export function parcoursTemplate(): string {
  return readAsset('parcours-boucher.html');
}

/** Mail d'invitation envoyé au directeur du magasin. */
export function mailTemplate(): string {
  return readAsset('mail-boucher.html');
}

/** Échappement HTML de tout ce qui vient de la base (nom de magasin, ville…). */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Remplace les {{variables}} d'un modèle.
 *
 * Les valeurs sont échappées : un magasin nommé « Leclerc "Le Pré" » ne doit pas
 * pouvoir casser le HTML du mail. Les variables non fournies sont laissées
 * telles quelles — une accolade oubliée se voit tout de suite à la relecture,
 * alors qu'un trou silencieux passe inaperçu.
 */
export function fillTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (brut, nom: string) => {
    const cle = nom.trim();
    const valeur = variables[cle];
    return valeur === undefined ? brut : escapeHtml(valeur);
  });
}

/**
 * Balise Google (gtag.js) posée sur CHAQUE page publique du pilote — le
 * parcours, la page « lien expiré » et la page de désinscription — pour suivre
 * le trafic dans Google Analytics. L'identifiant se change sans redéployer
 * (PV_GA_MEASUREMENT_ID) ; vide, aucune balise n'est émise.
 *
 * Le fichier src/pv-assets/parcours-boucher.html porte un repère
 * <!-- gtag --> que le serveur remplace : ouvert tel quel dans un navigateur
 * (mode démo), il n'envoie donc rien à Google.
 */
export function googleTagHtml(): string {
  const id = (process.env.PV_GA_MEASUREMENT_ID ?? 'G-W1Y0W8LEQK').trim();
  if (!/^[A-Z0-9-]+$/i.test(id)) return '';
  return `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', '${id}');
</script>`;
}

/** Pose la balise Google à la place du repère <!-- gtag --> d'un modèle. */
export function withGoogleTag(html: string): string {
  return html.split('<!-- gtag -->').join(googleTagHtml());
}

/** Retire le bloc délimité par <!-- nom:start --> … <!-- nom:end -->. */
export function removeBlock(html: string, nom: string): string {
  const motif = new RegExp(`<!--\\s*${nom}:start\\s*-->[\\s\\S]*?<!--\\s*${nom}:end\\s*-->`, 'g');
  return html.replace(motif, '');
}
