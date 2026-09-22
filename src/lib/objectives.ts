// src/lib/objectives.ts — Suivi des objectifs fixés dans Smartlink Brain.
//
// Les objectifs (appels, démos bookées, closings) se FIXENT dans Smartlink
// Brain ; chaque commercial les SUIT ici, dans l'outil qu'il a ouvert toute la
// journée. Ce module porte les deux moitiés serveur de ce suivi :
//
//   1. le calendrier des périodes — les mêmes clés que Brain (« 2026-W39 »,
//      « 2026-09 », « 2026-Q3 », « 2026 »), recalculées localement pour que la
//      page marche même quand Brain ne répond pas (le réalisé s'affiche, les
//      objectifs manquent, et la page le dit) ;
//   2. la lecture des cibles chez Brain (GET /api/goals/export, jeton
//      BRAIN_GOALS_TOKEN), avec un petit cache mémoire — une cible ne bouge
//      pas à la minute, et chaque ouverture de page n'a pas à payer un
//      aller-retour.
//
// Les clés de période et le repli des noms reprennent les règles de Brain à
// l'identique : c'est la clé qui identifie une cible en base, et le nom qui la
// rattache à un utilisateur du CRM. Divergence = objectifs « disparus ».

// ─── Types ──────────────────────────────────────────────────────────────────

export type ObjectivePeriodType = 'week' | 'month' | 'quarter' | 'year';

export interface ObjectivePeriod {
  type: ObjectivePeriodType;
  /** Clé de stockage Brain : 2026-W39 · 2026-09 · 2026-Q3 · 2026. */
  key: string;
  /** Intitulé court (« Semaine 39 », « Septembre 2026 », « T3 2026 », « 2026 »). */
  label: string;
  from: string; // YYYY-MM-DD, borne incluse
  to: string;   // YYYY-MM-DD, borne incluse
  /** Part de la période écoulée (semaine = jours OUVRÉS, comme Brain). */
  elapsed: number;
  current: boolean;
  past?: boolean;
}

/** Une cible telle que Brain l'exporte (person vide = objectif d'équipe). */
export interface BrainTarget {
  metric: 'calls' | 'demos' | 'closings';
  periodKey: string;
  person: string;
  target: number;
}

export interface BrainExport {
  periods: ObjectivePeriod[];
  targets: BrainTarget[];
  team: string[];
  today: string;
  storage: boolean;
  computedAt: string;
}

export type BrainFetchResult =
  | { available: true; data: BrainExport }
  | { available: false; reason: string };

// ─── Fuseau et calendrier — les mêmes règles que Brain (src/lib/weeks.ts) ───

/** Fuseau de référence des périodes, identique au TZ_REPORT de Brain. */
export const OBJECTIVES_TZ = 'Europe/Paris';

const MS_DAY = 86_400_000;
const pad2 = (v: number) => String(v).padStart(2, '0');

/** Date calendaire (YYYY-MM-DD) d'un instant, dans le fuseau donné. */
export function tzDate(value: Date, timeZone: string = OBJECTIVES_TZ): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}

const ymdToUtc = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

function addDays(ymd: string, days: number): string {
  return new Date(ymdToUtc(ymd).getTime() + days * MS_DAY).toISOString().slice(0, 10);
}

/** Lundi de la semaine contenant la date donnée. */
function mondayOf(ymd: string): string {
  const d = ymdToUtc(ymd);
  const diff = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - diff * MS_DAY).toISOString().slice(0, 10);
}

/** Numéro de semaine ISO 8601 d'un lundi donné (année ISO, pas civile). */
function isoWeekNumber(mondayYmd: string): { year: number; week: number } {
  const d = ymdToUtc(mondayYmd);
  const thursday = new Date(d.getTime() + 3 * MS_DAY);
  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.ceil(((thursday.getTime() - jan1) / MS_DAY + 1) / 7);
  return { year, week };
}

const lastDayOfMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

interface Bounds { start: string; end: string }

function calendarBounds(type: ObjectivePeriodType, ymd: string): Bounds {
  if (type === 'week') {
    const start = mondayOf(ymd);
    return { start, end: addDays(start, 6) };
  }
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  const ymdOf = (y: number, m: number, d: number) =>
    `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;
  if (type === 'month') {
    return { start: ymdOf(year, month, 1), end: ymdOf(year, month, lastDayOfMonth(year, month)) };
  }
  if (type === 'quarter') {
    const first = Math.floor((month - 1) / 3) * 3 + 1;
    return { start: ymdOf(year, first, 1), end: ymdOf(year, first + 2, lastDayOfMonth(year, first + 2)) };
  }
  return { start: ymdOf(year, 1, 1), end: ymdOf(year, 12, 31) };
}

/** Clé stable d'une période — la même forme que Brain, qui identifie la cible. */
function calendarKey(type: ObjectivePeriodType, ymd: string): string {
  if (type === 'week') {
    const iso = isoWeekNumber(mondayOf(ymd));
    return `${iso.year}-W${pad2(iso.week)}`;
  }
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  if (type === 'month') return `${year}-${pad2(month)}`;
  if (type === 'quarter') return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
  return String(year);
}

/** Part écoulée en jours calendaires (mois, trimestre, année). */
function elapsedFraction(bounds: Bounds, todayYmd: string): number {
  if (todayYmd < bounds.start) return 0;
  if (todayYmd > bounds.end) return 1;
  const total = (ymdToUtc(bounds.end).getTime() - ymdToUtc(bounds.start).getTime()) / MS_DAY + 1;
  const done = (ymdToUtc(todayYmd).getTime() - ymdToUtc(bounds.start).getTime()) / MS_DAY + 1;
  return done / total;
}

/**
 * Part de la SEMAINE DE TRAVAIL écoulée (lundi -> vendredi) : le repère de la
 * semaine, comme dans Brain — compté en jours calendaires, vendredi soir
 * afficherait « 71 % écoulé » et promettrait deux jours qui n'existent pas.
 */
function workweekElapsedFraction(bounds: Bounds, todayYmd: string): number {
  if (todayYmd < bounds.start) return 0;
  if (todayYmd > bounds.end) return 1;
  const done = (ymdToUtc(todayYmd).getTime() - ymdToUtc(bounds.start).getTime()) / MS_DAY + 1;
  return Math.min(5, done) / 5;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function labelOf(type: ObjectivePeriodType, key: string, bounds: Bounds): string {
  if (type === 'week') return `Semaine ${key.slice(-2)}`;
  if (type === 'month') {
    return capitalize(new Date(`${bounds.start}T00:00:00Z`).toLocaleDateString('fr-FR', {
      month: 'long', year: 'numeric', timeZone: 'UTC',
    }));
  }
  if (type === 'quarter') return `T${key.slice(-1)} ${key.slice(0, 4)}`;
  return key;
}

/**
 * Historique proposé, par horizon — les mêmes bornes que Brain : au-delà on ne
 * pilote plus, on archive. Pas de période à venir ici : on ne SUIT pas une
 * période qui n'a pas commencé (la fixer, c'est l'affaire de Brain).
 */
const PAST_PERIODS: Record<ObjectivePeriodType, number> = { week: 8, month: 6, quarter: 4, year: 2 };

const PERIOD_TYPES: ObjectivePeriodType[] = ['week', 'month', 'quarter', 'year'];

/** Les périodes proposées au suivi : l'en-cours de chaque horizon, puis l'historique. */
export function objectivePeriods(todayYmd: string): ObjectivePeriod[] {
  const out: ObjectivePeriod[] = [];
  const periodOf = (type: ObjectivePeriodType, ymd: string, extra: Partial<ObjectivePeriod>) => {
    const bounds = calendarBounds(type, ymd);
    const key = calendarKey(type, ymd);
    out.push({
      type,
      key,
      label: labelOf(type, key, bounds),
      from: bounds.start,
      to: bounds.end,
      elapsed: type === 'week'
        ? workweekElapsedFraction(bounds, todayYmd)
        : elapsedFraction(bounds, todayYmd),
      current: false,
      ...extra,
    });
  };
  for (const type of PERIOD_TYPES) {
    periodOf(type, todayYmd, { current: true });
    let start = calendarBounds(type, todayYmd).start;
    for (let i = 0; i < PAST_PERIODS[type]; i++) {
      start = calendarBounds(type, addDays(start, -1)).start;
      periodOf(type, start, { past: true });
    }
  }
  return out;
}

// ─── Rapprochement des noms — la même règle que Brain (src/lib/crm.ts) ──────

/**
 * Repli d'un nom de personne : minuscules, sans accents, espaces réduits.
 * C'est par NOM que Brain rattache une cible à quelqu'un (brain_goals.person),
 * et « Luca  Ayme » saisi avec deux espaces doit retrouver ses objectifs.
 */
export function foldPersonName(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').trim();
}

// ─── Lecture des cibles chez Brain ──────────────────────────────────────────

/**
 * Une cible ne bouge pas à la minute : cinq minutes de cache évitent de payer
 * Brain à chaque ouverture de page, sans qu'une saisie fraîche attende
 * longtemps. Le cache ne retient que les succès : un échec se retente tout de
 * suite, pour que la page ne dise pas cinq minutes durant « Brain injoignable »
 * après un simple raté réseau.
 */
const BRAIN_CACHE_MS = 5 * 60_000;
let brainCache: { at: number; data: BrainExport } | null = null;

export async function fetchBrainGoals(): Promise<BrainFetchResult> {
  const base = process.env.BRAIN_GOALS_URL;
  const token = process.env.BRAIN_GOALS_TOKEN;
  if (!base || !token) {
    return { available: false, reason: 'Liaison Smartlink Brain non configurée (BRAIN_GOALS_URL / BRAIN_GOALS_TOKEN)' };
  }
  if (brainCache && Date.now() - brainCache.at < BRAIN_CACHE_MS) {
    return { available: true, data: brainCache.data };
  }
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/api/goals/export`, {
      headers: { Authorization: `Bearer ${token}` },
      // Next mettrait la réponse en cache de build : on veut la nôtre, datée.
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      let msg = `Brain a répondu ${res.status}`;
      try { msg = (await res.json()).error || msg; } catch { /* corps non JSON */ }
      return { available: false, reason: msg };
    }
    const data = (await res.json()) as BrainExport;
    brainCache = { at: Date.now(), data };
    return { available: true, data };
  } catch (e) {
    return { available: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * La cible d'une personne pour une métrique et une période, ou null si rien
 * n'est fixé. Le rapprochement se fait sur le nom replié : c'est la règle de
 * Brain, et c'est elle qui décide si « bilal yacouti » retrouve ses objectifs.
 */
export function targetFor(
  data: BrainExport,
  metric: BrainTarget['metric'],
  periodKey: string,
  personName: string,
): number | null {
  const fold = foldPersonName(personName);
  const hit = data.targets.find(
    t => t.metric === metric && t.periodKey === periodKey && foldPersonName(t.person) === fold && t.person !== '',
  );
  return hit ? hit.target : null;
}
