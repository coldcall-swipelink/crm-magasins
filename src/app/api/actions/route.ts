// src/app/api/actions/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const dealId = searchParams.get('dealId');
    const status = searchParams.get('status');

    const where: Record<string, unknown> = {};
    if (dealId) where.dealId = dealId;
    if (status) where.status = status;

    const actions = await prisma.action.findMany({
      where,
      include: { deal: { include: { store: { select: { name: true, city: true } } } } },
      orderBy: { dueDate: 'asc' },
    });
    return NextResponse.json(actions);
  } catch (err) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { dealId, title, type, dueDate, dueTime, priority, note } = body;

    if (!dealId || !title || !dueDate) {
      return NextResponse.json({ error: 'dealId, title et dueDate sont requis' }, { status: 400 });
    }

    // Traiter la date comme local (YYYY-MM-DD)
    const dateStr = dueDate.includes('T') ? dueDate.split('T')[0] : dueDate;
    const [year, month, day] = dateStr.split('-').map(Number);
    const dateObj = new Date(year, month - 1, day);

    const action = await prisma.action.create({
      data: {
        dealId,
        title,
        type:     type     || 'Appeler',
        dueDate:  dateObj,
        dueTime:  dueTime  || '',
        priority: priority || 'normale',
        note:     note     || '',
        status:   'todo',
      },
    });
    return NextResponse.json(action, { status: 201 });
  } catch (err) {
    console.error('[POST /api/actions]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
