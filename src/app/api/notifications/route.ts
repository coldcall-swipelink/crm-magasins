import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { syncRepliesIfDue } from '@/lib/emailInbox';
import { ensureEmailOpenNotificationTable } from '@/lib/emailOpenNotifications';

// Centre de notifications : ouvertures d'emails (EmailOpenNotification, créées
// par le webhook Resend à la PREMIÈRE ouverture d'un email sortant). Objectif :
// signaler au commercial que son contact vient de lire l'email, pour qu'il
// appelle tout de suite.
//
//   ?senderEmail=  → restreint aux emails envoyés depuis cette boîte
//                    (l'utilisateur connecté ne voit que SES ouvertures) ;
//   ?dealId=       → restreint à une seule affaire.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const dealId = req.nextUrl.searchParams.get('dealId') || undefined;
  const senderEmail = (req.nextUrl.searchParams.get('senderEmail') || '').trim().toLowerCase() || undefined;

  // Relevé des réponses aux emails (IMAP), espacé par son propre verrou
  // (cf. syncRepliesIfDue) : la plupart des appels ne font rien. Tolérant :
  // il ne doit jamais empêcher la lecture des notifications.
  try {
    await syncRepliesIfDue();
  } catch (err) {
    console.error('syncRepliesIfDue error:', err);
  }

  const where = {
    ...(dealId ? { dealId } : {}),
    ...(senderEmail ? { senderEmail } : {}),
  };

  const read = async () => {
    const notifications = await prisma.emailOpenNotification.findMany({
      where,
      orderBy: { openedAt: 'desc' },
      take: dealId ? 200 : 100,
      include: {
        deal: {
          select: {
            id: true,
            contactCalling: true,
            store: { select: { name: true, brand: { select: { name: true } } } },
          },
        },
      },
    });

    // Affaires ayant au moins un email ouvert non acquitté (→ point sur la carte).
    const unread = await prisma.emailOpenNotification.findMany({
      where: { ...where, isRead: false },
      select: { dealId: true },
    });
    const dealIdsWithUnread = Array.from(new Set(unread.map((u: { dealId: string }) => u.dealId)));

    return { notifications, unreadCount: unread.length, dealIdsWithUnread };
  };

  try {
    return NextResponse.json(await read());
  } catch (err) {
    // Table manquante (base jamais synchronisée par le build) : on la crée
    // puis on relit — la première consultation répare la base.
    try {
      await ensureEmailOpenNotificationTable();
      return NextResponse.json(await read());
    } catch (err2) {
      console.error('EmailOpenNotification fetch error:', err, err2);
      return NextResponse.json({ notifications: [], unreadCount: 0, dealIdsWithUnread: [] });
    }
  }
}

// Marque des notifications comme lues. `senderEmail` (optionnel) restreint
// l'acquittement aux notifications de cette boîte expéditrice.
//   { all: true }      → toutes les notifications non lues
//   { dealId: "..." }  → toutes celles d'une affaire
//   { ids: ["..."] }   → notifications ciblées
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const where: Record<string, unknown> = { isRead: false };
    if (typeof body?.senderEmail === 'string' && body.senderEmail.trim()) {
      where.senderEmail = body.senderEmail.trim().toLowerCase();
    }
    if (body?.all === true) {
      // pas de filtre supplémentaire
    } else if (typeof body?.dealId === 'string' && body.dealId) {
      where.dealId = body.dealId;
    } else if (Array.isArray(body?.ids) && body.ids.length) {
      where.id = { in: body.ids.filter((x: unknown) => typeof x === 'string') };
    } else {
      return NextResponse.json({ error: 'Préciser all, dealId ou ids' }, { status: 400 });
    }

    const res = await prisma.emailOpenNotification.updateMany({ where, data: { isRead: true } });
    return NextResponse.json({ ok: true, updated: res.count });
  } catch (err) {
    console.error('EmailOpenNotification PATCH error:', err);
    return NextResponse.json({ error: 'Erreur lors de la mise à jour' }, { status: 500 });
  }
}
