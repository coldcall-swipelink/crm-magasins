// src/components/map/basemap.ts
/**
 * Fond de carte des magasins.
 *
 * CARTO a rendu ses fonds payants : sans clé, ses tuiles reviennent barrées
 * d'un filigrane « API KEY REQUIRED ». Deux façons de s'en sortir, et le CRM
 * accepte les deux :
 *
 *   • avec NEXT_PUBLIC_CARTO_API_KEY : on retrouve le fond CARTO d'origine
 *     (gris clair, étiquettes discrètes), celui pour lequel la carte a été
 *     dessinée. Une clé gratuite suffit (carto.com/basemaps/apikey) ;
 *
 *   • sans clé : on bascule sur les tuiles d'OpenStreetMap, libres et sans
 *     inscription. Elles sont en couleurs, donc plus bavardes sous 3 000
 *     épingles — d'où la désaturation appliquée côté CSS (cf. map.css,
 *     .slm-tiles-plain), qui leur redonne l'allure grise attendue.
 *
 * La variable est lue à la construction : elle doit porter le préfixe
 * NEXT_PUBLIC_ pour parvenir jusqu'au navigateur, qui est seul à charger les
 * tuiles.
 */

const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ' +
  '&copy; <a href="https://carto.com/attributions">CARTO</a>';
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export type Basemap = {
  url: string;
  attribution: string;
  /** Sous-domaines à alterner ; vide quand l'hôte est unique. */
  subdomains: string;
  maxZoom: number;
  /** Vrai quand les tuiles sont en couleurs et doivent être adoucies. */
  desaturate: boolean;
};

export function basemap(): Basemap {
  const key = process.env.NEXT_PUBLIC_CARTO_API_KEY?.trim();

  if (key) {
    return {
      // {r} vaut « @2x » sur les écrans à forte densité : CARTO sert alors des
      // tuiles doubles, nettement plus nettes.
      url: `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?api_key=${encodeURIComponent(key)}`,
      attribution: CARTO_ATTRIBUTION,
      subdomains: 'abcd',
      maxZoom: 19,
      desaturate: false,
    };
  }

  return {
    // Hôte unique et pas de {r} : le serveur d'OpenStreetMap ne propose ni
    // sous-domaines ni tuiles doubles.
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: OSM_ATTRIBUTION,
    subdomains: '',
    maxZoom: 19,
    desaturate: true,
  };
}
