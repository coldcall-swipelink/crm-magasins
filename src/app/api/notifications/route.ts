import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isProductSupabaseConfigured } from '@/lib/demoOrganization';
import { syncOfferNotifications } from '@/lib/offerNotifications';

// Centre de notifications : offres créées côté produit (Supabase) par les
// Organizations rattachées aux affaires. À chaque GET on relève d'abord Supabase
// (lecture seule) pour matérialiser les nouvelles offres, puis on renvoie la
// liste. `?dealId=` restreint le relevé et la liste à une seule affaire (feed
// d'activité du deal).
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const dealId = req.nextUrl.searchParams.get('dealId') || undefined;

  if (!isProductSupabaseConfigured()) {
    return NextResponse.json({ configured: false, notifications: [], unreadCount: 0, dealIdsWithUnread: [] });
  }

  // Relevé Supabase → OfferNotification. Tolérant : n'empêche jamais la lecture.
  try {
    await syncOfferNotifications(dealId);
  } catch (err) {
    console.error('syncOfferNotifications error:', err);
  }

  try {
    const notifications = await prisma.offerNotification.findMany({
      where: dealId ? { dealId } : {},
      orderBy: { offerCreatedAt: 'desc' },
      take: dealId ? 200 : 100,
      include: {
        deal: {
          select: {
            id: true,
            store: { select: { name: true, brand: { select: { name: true } } } },
          },
        },
      },
    });

    // Affaires ayant au moins une offre non lue (→ point bleu sur la carte).
    const unread = await prisma.offerNotification.findMany({
      where: { isRead: false, ...(dealId ? { dealId } : {}) },
      select: { dealId: true },
    });
    const dealIdsWithUnread = Array.from(new Set(unread.map((u: { dealId: string }) => u.dealId)));

    return NextResponse.json({
      configured: true,
      notifications,
      unreadCount: unread.length,
      dealIdsWithUnread,
    });
  } catch (err) {
    // Table manquante (avant db-sync) : on renvoie un état vide exploitable.
    console.error('OfferNotification fetch error (table manquante ?):', err);
    return NextResponse.json({ configured: true, notifications: [], unreadCount: 0, dealIdsWithUnread: [] });
  }
}

// Marque des notifications comme lues.
//   { all: true }      → toutes les notifications non lues
//   { dealId: "..." }  → toutes celles d'une affaire
//   { ids: ["..."] }   → notifications ciblées
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const where: Record<string, unknown> = { isRead: false };
    if (body?.all === true) {
      // pas de filtre supplémentaire
    } else if (typeof body?.dealId === 'string' && body.dealId) {
      where.dealId = body.dealId;
    } else if (Array.isArray(body?.ids) && body.ids.length) {
      where.id = { in: body.ids.filter((x: unknown) => typeof x === 'string') };
    } else {
      return NextResponse.json({ error: 'Préciser all, dealId ou ids' }, { status: 400 });
    }

    const res = await prisma.offerNotification.updateMany({ where, data: { isRead: true } });
    return NextResponse.json({ ok: true, updated: res.count });
  } catch (err) {
    console.error('OfferNotification PATCH error:', err);
    return NextResponse.json({ error: 'Erreur lors de la mise à jour' }, { status: 500 });
  }
}
