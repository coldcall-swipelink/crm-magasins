// src/app/api/campaigns/leads/[id]/notes/route.ts
//
//   POST /api/campaigns/leads/<id>/notes  { body, userName }
//
// Ajoute une note à un lead. La note apparaît dans sa fiche ET dans sa frise
// d'activité, pour qu'on retrouve d'un coup d'œil ce qui s'est dit.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const lead = await prisma.lead.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!lead) return NextResponse.json({ error: 'Lead introuvable' }, { status: 404 });

  const body = await req.json().catch(() => null);
  const text = String(body?.body || '').trim();
  if (!text) return NextResponse.json({ error: 'Note vide' }, { status: 400 });

  const userName = body?.userName ? String(body.userName).trim() : null;

  const note = await prisma.leadNote.create({
    data: { leadId: params.id, body: text, userName },
  });

  await prisma.leadEvent.create({
    data: {
      leadId: params.id,
      type: 'note_added',
      // Extrait dans la frise : la note entière se lit dans l'onglet Notes.
      label: text.length > 120 ? `${text.slice(0, 117)}…` : text,
      userName,
    },
  });

  return NextResponse.json({ note }, { status: 201 });
}
