// src/app/api/auth/login/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyPassword } from '@/lib/password';
import { USE_MOCK_DATA, mockUsers, MOCK_DEMO_PASSWORD } from '@/lib/mockData';

// Authentification : jamais pré-générée au build (accès DB au runtime).
export const dynamic = 'force-dynamic';

// Connexion par email + mot de passe (fixé au préalable en base).
// Renvoie l'identité publique (id, name, color, email) — JAMAIS le hash.
export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();
    const mail = (email || '').trim().toLowerCase();
    const pwd = typeof password === 'string' ? password : '';
    if (!mail || !pwd) {
      return NextResponse.json({ error: 'Email et mot de passe requis' }, { status: 400 });
    }

    // Mode données fictives (preview) : mot de passe commun de démonstration.
    if (USE_MOCK_DATA) {
      const mock = mockUsers.find(u => u.email?.toLowerCase() === mail);
      if (!mock || pwd !== MOCK_DEMO_PASSWORD) {
        return NextResponse.json({ error: 'Email ou mot de passe incorrect' }, { status: 401 });
      }
      return NextResponse.json({ id: mock.id, name: mock.name, color: mock.color, email: mock.email });
    }

    const user = await prisma.user.findFirst({
      where: { email: { equals: mail, mode: 'insensitive' } },
    });

    // Message générique volontaire : ne révèle pas si l'email existe. Un compte
    // sans passwordHash (créé historiquement sans identifiants) ne peut pas se
    // connecter.
    if (!user || !user.passwordHash || !verifyPassword(pwd, user.passwordHash)) {
      return NextResponse.json({ error: 'Email ou mot de passe incorrect' }, { status: 401 });
    }

    return NextResponse.json({ id: user.id, name: user.name, color: user.color, email: user.email });
  } catch (err) {
    console.error('[POST /api/auth/login]', err);
    return NextResponse.json({ error: (err as Error).message || 'Erreur serveur' }, { status: 500 });
  }
}
