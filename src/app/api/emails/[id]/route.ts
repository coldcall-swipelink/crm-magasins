// src/app/api/emails/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * Annulation d'un envoi programmé.
 *
 *   DELETE /api/emails/<id>
 *
 * Seul un email encore en attente (« scheduled ») peut être annulé : une fois
 * parti — ou en cours d'envoi — il n'y a plus rien à annuler, et l'historique
 * des emails envoyés ne doit pas pouvoir être effacé depuis la fiche affaire.
 */
export const dynamic = 'force-dynamic';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // Le filtre sur le statut est DANS la suppression : entre une lecture et
    // une suppression séparées, le planificateur aurait pu faire partir l'email.
    const deleted = await prisma.emailLog.deleteMany({
      where: { id: params.id, status: 'scheduled' },
    });
    if (deleted.count === 0) {
      const mail = await prisma.emailLog.findUnique({
        where: { id: params.id },
        select: { status: true },
      });
      return NextResponse.json(
        {
          error: mail
            ? "Cet email n'est plus annulable : il est déjà parti."
            : 'Email introuvable.',
        },
        { status: mail ? 409 : 404 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/emails/[id]]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
