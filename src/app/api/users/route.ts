// src/app/api/users/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { USE_MOCK_DATA, mockUsers } from '@/lib/mockData';
import { hashPassword } from '@/lib/password';

// Données live : ne jamais pré-générer au build (évite tout accès DB à la compilation).
export const dynamic = 'force-dynamic';

// Sélection publique : ne JAMAIS exposer passwordHash au client.
const PUBLIC_SELECT = {
  id: true, name: true, email: true, color: true, createdAt: true, updatedAt: true,
} as const;

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
    const users = await prisma.user.findMany({ orderBy: { name: 'asc' }, select: PUBLIC_SELECT });
    return NextResponse.json(users);
  } catch (err) {
    console.error('[GET /api/users]', err);
    return NextResponse.json({ error: (err as Error).message || 'Erreur serveur' }, { status: 500 });
  }
}

// Création / mise à jour d'un utilisateur (provisioning des identifiants).
// La connexion, elle, passe par /api/auth/login. Idempotent : retrouve un
// compte existant par email (si fourni) sinon par nom, et met à jour les
// champs fournis. Le mot de passe éventuel est haché avant stockage et le
// passwordHash n'est jamais renvoyé.
export async function POST(req: NextRequest) {
  try {
    const { name, email, password, color } = await req.json();
    const trimmedName = (name || '').trim();
    const mail = (email || '').trim().toLowerCase();
    if (!trimmedName) return NextResponse.json({ error: 'name requis' }, { status: 400 });

    // Retrouve un compte existant : d'abord par email, puis en secours par nom.
    // Le secours par nom est essentiel pour rattacher email + mot de passe à un
    // utilisateur historique créé sans email (ancienne connexion par nom), au
    // lieu d'échouer sur la contrainte d'unicité du nom en tentant un doublon.
    let existing = mail
      ? await prisma.user.findFirst({ where: { email: { equals: mail, mode: 'insensitive' } } })
      : null;
    if (!existing) {
      existing = await prisma.user.findFirst({ where: { name: { equals: trimmedName, mode: 'insensitive' } } });
    }

    const data: {
      name?: string; email?: string; color?: string; passwordHash?: string;
    } = {};
    if (trimmedName) data.name = trimmedName;
    if (mail) data.email = mail;
    if (color) data.color = color;
    if (typeof password === 'string' && password !== '') data.passwordHash = hashPassword(password);

    if (existing) {
      const updated = await prisma.user.update({
        where: { id: existing.id }, data, select: PUBLIC_SELECT,
      });
      return NextResponse.json(updated);
    }

    const user = await prisma.user.create({
      data: {
        name: trimmedName,
        email: mail || undefined,
        color: color || pickColor(trimmedName),
        passwordHash: data.passwordHash,
      },
      select: PUBLIC_SELECT,
    });
    return NextResponse.json(user, { status: 201 });
  } catch (err) {
    console.error('[POST /api/users]', err);
    return NextResponse.json({ error: (err as Error).message || 'Erreur serveur' }, { status: 500 });
  }
}
