// src/lib/primes.ts — Cagnottes de primes, lues chez Smartlink Brain.
//
// Les primes (règles, montants, versements) se calculent dans Smartlink Brain
// et n'existent que là ; le CRM les AFFICHE au commercial primé, à côté du
// suivi de ses objectifs — la cagnotte se regarde pendant qu'on appelle, pas
// en ouvrant un autre outil. Ce module lit l'export serveur-à-serveur
// GET /api/primes/export de Brain, sur la MÊME liaison que les objectifs
// (BRAIN_GOALS_URL + BRAIN_GOALS_TOKEN) : une seule configuration, pas deux.
//
// Le rapprochement d'un utilisateur du CRM avec un Sale primé se fait par nom
// replié (foldPersonName, la règle de Brain) : « Luca  Ayme » saisi avec deux
// espaces doit retrouver sa cagnotte.

// ─── Types (la forme exacte de /api/primes/export) ──────────────────────────

export type PrimeStoreType = 'hyper' | 'super' | 'proxy';

/** La part d'un Sale primé sur la période : ce que l'onglet Primes de Brain projette. */
export interface BrainPrimeSalesPerson {
  person: string;
  /** Démos faites payées, et leur répartition par format de magasin. */
  demos: number;
  byType: Record<PrimeStoreType, number>;
  /** Démos dont l'affaire est devenue cliente (bonus). */
  clients: number;
  /** La cagnotte : ce que la période lui a déjà rapporté, en euros. */
  amount: number;
  /** Démos calées, pas encore faites — et ce qu'elles rapporteraient. */
  pending: number;
  pendingAmount: number;
  /** Démos non honorées, non rattrapées — le manque à gagner. */
  noShows: number;
  noShowLost: number;
}

export interface BrainPrimePeriod {
  /** Clé stable de la période de cagnotte (« 2026-09-01 »). */
  key: string;
  from: string;
  to: string;
  /** « du 1er septembre au 31 décembre 2026 ». */
  label: string;
  /** « Sept. → déc. 2026 », « T1 2027 ». */
  short: string;
  /** « avec la paie de janvier 2027 ». */
  payLabel: string;
  status: 'upcoming' | 'running' | 'ended';
}

export interface BrainPrimeTeam {
  /** Le premier palier de MRR est atteint : la prime d'équipe est ouverte. */
  reached: boolean;
  /** La prime en jeu (du plus haut palier atteint, sinon du premier). */
  total: number;
  perPerson: number;
  mrr: number;
  target: number;
  /** MRR ÷ cible, borné à 1. */
  ratio: number;
  gapMrr: number;
  gapCredits: number;
  payLabel: string;
  /** Une fois versée : ce qui a été enregistré. */
  frozen: { paidAt: string; reached: boolean; perPerson: number } | null;
}

export interface BrainPrimeHistoryPeriod {
  key: string;
  label: string;
  short: string;
  paidAt: string;
  /** Le versé de la période, agrégé par personne (toutes primes confondues). */
  shares: { person: string; amount: number }[];
}

export interface BrainPrimesExport {
  period: BrainPrimePeriod;
  sales: BrainPrimeSalesPerson[];
  team: BrainPrimeTeam;
  history: BrainPrimeHistoryPeriod[];
  today: string;
  storage: boolean;
  computedAt: string;
}

export type BrainPrimesResult =
  | { available: true; data: BrainPrimesExport }
  | { available: false; reason: string };

// ─── Lecture chez Brain ─────────────────────────────────────────────────────

/**
 * Une cagnotte bouge au rythme des démos, pas à la minute : cinq minutes de
 * cache (comme les objectifs) évitent de payer Brain à chaque ouverture de
 * page. Le cache ne retient que les succès : un échec se retente tout de
 * suite, pour que la pastille ne reste pas effacée cinq minutes après un
 * simple raté réseau.
 */
const BRAIN_CACHE_MS = 5 * 60_000;
let brainCache: { at: number; data: BrainPrimesExport } | null = null;

export async function fetchBrainPrimes(): Promise<BrainPrimesResult> {
  const base = process.env.BRAIN_GOALS_URL;
  const token = process.env.BRAIN_GOALS_TOKEN;
  if (!base || !token) {
    return { available: false, reason: 'Liaison Smartlink Brain non configurée (BRAIN_GOALS_URL / BRAIN_GOALS_TOKEN)' };
  }
  if (brainCache && Date.now() - brainCache.at < BRAIN_CACHE_MS) {
    return { available: true, data: brainCache.data };
  }
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/api/primes/export`, {
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
    const data = (await res.json()) as BrainPrimesExport;
    brainCache = { at: Date.now(), data };
    return { available: true, data };
  } catch (e) {
    return { available: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
