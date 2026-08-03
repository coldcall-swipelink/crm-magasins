import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { normalizeText } from '@/lib/utils';

// Diagnostic LECTURE SEULE des doublons de magasins/affaires, accessible au
// navigateur (protégé par token). Sert aussi de « canary » de déploiement : le
// champ `marker` confirme que la dernière version du code est bien en ligne.
//   GET /api/admin/diagnose-duplicates?token=diag-crm-2026
// À retirer une fois le diagnostic terminé.
export const dynamic = 'force-dynamic';

const TOKEN = 'diag-crm-2026';
const MARKER = 'dedup-diagnose-v1';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('token') !== TOKEN) {
    return NextResponse.json({ error: 'token invalide' }, { status: 401 });
  }

  const stores = await prisma.store.findMany({
    include: {
      brand: { select: { name: true } },
      deal: { select: { id: true, columnId: true } },
    },
    orderBy: { normalizedName: 'asc' },
  });

  const fmt = (s: (typeof stores)[number]) => ({
    storeId: s.id,
    dealId: s.deal?.id ?? null,
    enseigne: s.brand?.name ?? null,
    name: s.name,
    normalizedName: s.normalizedName,
    normalizedNameRecalc: normalizeText(s.name),
    normalizedNameConsistent: normalizeText(s.name) === s.normalizedName,
    city: s.city,
    dedupKey: s.deduplicationKey,
  });

  // Groupes de doublons : même nom normalisé recalculé sur plusieurs magasins.
  const groups = new Map<string, typeof stores>();
  for (const s of stores) {
    const k = normalizeText(s.name);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(s);
  }
  const duplicateGroups = Array.from(groups.entries())
    .filter(([, arr]) => arr.length > 1)
    .map(([key, arr]) => ({ key, count: arr.length, stores: arr.map(fmt) }));

  // Zoom bannière « U ».
  const uBannerStores = stores
    .filter((s) => {
      const nb = normalizeText(s.brand?.name ?? '');
      const nn = normalizeText(s.name);
      return nb === 'u' || nb.includes('super u') || nb.includes('hyper u') || nb.includes('u express')
          || nn.includes('super u') || nn.includes('hyper u') || nn.includes('u express');
    })
    .map(fmt);

  return NextResponse.json({
    marker: MARKER,
    totalStores: stores.length,
    duplicateGroupCount: duplicateGroups.length,
    duplicateGroups,
    uBannerStoreCount: uBannerStores.length,
    uBannerStores,
  });
}
