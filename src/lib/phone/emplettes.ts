// src/lib/phone/emplettes.ts
// Source ANNUAIRE : emplettes.net, répertoire des supermarchés, hypermarchés et
// supérettes français, organisé par département, ville et enseigne.
//
// C'est la source la mieux adaptée au périmètre du CRM : elle ne référence que
// des commerces alimentaires, exactement la cible, avec adresse et numéro. Et
// surtout, ses URL sont prévisibles :
//
//   /59/reseau/e-leclerc            → tous les E.Leclerc du Nord
//   /44/nantes/reseau/e-leclerc     → les E.Leclerc de Nantes
//   /44/nantes/                     → tous les magasins de Nantes
//
// LE FILTRAGE EST FAIT PAR L'URL, ce qui change tout par rapport aux autres
// sources : on n'interroge que des pages déjà restreintes à la bonne enseigne
// dans la bonne ville. Le rapprochement restant à faire est donc minime, et la
// vérification (enseigne, ville, code postal) reste assurée par la notation
// commune (cf. lookup.ts) — l'URL oriente, elle ne dispense pas de contrôler.
//
// EXTRACTION VOLONTAIREMENT TOLÉRANTE : plutôt que de dépendre de la mise en
// page du site, qui peut changer sans préavis, on relève les numéros français
// présents dans le texte avec le contexte qui les entoure (nom du magasin,
// adresse). Une refonte du site casse un analyseur de balises ; elle ne casse
// pas une lecture de texte.
//
// Usage courtois : requêtes sérialisées, pause entre chacune, et pas plus de
// trois pages consultées par magasin.

import { normalizeText } from '@/lib/utils';
import { normalizePhone } from './normalize';

const BASE = 'https://emplettes.net';
/** Pause entre deux pages : on consulte un site tiers, sans le marteler. */
const MIN_DELAY_MS = 800;

/** Un magasin relevé dans l'annuaire. */
export interface DirectoryEntry {
  phone: string;
  /** Texte entourant le numéro : nom du magasin, adresse, code postal. */
  context: string;
  url: string;
}

export interface DirectoryOutcome {
  results: DirectoryEntry[];
  ok: boolean;
  status: number;
  error: string;
  elapsedMs: number;
  /** Pages réellement consultées, dans l'ordre. */
  urls: string[];
  /** Taille du texte extrait, pour distinguer « page vide » de « page absente ». */
  textLength: number;
  /** Extrait du texte, pour ajuster l'extraction sans deviner. */
  sample: string;
}

/** Numéros français dans du texte libre — validation stricte ensuite. */
const PHONE_IN_TEXT = /(?:\+33|0033)?[\s.-]?0?[1-9](?:[\s.-]?\d{2}){4}/g;

// ─── Sérialisation ───────────────────────────────────────────────────────────
let chain: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = lastCallAt + MIN_DELAY_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
    return task();
  });
  chain = run.catch(() => undefined);
  return run;
}

/**
 * Transforme un libellé en segment d'URL : « E.Leclerc » → « e-leclerc »,
 * « Vaison-la-Romaine » → « vaison-la-romaine ».
 */
export function slugify(value: string): string {
  return normalizeText(value).replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Pages à consulter, de la plus précise à la plus large. On s'arrête à la
 * première qui donne des numéros : inutile de charger la page du département
 * quand celle de la ville a répondu.
 */
export function buildDirectoryUrls(
  brand: string,
  city: string,
  department: string,
): string[] {
  const brandSlug = slugify(brand);
  const citySlug = slugify(city);
  const dept = department.toLowerCase();
  const urls: string[] = [];

  if (dept && citySlug && brandSlug) urls.push(`${BASE}/${dept}/${citySlug}/reseau/${brandSlug}`);
  if (dept && citySlug) urls.push(`${BASE}/${dept}/${citySlug}/`);
  if (dept && brandSlug) urls.push(`${BASE}/${dept}/reseau/${brandSlug}`);

  return urls;
}

/** Réduit une page HTML à son texte, en supprimant scripts, styles et balises. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Relève les numéros du texte avec leur contexte. La fenêtre retenue précède
 * largement le numéro : dans une fiche d'annuaire, le nom du magasin et son
 * adresse sont écrits AVANT le téléphone.
 */
function extractEntries(text: string, url: string): DirectoryEntry[] {
  const entries: DirectoryEntry[] = [];
  const seen = new Set<string>();

  // `matchAll` renverrait un itérateur que la cible de compilation du projet ne
  // sait pas parcourir : on avance donc à la main sur l'expression régulière.
  PHONE_IN_TEXT.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PHONE_IN_TEXT.exec(text)) !== null) {
    const normalized = normalizePhone(match[0]);
    if (!normalized) continue;
    if (seen.has(normalized.e164)) continue;

    const at = match.index;
    const context = text.slice(Math.max(0, at - 260), at + 40).trim();

    seen.add(normalized.e164);
    entries.push({ phone: normalized.display, context, url });
  }
  return entries;
}

/**
 * Cherche les magasins d'une enseigne dans l'annuaire. Ne lève jamais : une
 * source indisponible est un fait à rapporter, pas une exception à propager.
 */
export async function searchDirectory(
  brand: string,
  city: string,
  department: string,
): Promise<DirectoryOutcome> {
  const startedAt = Date.now();
  const urls = buildDirectoryUrls(brand, city, department);

  const outcome: DirectoryOutcome = {
    results: [], ok: false, status: 0, error: '',
    elapsedMs: 0, urls: [], textLength: 0, sample: '',
  };

  if (urls.length === 0) {
    outcome.error = 'Ville ou département manquant : aucune page d\'annuaire à consulter';
    return outcome;
  }

  for (const url of urls) {
    outcome.urls.push(url);

    const page = await enqueue(async () => {
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'crm-magasins/1.0 (recherche de numéros de magasins)',
            'Accept-Language': 'fr-FR,fr;q=0.9',
            Accept: 'text/html,application/xhtml+xml',
          },
          signal: AbortSignal.timeout(12000),
        });
        return { res, html: res.ok ? await res.text() : '' , error: '' };
      } catch (err) {
        return { res: null, html: '', error: err instanceof Error ? `${err.name}: ${err.message}` : 'Erreur réseau' };
      }
    });

    if (!page.res) { outcome.error = page.error; continue; }
    outcome.status = page.res.status;

    // 404 sur une page précise n'est pas une anomalie : l'enseigne n'a
    // simplement pas de magasin dans cette ville. On essaie la page suivante.
    if (!page.res.ok) {
      outcome.error = `HTTP ${page.res.status} sur ${url}`;
      continue;
    }

    const text = htmlToText(page.html);
    outcome.ok = true;
    outcome.error = '';
    outcome.textLength = text.length;
    if (!outcome.sample) outcome.sample = text.slice(0, 600);

    const entries = extractEntries(text, url);
    if (entries.length > 0) {
      outcome.results = entries;
      break;
    }
  }

  outcome.elapsedMs = Date.now() - startedAt;
  return outcome;
}
