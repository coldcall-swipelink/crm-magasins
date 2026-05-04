// src/app/api/deals/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateBrandColor, normalizeText } from '@/lib/utils';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const columnId = searchParams.get('columnId');
    const search   = searchParams.get('search');
    const brandId  = searchParams.get('brandId');
    const priority = searchParams.get('priority');
    const newOnly  = searchParams.get('newOnly') === 'true';
    const newOffer = searchParams.get('newOffer') === 'true';
    const noAction = searchParams.get('noAction') === 'true';

    const where: Record<string, unknown> = {};
    if (columnId)  where.columnId = columnId;
    if (priority)  where.priority = priority;
    if (newOnly)   where.isNewFromLastImport = true;
    if (newOffer)  where.hasNewOfferFromLastImport = true;

    if (search) {
      where.store = { OR: [
        { name:  { contains: search, mode: 'insensitive' } },
        { city:  { contains: search, mode: 'insensitive' } },
        { brand: { name: { contains: search, mode: 'insensitive' } } },
      ]};
    }
    if (brandId) {
      where.store = { ...(where.store as object || {}), brandId };
    }
    if (noAction) { where.actions = { none: { status: 'todo' } }; }

    const deals = await prisma.deal.findMany({
      where,
      include: {
        store: { include: { brand: true } },
        column: true,
        jobOffers: { orderBy: { firstSeenAt: 'desc' } },
        actions: { where: { status: 'todo' }, orderBy: { dueDate: 'asc' }, take: 1 },
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { brandId, storeName, city, department, address, siret,
            columnId, priority, directeur, contactCalling, email } = body;

    if (!storeName?.trim()) {
      return NextResponse.json({ error: 'Le nom du magasin est requis' }, { status: 400 });
    }

    // Trouver la colonne par défaut si non spécifiée
    let targetColumnId = columnId;
    if (!targetColumnId) {
      const defaultCol = await prisma.pipelineColumn.findFirst({ where: { position: 0 } });
      targetColumnId = defaultCol?.id;
      if (!targetColumnId) return NextResponse.json({ error: 'Aucune colonne trouvée' }, { status: 400 });
    }

    // Construire la clé de déduplication
    const deduplicationKey = `manual:${normalizeText(storeName)}:${normalizeText(city || '')}:${Date.now()}`;

    // Créer le magasin
    const store = await prisma.store.create({
      data: {
        brandId: brandId || null,
        name: storeName.trim(),
        normalizedName: normalizeText(storeName),
        city: city || '',
        department: department || '',
        address: address || '',
        siret: siret || '',
        deduplicationKey,
      },
    });

    // Compter les affaires dans la colonne pour le positionnement
    const positionInCol = await prisma.deal.count({ where: { columnId: targetColumnId } });

    // Créer l'affaire avec les nouveaux champs
    const deal = await prisma.deal.create({
      data: {
        storeId: store.id,
        columnId: targetColumnId,
        priority: priority || 'normale',
        position: positionInCol,
        isNewFromLastImport: false,
        hasNewOfferFromLastImport: false,
        isPresentInLastImport: true,
        directeur: directeur || '',
        contactCalling: contactCalling || '',
        dealEmail: email || '',
      },
      include: {
        store: { include: { brand: true } },
        column: true,
      },
    });

    return NextResponse.json(deal, { status: 201 });
  } catch (err) {
    console.error('[POST /api/deals]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
