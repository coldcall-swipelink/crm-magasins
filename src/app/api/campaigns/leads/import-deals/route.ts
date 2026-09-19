// src/app/api/campaigns/leads/import-deals/route.ts
//
//   GET  /api/campaigns/leads/import-deals?pipelineId=…&columnIds=a,b&brandId=…
//        → aperçu, sans rien écrire
//   POST /api/campaigns/leads/import-deals                → reprise effective
//
// Reprend les contacts des affaires du CRM comme leads de prospection. Les
// informations sont déjà saisies dans le pipeline : les retaper dans un CSV
// serait une double saisie, et une double vérité dès la première correction.
//
// Avec `campaignId`, les leads repris sont inscrits dans la campagne dans la
// foulée — même geste que pour un import de fichier.

import { NextRequest, NextResponse } from 'next/server';
import { importDealLeads, previewDealLeads } from '@/lib/campaigns/dealImport';
import { enrollLeads } from '@/lib/campaigns/engine';

export const dynamic = 'force-dynamic';
// Le CRM peut compter plusieurs milliers d'affaires.
export const maxDuration = 300;

/** Identifiants de colonnes, nettoyés : chaînes non vides, sans doublon. */
function cleanIds(value: unknown): string[] | undefined {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const ids = Array.from(new Set(raw.map(v => String(v).trim()).filter(Boolean)));
  return ids.length ? ids : undefined;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const preview = await previewDealLeads({
    pipelineId: (params.get('pipelineId') || '').trim() || undefined,
    // Plusieurs colonnes à la fois : « a,b,c » dans un seul paramètre.
    columnIds: cleanIds(params.get('columnIds')),
    brandId: (params.get('brandId') || '').trim() || undefined,
  });
  return NextResponse.json({ preview });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  const report = await importDealLeads({
    pipelineId: body?.pipelineId ? String(body.pipelineId) : undefined,
    columnIds: cleanIds(body?.columnIds),
    brandId: body?.brandId ? String(body.brandId) : undefined,
    // Par défaut on complète les leads déjà connus ; l'écran permet de ne
    // reprendre que les nouveaux.
    onlyNew: body?.onlyNew === true,
    userName: body?.userName ? String(body.userName).trim() : undefined,
  });

  if (body?.campaignId) {
    try {
      const enrolled = await enrollLeads(String(body.campaignId), report.leadIds);
      return NextResponse.json({ report, enrolled }, { status: 201 });
    } catch (err) {
      return NextResponse.json({
        report,
        enrollError: err instanceof Error ? err.message : String(err),
      }, { status: 201 });
    }
  }

  return NextResponse.json({ report }, { status: 201 });
}
