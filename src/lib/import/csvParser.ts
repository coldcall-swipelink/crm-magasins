// src/lib/import/csvParser.ts

export type CsvRow = Record<string, string>;

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if ((char === ',' || char === ';') && !inQuotes) {
      result.push(current.trim()); current = '';
    } else { current += char; }
  }
  result.push(current.trim());
  return result;
}

function detectSeparator(firstLine: string): ',' | ';' {
  const commas = (firstLine.match(/,/g) || []).length;
  const semicolons = (firstLine.match(/;/g) || []).length;
  return semicolons >= commas ? ';' : ',';
}

export function parseCsv(text: string): CsvRow[] {
  const cleaned = text.replace(/^\uFEFF/, '').trim();
  const lines = cleaned.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) throw new Error('Le fichier CSV doit contenir au moins une ligne d\'en-tête et une ligne de données.');
  const sep = detectSeparator(lines[0]);
  const rawHeaders = parseCsvLine(lines[0]);
  const headers = rawHeaders.map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''));
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCsvLine(line);
    if (values.every(v => !v)) continue;
    const row: CsvRow = {};
    headers.forEach((h, idx) => { row[h] = (values[idx] || '').trim().replace(/^"|"$/g, ''); });
    rows.push(row);
  }
  return rows;
}

const FIELD_ALIASES: Record<string, string[]> = {
  brand:          ['enseigne', 'brand', 'marque', 'insigne', 'réseau', 'reseau'],
  storeName:      ['nom magasin', 'nom du magasin', 'magasin', 'nom_magasin', 'etablissement', 'store', 'nom'],
  city:           ['ville', 'city', 'commune', 'localite', 'localité'],
  postalCode:     ['code postal', 'cp', 'code_postal', 'postal', 'zip'],
  department:     ['département', 'departement', 'dept', 'dep', 'num_departement'],
  address:        ['adresse', 'address', 'rue', 'adresse_complete'],
  siret:          ['siret', 'siren'],
  externalId:     ['id magasin', 'store id', 'id_magasin', 'identifiant', 'ref_magasin', 'external_id'],
  jobTitle:       ['poste', 'fonction', 'metier', 'métier', 'job_title', 'emploi'],
  offerTitle:     ['titre', 'titre offre', 'intitulé', 'intitule', 'title', "titre de l'offre", 'libelle'],
  publishedAt:    ['date publication', 'date_publication', 'date_pub', 'date', 'published_at', 'date_offre'],
  url:            ['lien', 'url', 'link', "lien de l'offre", 'url_offre'],
  salary:         ['salaire', 'salary', 'remuneration', 'rémunération', 'salaire_brut'],
  contractType:   ['contrat', 'type contrat', 'contract', 'type de contrat', 'type_contrat'],
  source:         ['source', 'origine', 'site'],
  externalOfferId:['id offre', 'offer id', 'job id', 'id_offre', 'ref_offre', 'external_offer_id'],
  directeur:      ['directeur', 'director', 'responsable'],
  contactCalling: ['contact calling', 'interlocuteur'],
  dealEmail:      ['email', 'mail', 'e-mail', 'courriel'],
};

export type MappedRow = {
  brand: string; storeName: string; city: string; postalCode: string;
  department: string; address: string; siret: string; externalId: string;
  jobTitle: string; offerTitle: string; publishedAt: string; url: string;
  salary: string; contractType: string; source: string; externalOfferId: string;
  directeur: string; contactCalling: string; dealEmail: string;
};

export function mapCsvRow(row: CsvRow): MappedRow {
  const mapped: Partial<MappedRow> = {};
  const rowKeys = Object.keys(row);
  const lowerKeys = rowKeys.map(k => k.toLowerCase());
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) {
      const idx = lowerKeys.findIndex(k => k === alias || k.includes(alias));
      if (idx >= 0) { (mapped as Record<string, string>)[field] = row[rowKeys[idx]] || ''; break; }
    }
    if (!(mapped as Record<string, string>)[field]) (mapped as Record<string, string>)[field] = '';
  }
  return mapped as MappedRow;
}
