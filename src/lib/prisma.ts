// src/lib/prisma.ts
import { PrismaClient } from '@prisma/client';
import { createMockEngine } from './mock/engine';

// ── Mode démo / preview ───────────────────────────────────────────────────────
// En mode démo, l'app tourne sur un jeu de données fictif en mémoire : AUCUNE
// connexion à la base (Neon, Supabase…) n'est tentée. Le mode démo s'active :
//   • si USE_MOCK_DATA="true" (forçage explicite), OU
//   • automatiquement sur les déploiements de PREVIEW Vercel (VERCEL_ENV=preview)
//     ou quand aucune DATABASE_URL n'est définie.
// Il peut être désactivé explicitement avec USE_MOCK_DATA="false" (utile si une
// vraie base de preview est branchée). La production (VERCEL_ENV=production)
// utilise toujours la vraie base, sauf USE_MOCK_DATA="true".
const mockFlag = process.env.USE_MOCK_DATA;
export const MOCK_MODE =
  mockFlag === 'true' ||
  (mockFlag !== 'false' &&
    (!process.env.DATABASE_URL || process.env.VERCEL_ENV === 'preview'));

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
