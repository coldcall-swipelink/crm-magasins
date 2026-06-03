// src/app/api/jobOffers/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { dealId, storeId, importBatchId, jobTitle, title, contractType, salary, source, url } = body;

    if (!dealId || !storeId || !jobTitle) {
      return NextResponse.json({ error: 'dealId, storeId et jobTitle sont requis' }, { status: 400 });
    }

    // Créer un fingerprint unique pour l'offre
    const fingerprint = `${storeId}-${jobTitle}-${Date.now()}`;

    const offer = await prisma.jobOffer.create({
      data: {
        dealId,
        storeId,
        importBatchId,
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
