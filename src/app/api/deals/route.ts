// src/app/api/deals/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const columnId   = searchParams.get('columnId');
    const search     = searchParams.get('search');
    const brandId    = searchParams.get('brandId');
    const priority   = searchParams.get('priority');
    const newOnly    = searchParams.get('newOnly') === 'true';
    const newOffer   = searchParams.get('newOffer') === 'true';
    const noAction   = searchParams.get('noAction') === 'true';

    const where: Record<string, unknown> = {};
    if (columnId)  where.columnId = columnId;
    if (priority)  where.priority = priority;
    if (newOnly)   where.isNewFromLastImport = true;
    if (newOffer)  where.hasNewOfferFromLastImport = true;

    if (search) {
      where.store = {
        OR: [
          { name:            { contains: search, mode: 'insensitive' } },
          { city:            { contains: search, mode: 'insensitive' } },
          { department:      { contains: search, mode: 'insensitive' } },
          { brand: { name:   { contains: search, mode: 'insensitive' } } },
        ],
      };
    }
    if (brandId) {
      where.store = { ...(where.store as object || {}), brandId };
    }

    if (noAction) {
      where.actions = { none: { status: 'todo' } };
    }

    const deals = await prisma.deal.findMany({
      where,
      include: {
        store: { include: { brand: true } },
        column: true,
        jobOffers: { orderBy: { firstSeenAt: 'desc' } },
        actions: {
          where: { status: 'todo' },
          orderBy: { dueDate: 'asc' },
          take: 1,
        },
        _count: { select: { jobOffers: true, actions: true } },
      },
      orderBy: [{ columnId: 'asc' }, { position: 'asc' }],
    });

    return NextResponse.json(deals);
  } catch (err) {
    console.error('[GET /api/deals]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
