// src/app/api/users/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { USE_MOCK_DATA, mockUsers } from '@/lib/mockData';

// Données live : ne jamais pré-générer au build (évite tout accès DB à la compilation).
export const dynamic = 'force-dynamic';

// Palette de couleurs distinctes pour les avatars utilisateurs.
const USER_COLORS = [
  '#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6',
  '#ef4444', '#8b5cf6', '#14b8a6', '#f97316', '#0ea5e9',
];

function pickColor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  return USER_COLORS[Math.abs(h) % USER_COLORS.length];
}

export async function GET() {
  if (USE_MOCK_DATA) return NextResponse.json(mockUsers);
  try {
    const users = await prisma.user.findMany({ orderBy: { name: 'asc' } });
    return NextResponse.json(users);
  } catch (err) {
    console.error('[GET /api/users]', err);
    return NextResponse.json({ error: (err as Error).message || 'Erreur serveur' }, { status: 500 });
  }
}

// Connexion par saisie libre du nom : retrouve l'utilisateur existant
// (insensible à la casse) ou le crée. Idempotent.
export async function POST(req: NextRequest) {
  try {
    const { name, color } = await req.json();
    const trimmed = (name || '').trim();
    if (!trimmed) return NextResponse.json({ error: 'name requis' }, { status: 400 });

    const existing = await prisma.user.findFirst({
      where: { name: { equals: trimmed, mode: 'insensitive' } },
    });
    if (existing) return NextResponse.json(existing);

    const user = await prisma.user.create({
      data: { name: trimmed, color: color || pickColor(trimmed) },
    });
    return NextResponse.json(user, { status: 201 });
  } catch (err) {
    console.error('[POST /api/users]', err);
    return NextResponse.json({ error: (err as Error).message || 'Erreur serveur' }, { status: 500 });
  }
}
