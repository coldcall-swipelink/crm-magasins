// src/lib/import/jobTitle.ts
/**
 * Nettoyage des intitulés d'offres d'emploi.
 *
 * Les sites de recrutement empilent dans le titre le métier ET tout le reste :
 * mention H/F, type de contrat, durée hebdomadaire, ville, dates, variantes
 * séparées par des barres obliques…
 *
 *   « EMPLOYE VENDEUR/EMPLOYE COMMERCIAL POISSONNERIE H/F CDI TEMPS PLEIN »
 *   → « Employé vendeur poissonnerie »
 *
 * On veut un intitulé qu'on puisse recopier tel quel dans un email de
 * prospection. Le titre d'origine n'est pas perdu pour autant : il reste dans
 * la charge utile reçue (InboxOffer.rawData, ImportRow.rawData) et l'offre
 * garde son lien vers l'annonce.
 *
 * ATTENTION : ce nettoyage est purement cosmétique. Il ne doit JAMAIS entrer
 * dans le calcul d'une empreinte d'offre (cf. buildOfferFingerprint,
 * buildInboxOfferKey) : deux relevés du même titre écrit différemment doivent
 * rester deux fois la même offre, et une évolution de ces règles ne doit pas
 * transformer les offres déjà connues en nouveautés.
 */

/** Mentions de genre : « H/F », « (H/F) », « F/H », « H/F/X »… */
const GENRE = /\(?\s*\bh\s*[./]\s*f(\s*[./]\s*x)?\s*\)?/gi;

/** Même mention, mais collée au mot précédent — « RAYON FRAIS LSH/F ». Sans
 *  ce cas, la barre survit et laisse un « lsh f » incompréhensible. */
const GENRE_COLLE = /([a-zà-ÿ])h\s*[./]\s*f\b/gi;

/** Terminaisons inclusives collées au mot : « Boulanger(e) », « Hôte(sse) »,
 *  « employé(e) polyvalent(e) », « Directeur (trice) », « Adjoint(e) ». */
const INCLUSIF = /\s*\(\s*(e|se|sse|euse|trice|rice|ère|ere|ne|le)\s*\)/gi;

/** Tout ce qui parle du contrat, du temps de travail ou du moment travaillé,
 *  et non du métier. Testé mot à mot sur le titre. */
const BRUIT = [
  'cdi', 'cdd', 'cdt', 'interim', 'intérim', 'alternance', 'apprentissage',
  'stage', 'stagiaire', 'temps', 'plein', 'partiel', 'complet', 'hebdo',
  'hebdomadaire', 'semaine', 'weekend', 'week', 'end', 'samedi', 'dimanche',
  'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'etudiant', 'étudiant',
  'etudiante', 'étudiante', 'job', 'ideal', 'idéal', 'uniquement', 'journee',
  'journée', 'matin', 'soir', 'nuit', 'saisonnier', 'saisonnière', 'mois',
  'an', 'ans', 'heures', 'heure', 'h', 'ref', 'poste', 'recrute', 'recrutement',
  'urgent', 'nouveau', 'nouvelle',
  // « MODELE INTERMARCHE » : une fois l'enseigne retirée, « modèle » ne
  // désigne plus rien. Sans risque pour « modéliste », qui est un autre mot.
  'modele', 'modèle', 'modeles', 'modèles',
];

/** Accents perdus par les sites qui titrent en capitales. Restreint au
 *  vocabulaire du commerce alimentaire : hors de ce champ, on ne devine pas. */
const ACCENTS: Record<string, string> = {
  employe: 'employé', employee: 'employée', employes: 'employés',
  hote: 'hôte', hotesse: 'hôtesse', hotes: 'hôtes',
  preparateur: 'préparateur', preparation: 'préparation',
  patissier: 'pâtissier', patisserie: 'pâtisserie',
  cremerie: 'crèmerie', epicerie: 'épicerie', epiceries: 'épiceries',
  cafeteria: 'cafétéria', legumes: 'légumes', frais: 'frais',
  salee: 'salée', salees: 'salées', sale: 'salé',
  boulangerie: 'boulangerie', charcuterie: 'charcuterie',
  experimente: 'expérimenté', experimentee: 'expérimentée',
  qualite: 'qualité', puericulture: 'puériculture', securite: 'sécurité',
  responsable: 'responsable', reserve: 'réserve', drive: 'drive',
  polyvalent: 'polyvalent', polyvalente: 'polyvalente',
  cle: 'clé', general: 'général', generale: 'générale',
  developpement: 'développement', decoupe: 'découpe', desosse: 'désossé',
  eldph: 'ELDPH', bvp: 'BVP', ls: 'LS', pcg: 'PCG', sav: 'SAV', rh: 'RH',
};

/**
 * Enseignes et libellés de réseau qui traînent dans les intitulés
 * (« MODELE INTERMARCHE », « CHEF DE RAYON PCG E LECLERC Val De Moder ») :
 * l'enseigne est déjà portée par le magasin, elle n'a rien à faire dans le
 * métier qu'on recopie dans un email. Les variantes accentuées ou en plusieurs
 * mots sont couvertes ; « modèle » ne tombe que collé à une enseigne, pour ne
 * pas amputer un intitulé où le mot aurait un sens.
 */
// Les bornes ne peuvent pas être des \b : en JavaScript, « é » n'est pas un
// caractère de mot, si bien que \b ne trouve aucune limite après
// « Intermarché ». On encadre donc par des caractères non alphabétiques.
const MARQUES = new RegExp(
  '(^|[^0-9a-zà-ÿ])(?:' + [
    'intermarch[ée]s?', 'itm', 'mousquetaires',
    'e\\.?\\s*leclerc', 'leclerc',
    'super\\s*u', 'hyper\\s*u', 'u\\s*express', 'syst[èe]me\\s*u', 'coop[ée]rative\\s*u',
    'carrefour', 'auchan', 'casino', 'monoprix', 'franprix', 'lidl', 'aldi',
    'netto', 'cora', 'colruyt', 'biocoop', 'picard', 'grand\\s*frais',
    'bricomarch[ée]', 'roady',
  ].join('|') + ')(?![0-9a-zà-ÿ])',
  'gi',
);

/** Un mot est-il du bruit ? Les nombres et les durées (« 36h75 », « 10h »,
 *  « 39h ») en font partie, comme les codes postaux et les dates. */
function estBruit(mot: string): boolean {
  const m = mot.toLowerCase();
  if (!m) return true;
  if (BRUIT.includes(m)) return true;
  if (/^[-–—.]+$/.test(m)) return true;
  if (/^\d+([.,]\d+)?$/.test(m)) return true;          // 36, 26, 2026
  if (/^\d+\s*h\d*$/.test(m)) return true;             // 36h75, 10h
  if (/^\d+h\d*$/.test(m)) return true;
  return false;
}

/**
 * Deux métiers proposés en alternative — « EMPLOYE VENDEUR/EMPLOYE COMMERCIAL
 * POISSONNERIE » — se reconnaissent à la répétition du premier mot de part et
 * d'autre de la barre. On garde alors le PREMIER métier et le complément qui
 * suit le second (« employé vendeur » + « poissonnerie »).
 *
 * Sans cette répétition, la barre sépare simplement deux mots (« Préparateur/
 * livreur », « charcuterie/fromage ») : elle devient une espace.
 */
function reduireAlternatives(titre: string): string {
  if (!titre.includes('/')) return titre;

  const segments = titre.split('/').map(s => s.trim()).filter(Boolean);
  if (segments.length < 2) return titre.replace(/\//g, ' ');

  const motsA = segments[0].split(/\s+/).filter(Boolean);
  const motsB = segments[1].split(/\s+/).filter(Boolean);
  const memeDebut = motsA.length > 0 && motsB.length > 0
    && motsA[0].toLowerCase() === motsB[0].toLowerCase();

  if (memeDebut && motsB.length > motsA.length) {
    // Le second métier reprend autant de mots que le premier ; ce qui dépasse
    // est le complément commun (le rayon, la spécialité).
    const complement = motsB.slice(motsA.length).join(' ');
    const reste = segments.slice(2).join(' ');
    return [segments[0], complement, reste].filter(Boolean).join(' ');
  }
  if (memeDebut) {
    // Pure répétition : « BOUCHER/BOUCHERE » → on ne garde que le premier.
    return [segments[0], segments.slice(2).join(' ')].filter(Boolean).join(' ');
  }
  return segments.join(' ');
}

/**
 * Ramène un intitulé d'offre à son métier, prêt à être recopié dans un email.
 * Renvoie une chaîne vide si le titre ne contenait que du bruit.
 */
export function cleanJobTitle(raw: string): string {
  let t = (raw || '').trim();
  if (!t) return '';

  t = t.replace(GENRE_COLLE, '$1');
  t = t.replace(GENRE, ' ');
  // L'enseigne d'abord : « MODELE INTERMARCHE » doit tomber en entier (le mot
  // « modèle » est traité comme du bruit, cf. BRUIT).
  t = t.replace(MARQUES, '$1 ').replace(/\s+/g, ' ');
  t = t.replace(INCLUSIF, '');
  // Contenu entre parenthèses : précision de contrat ou d'horaire neuf fois
  // sur dix (« (le dimanche 3h) », « (CDI - 36h75 hebdo) », « (76) »).
  t = t.replace(/\([^)]*\)/g, ' ');
  // Segments après une virgule ou un tiret cadratin : « Boucher, CDD temps
  // plein, à Neufchâtel-en-Bray » → on ne garde que la tête.
  t = t.split(/\s*[,–—]\s*/)[0];
  t = reduireAlternatives(t);
  // Tirets d'énumération isolés, ponctuation résiduelle.
  t = t.replace(/\s+-\s+/g, ' ').replace(/[«»"“”;:]+/g, ' ');

  const mots = t.split(/\s+/).filter(Boolean).filter(mot => !estBruit(mot));

  // « à Neufchâtel », « en journée » : une préposition en fin de titre n'a plus
  // d'objet une fois le bruit retiré.
  while (mots.length && /^(a|à|en|de|du|des|le|la|les|pour|par|sur|dans|et|au|aux)$/i.test(mots[mots.length - 1])) {
    mots.pop();
  }

  const propre = mots
    .map(mot => {
      const bas = mot.toLowerCase().replace(/[.]+$/, '');
      return ACCENTS[bas] ?? bas;
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Tout en minuscules : l'intitulé est destiné à être recopié au fil d'une
  // phrase d'email (« vous recherchez un employé vendeur poissonnerie »), pas
  // à ouvrir une phrase. Les sigles gardent leurs capitales (cf. ACCENTS).
  return propre;
}
