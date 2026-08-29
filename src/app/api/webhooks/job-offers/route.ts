// src/app/api/webhooks/job-offers/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { receiveOffers, type InboundPayload } from '@/lib/import/offerInbox';

/**
 * Réception des offres poussées par l'automatisation N8N.
 *
 *   POST /api/webhooks/job-offers?token=<OFFERS_WEBHOOK_TOKEN>
 *   (le jeton est aussi accepté en en-tête `Authorization: Bearer …`)
 *
 * Corps accepté — au choix, selon ce que sait produire le workflow :
 *
 *   • un tableau d'offres           [{ "enseigne": "…", "ville": "…" }, …]
 *   • un objet enveloppe            { "label": "Indeed 12/03", "source": "n8n-indeed",
 *                                     "rows": [ … ] }            (ou "offers" / "data" / "items")
 *   • un CSV entier                 { "csv": "enseigne;ville;…\n…" }
 *   • du CSV brut (Content-Type: text/csv)
 *
 * Les noms de colonnes sont ceux de l'import manuel (« enseigne », « nom
 * magasin », « ville », « poste », « titre », « date publication », « lien »,
 * « salaire », « contrat », « source », « id offre »…) : le fichier Excel
 * existant peut être poussé tel quel, sans le retravailler.
 *
 * Les offres n'entrent PAS dans le pipeline : elles rejoignent la boîte de
 * réception et attendent le tri fait dans le CRM (popup « Nouvelles offres
 * reçues »). Le webhook est rejouable — une offre déjà reçue est ignorée.
 *
 * Sans OFFERS_WEBHOOK_TOKEN configuré, la route reste fermée (elle écrit en
 * base), comme /api/emails/sync-replies.
 */
export const dynamic = 'force-dynamic';

// Un envoi peut porter plusieurs centaines d'offres, chacune qualifiée par
// quelques requêtes (magasin connu ? offre connue ?) : on laisse de la marge.
export const maxDuration = 60;

function unauthorized(req: NextRequest): boolean {
  const expected = (process.env.OFFERS_WEBHOOK_TOKEN || '').trim();
  if (!expected) return true;
  const provided = req.nextUrl.searchParams.get('token')
    || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    || req.headers.get('x-webhook-token')
    || '';
  return provided !== expected;
}

export async function POST(req: NextRequest) {
  if (unauthorized(req)) {
    return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
  }

  try {
    const contentType = req.headers.get('content-type') || '';
    let payload: InboundPayload;

    if (contentType.includes('csv') || contentType.startsWith('text/plain')) {
      payload = { csv: await req.text() };
    } else {
      const body = await req.json().catch(() => null);
      if (body === null) {
        return NextResponse.json({ error: 'Corps de requête illisible (JSON attendu).' }, { status: 400 });
      }
      // Tableau nu ou objet enveloppe : `receiveOffers` sait lire les deux, on
      // se contente de remonter le libellé/la source quand ils sont fournis.
      const envelope = (!Array.isArray(body) && typeof body === 'object' ? body : {}) as Record<string, unknown>;
      payload = {
        rows: body,
        csv: typeof envelope.csv === 'string' ? envelope.csv : undefined,
        label: typeof envelope.label === 'string' ? envelope.label : undefined,
        source: typeof envelope.source === 'string' ? envelope.source : undefined,
      };
    }

    const result = await receiveOffers(payload);
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    console.error('[POST /api/webhooks/job-offers]', err);
    // 400 pour une charge utile inexploitable (erreur de câblage côté N8N),
    // 500 pour le reste.
    const status = /charge utile|CSV/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
