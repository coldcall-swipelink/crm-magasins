// src/app/api/dashboard/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  const [
    totalDeals, totalStores, newDeals, updatedDeals, movedToCall,
    activeOffers, disappearedOffers,
    actionsDueToday, actionsOverdue, dealsWithNoAction,
    lastBatch, brands, importHistory,
  ] = await Promise.all([
    prisma.deal.count(),
    prisma.store.count(),
    prisma.deal.count({ where: { isNewFromLastImport: true } }),
    prisma.deal.count({ where: { hasNewOfferFromLastImport: true, isNewFromLastImport: false } }),
    prisma.deal.count({ where: { movedToCallAt: { not: null }, isNewFromLastImport: false } }),
    prisma.jobOffer.count({ where: { status: 'active' } }),
    prisma.jobOffer.count({ where: { status: 'disappeared' } }),
    prisma.action.count({ where: { status: 'todo', dueDate: { gte: startOfDay, lt: endOfDay } } }),
    prisma.action.count({ where: { status: 'todo', dueDate: { lt: startOfDay } } }),
    prisma.deal.count({ where: { actions: { none: { status: 'todo' } } } }),
    prisma.importBatch.findFirst({ orderBy: { importedAt: 'desc' } }),
    prisma.brand.findMany({
      include: { stores: { include: { deal: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.importBatch.findMany({
      orderBy: { importedAt: 'asc' },
      take: 8,
      select: { importedAt: true, createdDeals: true, newOffers: true, movedToCall: true },
    }),
  ]);

  const topBrands = brands
    .map(b => ({
      name:  b.name,
      color: b.color,
      count: b.stores.filter(s => s.deal).length,
    }))
    .filter(b => b.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  return NextResponse.json({
    totalDeals, totalStores,
    newDealsLastImport:     newDeals,
    updatedLastImport:      updatedDeals,
    movedToCallLastImport:  movedToCall,
    activeOffers, disappearedOffers,
    actionsDueToday, actionsOverdue, dealsWithNoAction,
    topBrands,
    lastImportDate:     lastBatch?.importedAt?.toISOString() ?? null,
    lastImportFileName: lastBatch?.fileName ?? null,
    importHistory: importHistory.map(b => ({
      date:       b.importedAt.toISOString().slice(0, 10),
      created:    b.createdDeals,
      newOffers:  b.newOffers,
      movedToCall: b.movedToCall,
    })),
  });
}
