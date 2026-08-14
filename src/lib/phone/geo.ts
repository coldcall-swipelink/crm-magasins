// src/lib/phone/geo.ts
// Petits utilitaires géographiques partagés par les sources de numéros :
// distance entre deux points et déduction du département d'un magasin.

/** Distance à vol d'oiseau entre deux points (formule de haversine), en km. */
export function distanceKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Code département (INSEE) d'un magasin, déduit du champ `department` s'il est
 * exploitable, sinon du code postal. Gère la Corse (2A/2B, codes postaux 200xx
 * et 201xx–206xx) et l'outre-mer (codes postaux à 3 chiffres : 971–976).
 *
 * Renvoie une chaîne vide si rien n'est déductible : le magasin sera alors
 * traité par la recherche « autour du point » plutôt que par département.
 */
export function departmentCode(store: { department?: string | null; postalCode?: string | null }): string {
  const raw = (store.department || '').trim().toUpperCase();
  if (/^(2A|2B)$/.test(raw)) return raw;
  if (/^\d{1,3}$/.test(raw)) {
    const n = raw.padStart(2, '0');
    // 971–976 (outre-mer) restent à 3 chiffres ; le reste tient sur 2.
    if (n.length === 3 && n.startsWith('97')) return n;
    if (n.length === 3 && n.startsWith('0')) return n.slice(1);
    return n;
  }

  const cp = (store.postalCode || '').replace(/\D/g, '');
  if (cp.length !== 5) return '';
  if (cp.startsWith('97') || cp.startsWith('98')) return cp.slice(0, 3);
  if (cp.startsWith('20')) {
    // Corse : Corse-du-Sud (2A) en dessous de 20200 — Ajaccio et son bassin —,
    // Haute-Corse (2B) au-dessus (Bastia). Approximation volontairement simple :
    // le département ne sert qu'à cadrer la recherche, pas à identifier le magasin.
    return Number(cp) < 20200 ? '2A' : '2B';
  }
  return cp.slice(0, 2);
}
