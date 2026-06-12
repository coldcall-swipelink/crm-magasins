// src/app/api/import/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { runCsvImport, runTargetedCsvImport, runNotesImport } from '@/lib/import/importService';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const columnId = formData.get('columnId');
    const mode = formData.get('mode');

    if (!file) {
      return NextResponse.json({ error: 'Aucun fichier fourni.' }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith('.csv')) {
      return NextResponse.json({ error: 'Le fichier doit être au format CSV.' }, { status: 400 });
    }

    const text = await file.text();

    // Trois modes :
    //   • notes    → rattache des notes à des affaires existantes (aucune création) ;
    //   • ciblé    → place les nouveaux magasins dans une colonne donnée ;
    //   • normal   → import complet avec offres et règles métier.
    const result = mode === 'notes'
      ? await runNotesImport(text, file.name)
      : columnId && typeof columnId === 'string'
        ? await runTargetedCsvImport(text, file.name, columnId)
        : await runCsvImport(text, file.name);

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    console.error('[API /import]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
