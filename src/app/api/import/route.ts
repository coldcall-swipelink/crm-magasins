// src/app/api/import/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { runCsvImport } from '@/lib/import/importService';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'Aucun fichier fourni.' }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith('.csv')) {
      return NextResponse.json({ error: 'Le fichier doit être au format CSV.' }, { status: 400 });
    }

    const text = await file.text();
    const result = await runCsvImport(text, file.name);

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    console.error('[API /import]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
