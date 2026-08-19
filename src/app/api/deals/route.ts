import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateBrandColor, normalizeText } from '@/lib/utils';
import { USE_MOCK_DATA, mockDeals } from '@/lib/mockData';
import { searchKeyIncludes } from '@/lib/searchText';
import { findStoreIdsMatchingSearch } from '@/lib/searchStores';

// Données dynamiques (lecture DB) : jamais de cache statique du Route Handler.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    if (USE_MOCK_DATA) {
      const pipelineId     = searchParams.get('pipelineId');
      const assignedUserId = searchParams.get('assignedUserId');
      const brandId        = searchParams.get('brandId');
      const search         = (searchParams.get('search') || '').trim();
      // Les sous-deals (absorbés) n'apparaissent pas dans le pipeline.
      let result = mockDeals.filter(d => !d.parentDealId);
      if (pipelineId)     result = result.filter(d => d.pipelineId === pipelineId);
      if (assignedUserId) result = result.filter(d => d.assignedUserId === assignedUserId);
      if (brandId)        result = result.filter(d => d.store.brand?.id === brandId);
      // Comparaison sur les clés normalisées : « saint loudeac » retrouve
      // « Saint-Loudéac », comme en base.
      if (search)         result = result.filter(d =>
        searchKeyIncludes(d.store.name, search) ||
        searchKeyIncludes(d.store.city, search) ||
        searchKeyIncludes(d.store.brand?.name, search));
      return NextResponse.json(result);
    }

    const columnId       = searchParams.get('columnId');
    const pipelineId     = searchParams.get('pipelineId');
    const search         = searchParams.get('search');
    const brandId        = searchParams.get('brandId');
    const collaboratorId = searchParams.get('collaboratorId');
    const assignedUserId = searchParams.get('assignedUserId');
    const priority       = searchParams.get('priority');
    const newOnly        = searchParams.get('newOnly') === 'true';
    const newOffer       = searchParams.get('newOffer') === 'true';
    const noAction       = searchParams.get('noAction') === 'true';

    const where: Record<string, unknown> = {};
    // Les sous-deals (absorbés par un autre deal) n'apparaissent pas dans le
    // pipeline : ils ne vivent que dans leur deal parent (et la recherche).
    where.parentDealId = null;
    if (columnId)       where.columnId = columnId;
    if (pipelineId)     where.pipelineId = pipelineId;
    if (priority)       where.priority = priority;
    if (newOnly)        where.isNewFromLastImport = true;
    if (newOffer)       where.hasNewOfferFromLastImport = true;
    if (collaboratorId) where.collaboratorId = collaboratorId;
    if (assignedUserId) where.assignedUserId = assignedUserId;

    if (search) {
      // Les magasins sont résolus sur les clés normalisées (accents, casse et
      // ponctuation ignorés) ; `null` = saisie inexploitable, on ne filtre pas.
      const storeIds = await findStoreIdsMatchingSearch(search);
      if (storeIds) where.storeId = { in: storeIds };
    }
    if (brandId) {
      where.store = { ...(where.store as object || {}), brandId };
    }
    if (noAction) { where.actions = { none: { status: 'todo' } }; }

    const deals = await prisma.deal.findMany({
      where,
      include: {
        // Seuls les champs affichés sur la carte du pipeline (et exportés en
        // CSV) sont remontés : le reste de la fiche magasin — adresse
        // normalisée, clé de déduplication, candidats téléphone (JSON), SIRET,
        // géocodage… — pesait un tiers de la réponse sans jamais être lu ici.
        store: {
          select: {
            id: true, brandId: true, name: true, city: true,
            department: true, postalCode: true,
            brand: true,
          },
        },
        column: true,
        collaborator: true,
        assignedUser: true,
        // La carte du pipeline n'affiche que les DEUX premiers intitulés
        // d'offres, puis « +N » d'après _count.jobOffers : inutile de
        // télécharger toutes les offres de toutes les affaires (c'était le
        // gros du poids de cette réponse). La fiche affaire, elle, charge la
        // liste complète via GET /api/deals/[id].
        jobOffers: {
          select: { id: true, title: true, jobTitle: true },
          orderBy: { firstSeenAt: 'desc' },
          take: 2,
        },
        actions: { where: { status: 'todo' }, orderBy: { dueDate: 'asc' }, take: 1 },
        // Sous-deals absorbés : on remonte leur valeur pour cumuler dans la
        // carte parente et afficher le nombre de magasins du groupe.
        childDeals: { select: { id: true, dealValue: true } },
        _count: { select: { jobOffers: true, actions: true, childDeals: true } },
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
            columnId, priority, directeur, contactCalling, email, collaboratorId } = body;

    if (!storeName?.trim()) {
      return NextResponse.json({ error: 'Le nom du magasin est requis' }, { status: 400 });
    }

    let targetColumnId = columnId;
    let pipelineId: string;

    if (!targetColumnId) {
      const defaultCol = await prisma.pipelineColumn.findFirst({ where: { position: 0 } });
      targetColumnId = defaultCol?.id;
      pipelineId = defaultCol?.pipelineId!;
      if (!targetColumnId) return NextResponse.json({ error: 'Aucune colonne trouvée' }, { status: 400 });
    } else {
      const col = await prisma.pipelineColumn.findUnique({ where: { id: targetColumnId } });
      pipelineId = col?.pipelineId!;
      if (!pipelineId) return NextResponse.json({ error: 'Pipeline introuvable' }, { status: 400 });
    }

    const deduplicationKey = `manual:${normalizeText(storeName)}:${normalizeText(city || '')}:${Date.now()}`;

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

    const positionInCol = await prisma.deal.count({ where: { columnId: targetColumnId } });

    const deal = await prisma.deal.create({
      data: {
        pipelineId,
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
        collaboratorId: collaboratorId || null,
      },
      include: {
        store: { include: { brand: true } },
        column: true,
        collaborator: true,
      },
    });

    return NextResponse.json(deal, { status: 201 });
  } catch (err) {
    console.error('[POST /api/deals]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
