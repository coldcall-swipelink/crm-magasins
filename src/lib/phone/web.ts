// src/lib/phone/web.ts
// Source « recherche web » : reproduit ce qu'on fait à la main — taper
// « numéro de téléphone <enseigne> <magasin> » dans Google et relever le numéro
// affiché sur la fiche de l'établissement.
//
// DEUX FOURNISSEURS, et le choix n'est pas anodin :
//
//   • SERPER (recommandé) — un service qui exécute la recherche Google et en
//     renvoie le résultat structuré, fiche d'établissement comprise. Demande une
//     clé, avec quelques milliers de recherches offertes à l'inscription. C'est
//     la seule voie réellement exploitable depuis un hébergeur.
//
//   • GOOGLE EN DIRECT (sans clé) — interroge google.com et extrait les numéros
//     du HTML. Fonctionne depuis un poste de travail, mais Google bloque les
//     adresses des hébergeurs : depuis un serveur, on reçoit le plus souvent une
//     page de consentement ou un CAPTCHA à la place des résultats. Conservé
//     parce qu'il ne coûte rien d'essayer et que l'échec est explicite, mais il
//     ne faut pas compter dessus en production.
//
// Le numéro relevé n'est jamais accepté sur parole : il repart dans la même
// notation que les autres sources (cf. lookup.ts), qui vérifie que l'enseigne
// et la localité concordent.

import { normalizePhone } from './normalize';

/** Un résultat de recherche porteur d'au moins un numéro de téléphone. */
export interface WebResult {
  /** Numéro tel qu'il apparaît dans la page (non normalisé). */
  phone: string;
  /** Titre du résultat ou de la fiche d'établissement. */
  title: string;
  /** Texte associé : adresse de la fiche, extrait du résultat… */
  snippet: string;
  url: string;
}

export interface WebSearchOutcome {
  results: WebResult[];
  ok: boolean;
  provider: WebProvider;
  status: number;
  error: string;
  elapsedMs: number;
  query: string;
}

export type WebProvider = 'serper' | 'google' | 'aucun';

/**
 * Numéros français repérés dans du texte libre. Volontairement permissif sur les
 * séparateurs (espace, point, tiret, insécable) : la validation stricte est
 * faite ensuite par `normalizePhone`.
 */
const PHONE_IN_TEXT = /(?:\+33|0033)?[\s. -]?0?[1-9](?:[\s. -]?\d{2}){4}/g;

/** Quel fournisseur est utilisable en l'état de la configuration ? */
export function webProvider(): WebProvider {
  if (process.env.SERPER_API_KEY?.trim()) return 'serper';
  // L'accès direct doit être demandé explicitement : il échoue presque toujours
  // depuis un hébergeur, autant ne pas le déclencher à l'insu de l'utilisateur.
  if (process.env.PHONE_WEB_DIRECT_GOOGLE === 'true') return 'google';
  return 'aucun';
}

export function isWebSearchConfigured(): boolean {
  return webProvider() !== 'aucun';
}

/**
 * Requête telle qu'on la taperait dans Google. Le préfixe « numéro de
 * téléphone » oriente Google vers la fiche de l'établissement plutôt que vers
 * le site institutionnel de l'enseigne.
 */
export function buildWebQuery(brand: string, storeName: string, city: string, postalCode: string): string {
  const parts = ['numéro de téléphone', brand];
  const seen = new Set([brand.toLowerCase().trim()]);
  for (const part of [storeName, postalCode, city]) {
    const value = (part || '').trim();
    if (value && !seen.has(value.toLowerCase())) { parts.push(value); seen.add(value.toLowerCase()); }
  }
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/** Relève les numéros d'un texte, dans l'ordre d'apparition, sans doublon. */
function extractPhones(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.match(PHONE_IN_TEXT) ?? []) {
    const normalized = normalizePhone(raw);
    if (!normalized || seen.has(normalized.e164)) continue;
    seen.add(normalized.e164);
    found.push(normalized.display);
  }
  return found;
}

// ─── Fournisseur 1 : Serper ──────────────────────────────────────────────────

interface SerperResponse {
  knowledgeGraph?: {
    title?: string;
    type?: string;
    phoneNumber?: string;
    address?: string;
    website?: string;
    descriptionLink?: string;
    attributes?: Record<string, string>;
  };
  organic?: Array<{ title?: string; snippet?: string; link?: string }>;
  places?: Array<{ title?: string; address?: string; phoneNumber?: string; cid?: string }>;
}

async function searchViaSerper(query: string, startedAt: number): Promise<WebSearchOutcome> {
  const base = { provider: 'serper' as const, elapsedMs: 0, query };
  const done = (patch: Partial<WebSearchOutcome>): WebSearchOutcome => ({
    results: [], ok: false, status: 0, error: '', ...base,
    elapsedMs: Date.now() - startedAt, ...patch,
  });

  let res: Response;
  try {
    res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': process.env.SERPER_API_KEY!.trim(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query, gl: 'fr', hl: 'fr', num: 10 }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return done({ error: err instanceof Error ? `${err.name}: ${err.message}` : 'Erreur réseau' });
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return done({ status: res.status, error: `HTTP ${res.status} ${body.slice(0, 200)}`.trim() });
  }

  const data = (await res.json().catch(() => ({}))) as SerperResponse;
  const results: WebResult[] = [];

  // 1. La fiche d'établissement — c'est exactement l'encadré consulté à la main,
  // et de loin la donnée la plus fiable de la page.
  const kg = data.knowledgeGraph;
  if (kg) {
    const phone = kg.phoneNumber
      || kg.attributes?.['Téléphone'] || kg.attributes?.['Phone'] || kg.attributes?.['Telephone'];
    if (phone) {
      results.push({
        phone,
        title: kg.title || '',
        snippet: [kg.address, ...Object.values(kg.attributes ?? {})].filter(Boolean).join(' '),
        url: kg.website || kg.descriptionLink || '',
      });
    }
  }

  // 2. Les établissements de la carte, quand Google en propose plusieurs.
  for (const place of data.places ?? []) {
    if (!place.phoneNumber) continue;
    results.push({
      phone: place.phoneNumber,
      title: place.title || '',
      snippet: place.address || '',
      url: place.cid ? `https://maps.google.com/?cid=${place.cid}` : '',
    });
  }

  // 3. À défaut, les numéros visibles dans les extraits des résultats.
  for (const item of data.organic ?? []) {
    const text = `${item.title ?? ''} ${item.snippet ?? ''}`;
    for (const phone of extractPhones(text)) {
      results.push({ phone, title: item.title || '', snippet: item.snippet || '', url: item.link || '' });
    }
  }

  return done({ results, ok: true, status: res.status });
}

// ─── Fournisseur 2 : Google en direct ────────────────────────────────────────

async function searchViaGoogle(query: string, startedAt: number): Promise<WebSearchOutcome> {
  const base = { provider: 'google' as const, query };
  const done = (patch: Partial<WebSearchOutcome>): WebSearchOutcome => ({
    results: [], ok: false, status: 0, error: '',
    ...base, elapsedMs: Date.now() - startedAt, ...patch,
  });

  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=fr&gl=fr&num=10`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
        'Accept-Language': 'fr-FR,fr;q=0.9',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return done({ error: err instanceof Error ? `${err.name}: ${err.message}` : 'Erreur réseau' });
  }

  if (!res.ok) {
    return done({
      status: res.status,
      error: res.status === 429
        ? 'Google a refusé la requête (trop de requêtes depuis ce serveur)'
        : `HTTP ${res.status}`,
    });
  }

  const html = await res.text();

  // Google sert aux serveurs une page de consentement ou de vérification à la
  // place des résultats. La détecter permet de dire pourquoi rien ne remonte,
  // au lieu de laisser croire qu'aucun numéro n'existe.
  if (/consent\.google\.com|Avant d.acc[eé]der|unusual traffic|captcha|recaptcha/i.test(html)) {
    return done({
      status: res.status,
      error: 'Google a renvoyé une page de consentement ou de vérification anti-robot '
        + 'au lieu des résultats — c\'est le comportement attendu depuis un hébergeur. '
        + 'Utilisez SERPER_API_KEY pour une recherche fiable.',
    });
  }

  // Le HTML de Google est illisible et change en permanence : on ne tente pas
  // de l'analyser, on se contente d'en relever les numéros français dans leur
  // ordre d'apparition — la fiche de l'établissement figure en tête de page.
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ');
  const results = extractPhones(text).map((phone) => ({
    phone, title: '', snippet: '', url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
  }));

  return done({ results, ok: true, status: res.status });
}

/**
 * Lance la recherche web avec le fournisseur configuré. Ne lève jamais : une
 * source indisponible est un fait à rapporter, pas une exception à propager.
 */
export async function searchPhoneOnWeb(query: string, force?: WebProvider): Promise<WebSearchOutcome> {
  const startedAt = Date.now();
  // `force` sert au diagnostic : essayer l'accès direct à Google sans rien
  // configurer, pour constater par soi-même ce que Google renvoie à un serveur.
  const provider = force && force !== 'aucun' ? force : webProvider();

  if (provider === 'serper' && !process.env.SERPER_API_KEY?.trim()) {
    return {
      results: [], ok: false, provider: 'serper', status: 0,
      error: 'SERPER_API_KEY n\'est pas renseignée', elapsedMs: 0, query,
    };
  }

  if (provider === 'serper') return searchViaSerper(query, startedAt);
  if (provider === 'google') return searchViaGoogle(query, startedAt);

  return {
    results: [], ok: false, provider: 'aucun', status: 0,
    error: 'Aucune recherche web configurée', elapsedMs: 0, query,
  };
}
