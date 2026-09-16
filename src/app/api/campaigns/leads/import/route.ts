// src/app/api/campaigns/leads/import/route.ts
//
// Import de leads en deux temps, pour qu'on voie ce qu'on importe avant de
// l'importer :
//
//   POST { filename, content }                    → APERÇU : en-têtes détectés,
//         correspondance proposée, 5 premières lignes, volume, doublons.
//   POST { filename, content, mapping, commit }   → IMPORT réel.
//   POST { …, commit, campaignId }                → IMPORT puis inscription
//         immédiate dans la campagne : « importer ce fichier dans cette
//         campagne » se fait en une seule opération.
//
// Le fichier est transmis en texte brut et lu côté serveur : la correspondance
// des colonnes et les règles de déduplication vivent au même endroit que
// l'écriture en base (src/lib/campaigns/leads.ts).

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseLeadCsv } from '@/lib/campaigns/csv';
import { enrollLeads } from '@/lib/campaigns/engine';
import {
  LEAD_FIELDS, applyMapping, importLeads, isValidEmail, suggestMapping,
  type LeadMapping,
} from '@/lib/campaigns/leads';

export const dynamic = 'force-dynamic';
// Un import de plusieurs milliers de lignes écrit en base par paquets.
export const maxDuration = 300;

/** Au-delà, le fichier est refusé : à découper en plusieurs lots. */
const MAX_ROWS = 20_000;

export async function GET() {
  // Historique des imports, pour filtrer la liste des leads par lot.
  const imports = await prisma.leadImport.findMany({
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
  return NextResponse.json({ imports });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Corps de requête invalide' }, { status: 400 });

  const content = String(body.content || '');
  const filename = String(body.filename || 'import.csv').trim() || 'import.csv';
  if (!content.trim()) return NextResponse.json({ error: 'Fichier vide' }, { status: 400 });

  let parsed;
  try {
    parsed = parseLeadCsv(content);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
  if (parsed.rows.length > MAX_ROWS) {
    return NextResponse.json({
      error: `Fichier trop volumineux (${parsed.rows.length} lignes, maximum ${MAX_ROWS}). `
        + 'Découpez-le en plusieurs fichiers.',
    }, { status: 413 });
  }

  // Correspondance : celle validée à l'écran, ou celle proposée par défaut.
  const mapping: LeadMapping = body.mapping && typeof body.mapping === 'object'
    ? (body.mapping as LeadMapping)
    : suggestMapping(parsed.headers);

  // ─── Aperçu ─────────────────────────────────────────────────────────────
  if (!body.commit) {
    const emails = new Set<string>();
    let valid = 0;
    let invalid = 0;
    let duplicates = 0;

    for (const row of parsed.rows) {
      const email = applyMapping(row, mapping).email;
      if (!isValidEmail(email)) { invalid++; continue; }
      if (emails.has(email)) { duplicates++; continue; }
      emails.add(email);
      valid++;
    }

    // Combien sont déjà en base ? Le chiffre décide de l'option « mettre à jour ».
    const known = emails.size
      ? await prisma.lead.count({ where: { email: { in: Array.from(emails) } } })
      : 0;

    return NextResponse.json({
      preview: true,
      filename,
      separator: parsed.separator,
      headers: parsed.headers,
      mapping,
      fields: LEAD_FIELDS,
      sample: parsed.rows.slice(0, 5),
      stats: { rows: parsed.rows.length, valid, invalid, duplicates, known, new: valid - known },
    });
  }

  // ─── Import réel ────────────────────────────────────────────────────────
  const hasEmailColumn = Object.values(mapping).includes('email');
  if (!hasEmailColumn) {
    return NextResponse.json({
      error: "Aucune colonne n'est associée à l'email : l'import ne peut pas identifier les leads.",
    }, { status: 400 });
  }

  const report = await importLeads({
    filename,
    mapping,
    rows: parsed.rows,
    source: body.source ? String(body.source).trim() : undefined,
    updateExisting: body.updateExisting !== false,
    userName: body.userName ? String(body.userName).trim() : undefined,
  });

  // Import depuis une campagne : on enchaîne sur l'inscription, sans repasser
  // par l'écran des leads. Les leads déjà connus du fichier en font partie.
  if (body.campaignId) {
    try {
      const enrolled = await enrollLeads(String(body.campaignId), report.leadIds);
      return NextResponse.json({ report, enrolled }, { status: 201 });
    } catch (err) {
      // L'import, lui, a bien eu lieu : on le dit, plutôt que de laisser croire
      // à un échec complet.
      return NextResponse.json({
        report,
        enrollError: err instanceof Error ? err.message : String(err),
      }, { status: 201 });
    }
  }

  return NextResponse.json({ report }, { status: 201 });
}
