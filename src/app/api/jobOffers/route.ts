// src/app/api/jobOffers/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Route API dynamique : exécutée à chaque requête (lit la base de données),
// jamais pré-générée au build.
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { dealId, storeId, jobTitle, title, contractType, salary, source, url } = body;

    if (!dealId || !storeId || !jobTitle) {
      return NextResponse.json({ error: 'dealId, storeId et jobTitle sont requis' }, { status: 400 });
    }

    // Récupérer ou créer un batch "manual"
    let batch = await prisma.importBatch.findFirst({ where: { fileName: 'manual' } });
    if (!batch) {
      batch = await prisma.importBatch.create({
        data: { fileName: 'manual', totalRows: 0 },
      });
    }

    // Créer un fingerprint unique pour l'offre
    const fingerprint = `${storeId}-${jobTitle}-${Date.now()}`;

    const offer = await prisma.jobOffer.create({
      data: {
        dealId,
        storeId,
        importBatchId: batch.id,
        jobTitle,
        title: title || jobTitle,
        contractType: contractType || '',
        salary: salary || '',
        source: source || 'manual',
        url: url || '',
        fingerprint,
        status: 'active',
      },
    });

    return NextResponse.json(offer, { status: 201 });
  } catch (err) {
    console.error('[POST /api/jobOffers]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
