import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { syncRepliesIfDue } from '@/lib/emailInbox';
import { ensureEmailOpenNotificationTable } from '@/lib/emailOpenNotifications';
import { EMAIL_SENDERS } from '@/lib/emailSenders';

// Centre de notifications : ouvertures d'emails (EmailOpenNotification, créées
// par le webhook Resend à la PREMIÈRE ouverture d'un email sortant). Objectif :
// signaler au commercial que son contact vient de lire l'email, pour qu'il
// appelle tout de suite.
//
//   ?userId=       → ouvertures des emails envoyés par CE user CRM (quelle que
//                    soit la boîte d'expédition utilisée : hugo@, mark@…) ;
//   ?senderEmail=  → repli pour les emails sans attribution (historique,
//                    automatisations) partis de cette boîte ;
//   ?dealId=       → restreint à une seule affaire.
export const dynamic = 'force-dynamic';

// Périmètre de visibilité d'un utilisateur :
//   1. les ouvertures des emails qu'il a lui-même envoyés (senderUserId) ;
//   2. les ouvertures non attribuées (senderUserId null) parties de SA boîte
//      (emails d'avant l'attribution) ;
//   3. les ouvertures non attribuées parties d'une adresse hors liste des
//      boîtes personnelles (automatisations N8N…) : visibles de tous, pour ne
//      perdre aucun signal.
// Sans userId ni senderEmail (compte non identifiable) : tout est visible.
function senderScope(userId?: string, senderEmail?: string): Record<string, unknown> {
  if (!userId && !senderEmail) return {};
  const personalBoxes = EMAIL_SENDERS.map((s) => s.email.toLowerCase());
  const or: Record<string, unknown>[] = [];
  if (userId) or.push({ senderUserId: userId });
  if (senderEmail) or.push({ senderUserId: null, senderEmail });
  or.push({ senderUserId: null, senderEmail: { notIn: personalBoxes } });
  return { OR: or };
}

export async function GET(req: NextRequest) {
  const dealId = req.nextUrl.searchParams.get('dealId') || undefined;
  const userId = (req.nextUrl.searchParams.get('userId') || '').trim() || undefined;
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
    ...senderScope(userId, senderEmail),
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

// Marque des notifications comme lues. `userId` / `senderEmail` (optionnels)
// restreignent l'acquittement au périmètre de l'utilisateur (cf. senderScope).
//   { all: true }      → toutes les notifications non lues
//   { dealId: "..." }  → toutes celles d'une affaire
//   { ids: ["..."] }   → notifications ciblées
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const userId = typeof body?.userId === 'string' && body.userId.trim() ? body.userId.trim() : undefined;
    const senderEmail = typeof body?.senderEmail === 'string' && body.senderEmail.trim()
      ? body.senderEmail.trim().toLowerCase()
      : undefined;
    const where: Record<string, unknown> = { isRead: false, ...senderScope(userId, senderEmail) };
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
