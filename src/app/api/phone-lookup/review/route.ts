// src/app/api/phone-lookup/review/route.ts
// File de revue des numéros douteux : les magasins pour lesquels la recherche a
// bien trouvé un numéro plausible, mais sans réunir assez d'indices pour
// l'enregistrer d'office (ex. bonne enseigne et bonne ville, mais code postal
// différent). Un clic suffit alors à valider ou à écarter la proposition.
//
//   GET  → magasins en attente, avec leurs candidats et le lien vers la fiche
//          d'origine (Google Maps / OpenStreetMap) pour vérifier d'un coup d'œil.
//   POST → décision : { storeId, phone } valide un numéro, { storeId, reject:true }
//          écarte les propositions et bascule le magasin en « introuvable ».
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { normalizePhone } from '@/lib/phone/normalize';
import type { PhoneCandidate } from '@/lib/phone/lookup';
import { USE_MOCK_DATA } from '@/lib/mockData';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (USE_MOCK_DATA) return NextResponse.json({ items: [], total: 0 });
  try {
    const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') || 30), 100);

    const [stores, total] = await Promise.all([
      prisma.store.findMany({
        where: { phone: '', phoneLookupStatus: 'a_verifier' },
        select: {
          id: true, name: true, city: true, postalCode: true, address: true,
          phoneCandidates: true,
          brand: { select: { name: true } },
          deal: { select: { id: true } },
        },
        orderBy: { phoneLookupAt: 'asc' },
        take: limit,
      }),
      prisma.store.count({ where: { phone: '', phoneLookupStatus: 'a_verifier' } }),
    ]);

    const items = stores.map((s) => ({
      storeId: s.id,
      dealId: s.deal?.id ?? null,
      label: [s.brand?.name, s.name, s.city].filter(Boolean).join(' — '),
      address: [s.address, s.postalCode, s.city].filter(Boolean).join(' '),
      candidates: (s.phoneCandidates as unknown as PhoneCandidate[]) ?? [],
    }));

    return NextResponse.json({ items, total });
  } catch (err) {
    console.error('[GET /api/phone-lookup/review]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (USE_MOCK_DATA) {
    return NextResponse.json({ error: 'Indisponible en mode démonstration' }, { status: 400 });
  }
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const storeId = typeof body.storeId === 'string' ? body.storeId : '';
    if (!storeId) return NextResponse.json({ error: 'storeId manquant' }, { status: 400 });

    const store = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true } });
    if (!store) return NextResponse.json({ error: 'Magasin non trouvé' }, { status: 404 });

    // Rejet : on écarte les propositions sans les remettre en file, sinon le
    // magasin reviendrait indéfiniment dans l'écran de revue.
    if (body.reject === true) {
      await prisma.store.update({
        where: { id: storeId },
        data: { phoneLookupStatus: 'introuvable', phoneCandidates: undefined, phoneLookupAt: new Date() },
      });
      return NextResponse.json({ ok: true, rejected: true });
    }

    const normalized = normalizePhone(typeof body.phone === 'string' ? body.phone : '');
    if (!normalized) {
      return NextResponse.json({ error: 'Numéro invalide' }, { status: 400 });
    }

    // Validation manuelle : la source devient « manuel », le numéro est figé.
    await prisma.store.update({
      where: { id: storeId },
      data: {
        phone: normalized.display,
        phoneSource: 'manuel',
        phoneLookupStatus: 'trouve',
        phoneLookupAt: new Date(),
      },
    });
    // Le numéro n'est recopié sur l'affaire que si elle n'en a pas déjà un.
    await prisma.deal.updateMany({
      where: { storeId, contactPhone: '' },
      data: { contactPhone: normalized.display },
    });

    return NextResponse.json({ ok: true, phone: normalized.display });
  } catch (err) {
    console.error('[POST /api/phone-lookup/review]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
