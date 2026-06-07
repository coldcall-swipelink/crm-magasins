// src/lib/prisma.ts
import { PrismaClient } from '@prisma/client';
import { createMockEngine } from './mock/engine';

// ── Mode démo / preview ───────────────────────────────────────────────────────
// Quand USE_MOCK_DATA="true" (ou qu'aucune DATABASE_URL n'est définie), l'app
// tourne sur un jeu de données fictif en mémoire : AUCUNE connexion à la base
// (Neon, Supabase…) n'est tentée. Idéal pour les déploiements de preview dont la
// base n'existe pas. En production, laissez USE_MOCK_DATA non défini.
export const MOCK_MODE =
  process.env.USE_MOCK_DATA === 'true' || !process.env.DATABASE_URL;

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function makeClient(): PrismaClient {
  if (MOCK_MODE) {
    console.warn('[prisma] MODE DÉMO actif — données fictives en mémoire, aucune base de données utilisée.');
    return createMockEngine() as unknown as PrismaClient;
  }
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
}

export const prisma = globalForPrisma.prisma || makeClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
