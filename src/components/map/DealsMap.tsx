'use client';
import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface MapDeal {
  id: string;
  storeName: string;
  brandName: string | null;
  brandColor: string | null;
  columnTitle: string;
  city: string;
  postalCode: string;
  address: string;
  priority: string;
  latitude: number;
  longitude: number;
}

const DEFAULT_COLOR = '#64748b'; // slate, pour les deals sans enseigne

/** Normalise un titre de colonne (minuscules, sans accents) pour une comparaison robuste. */
function normCol(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

export type DealStatus = 'demo' | 'lost' | 'active';

/**
 * Catégorise un deal d'après sa colonne :
 *  - « Démo prévue »   → 'demo'   (positif)
 *  - « Pas intéressé »  → 'lost'   (négatif)
 *  - toute autre étape (À appeler, À rappeler, Mail à envoyer, Mail envoyé,
 *    Laissé coordonnées, Sans offres…) → 'active' (en cours)
 */
export function dealStatus(columnTitle: string): DealStatus {
  const t = normCol(columnTitle);
  if (t === 'demo prevue') return 'demo';
  if (t === 'pas interesse') return 'lost';
  return 'active';
}

/** Couleur de remplissage d'un deal : sa couleur d'enseigne. */
export function fillColorFor(deal: Pick<MapDeal, 'brandColor'>): string {
  return deal.brandColor || DEFAULT_COLOR;
}

/**
 * Épingle SVG affinée (forme « goutte ») colorée selon l'enseigne. Une icône
 * au centre indique l'état : ✓ vert pour « Démo prévue », croix rouge pour
 * « Pas intéressé », simple point coloré pour les deals en cours.
 */
function pinIcon(deal: MapDeal): L.DivIcon {
  const fill = fillColorFor(deal);
  const status = dealStatus(deal.columnTitle);

  let glyph: string;
  if (status === 'demo') {
    glyph = `<path d="M10.6 13 l2.2 2.2 l4.6 -4.8" fill="none" stroke="#16a34a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
  } else if (status === 'lost') {
    glyph = `<path d="M11.2 10.2 L16.8 15.8 M16.8 10.2 L11.2 15.8" stroke="#dc2626" stroke-width="2.2" stroke-linecap="round"/>`;
  } else {
    glyph = `<circle cx="14" cy="13" r="2.7" fill="${fill}"/>`;
  }

  const svg = `
    <svg width="28" height="40" viewBox="0 0 28 40" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 1.5px 2px rgba(0,0,0,.28))">
      <path d="M14 2 C8.5 2 4 6.5 4 12 C4 19.5 14 38 14 38 C14 38 24 19.5 24 12 C24 6.5 19.5 2 14 2 Z"
            fill="${fill}" stroke="#ffffff" stroke-width="1.5"/>
      <circle cx="14" cy="13" r="6.2" fill="#ffffff"/>
      ${glyph}
    </svg>`;

  return L.divIcon({
    html: svg,
    className: 'deal-pin',
    iconSize: [28, 40],
    iconAnchor: [14, 38],
    popupAnchor: [0, -34],
  });
}

/** Ajuste la vue pour englober tous les deals au chargement / changement de jeu. */
function FitBounds({ deals }: { deals: MapDeal[] }) {
  const map = useMap();
  useEffect(() => {
    if (deals.length === 0) return;
    const bounds = L.latLngBounds(deals.map((d) => [d.latitude, d.longitude] as [number, number]));
    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 });
  }, [deals, map]);
  return null;
}

export default function DealsMap({ deals }: { deals: MapDeal[] }) {
  return (
    <MapContainer
      center={[46.6, 2.4]}
      zoom={6}
      minZoom={5}
      scrollWheelZoom
      style={{ height: '100%', width: '100%' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds deals={deals} />
      {deals.map((deal) => (
        <Marker key={deal.id} position={[deal.latitude, deal.longitude]} icon={pinIcon(deal)}>
          <Popup>
            <div style={{ fontSize: 13, lineHeight: 1.5, minWidth: 180 }}>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>{deal.storeName}</div>
              {deal.brandName && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: deal.brandColor || DEFAULT_COLOR,
                      display: 'inline-block',
                    }}
                  />
                  <span style={{ color: '#475569' }}>{deal.brandName}</span>
                </div>
              )}
              <div style={{ color: '#64748b' }}>
                📍 {[deal.address, deal.postalCode, deal.city].filter(Boolean).join(', ')}
              </div>
              <div style={{ marginTop: 6 }}>
                <span
                  style={{
                    display: 'inline-block',
                    padding: '2px 8px',
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 600,
                    background: '#eef2ff',
                    color: '#4338ca',
                  }}
                >
                  {deal.columnTitle}
                </span>
              </div>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
