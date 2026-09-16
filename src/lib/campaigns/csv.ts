// src/lib/campaigns/csv.ts
//
// Lecture des fichiers de leads (CSV / TSV).
//
// Pourquoi un second lecteur alors que src/lib/import/csvParser.ts existe :
// celui-là met les en-têtes en minuscules et les mappe vers les champs d'une
// affaire. Ici on a besoin de l'INVERSE — garder les en-têtes exactement tels
// que l'utilisateur les a écrits, parce que toute colonne non reconnue devient
// un champ personnalisé, donc une variable de personnalisation ({{effectif}}).
// Il gère aussi les valeurs contenant un retour à la ligne, fréquentes dans les
// exports d'annuaires, que la découpe ligne à ligne casserait.

export type ParsedCsv = {
  /** En-têtes dans l'ordre du fichier, tels quels. */
  headers: string[];
  /** Lignes de données, indexées par en-tête. */
  rows: Record<string, string>[];
  /** Séparateur retenu, affiché dans l'aperçu d'import. */
  separator: string;
};

/** Séparateur majoritaire de la première ligne (hors guillemets). */
function detectSeparator(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const counts = [',', ';', '\t', '|'].map(sep => {
    let count = 0, inQuotes = false;
    for (let i = 0; i < firstLine.length; i++) {
      const char = firstLine[i];
      if (char === '"') inQuotes = !inQuotes;
      else if (char === sep && !inQuotes) count++;
    }
    return { sep, count };
  });
  counts.sort((a, b) => b.count - a.count);
  return counts[0].count > 0 ? counts[0].sep : ',';
}

/**
 * Découpe le fichier en tableau de cellules.
 * Parcours caractère par caractère : un retour à la ligne entre guillemets
 * appartient à la valeur, il ne termine pas la ligne.
 */
function splitCells(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }  // guillemet échappé
        else inQuotes = false;
      } else cell += char;
      continue;
    }

    if (char === '"') { inQuotes = true; continue; }
    if (char === sep) { row.push(cell); cell = ''; continue; }
    if (char === '\r') continue;
    if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += char;
  }
  // Dernière cellule / dernière ligne (fichier sans retour final).
  row.push(cell);
  rows.push(row);

  // On jette les lignes entièrement vides (dernière ligne du fichier, surtout).
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

/** Lit un fichier CSV/TSV et renvoie ses en-têtes et ses lignes. */
export function parseLeadCsv(text: string): ParsedCsv {
  const cleaned = text.replace(/^﻿/, ''); // BOM des exports Excel
  if (!cleaned.trim()) throw new Error('Fichier vide.');

  const separator = detectSeparator(cleaned);
  const cells = splitCells(cleaned, separator);
  if (cells.length < 2) {
    throw new Error("Le fichier doit contenir une ligne d'en-tête et au moins une ligne de données.");
  }

  // En-têtes : on garde la casse et les accents, on dédoublonne les colonnes
  // portant le même nom (« email », « email_2 »…) pour ne pas en perdre une.
  const seen = new Map<string, number>();
  const headers = cells[0].map((raw, index) => {
    const base = raw.trim() || `colonne_${index + 1}`;
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });

  const rows = cells.slice(1).map(values => {
    const row: Record<string, string> = {};
    headers.forEach((header, index) => { row[header] = (values[index] || '').trim(); });
    return row;
  });

  return { headers, rows, separator };
}
