'use client';
import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { darkenHex } from '@/lib/utils';

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

// Colonnes qui modifient l'apparence de l'épingle.
const COL_NOT_INTERESTED = 'Pas intéressé';
const COL_DEMO = 'Démo prévue';
const DEFAULT_COLOR = '#64748b'; // slate, pour les deals sans enseigne

/** Couleur de remplissage d'un deal : couleur d'enseigne, assombrie si « Pas intéressé ». */
export function fillColorFor(deal: Pick<MapDeal, 'brandColor' | 'columnTitle'>): string {
  const base = deal.brandColor || DEFAULT_COLOR;
  return deal.columnTitle === COL_NOT_INTERESTED ? darkenHex(base, 0.4) : base;
}

/** Construit l'icône épingle SVG pour un deal (couleur enseigne + contour selon l'étape). */
function pinIcon(deal: MapDeal): L.DivIcon {
  const fill = fillColorFor(deal);
  const isDemo = deal.columnTitle === COL_DEMO;
  const stroke = isDemo ? '#16a34a' : '#ffffff';
  const strokeWidth = isDemo ? 3 : 1.5;

  const svg = `
    <svg width="28" height="40" viewBox="0 0 28 40" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))">
      <path d="M14 1C7.1 1 1.5 6.6 1.5 13.5C1.5 22.5 14 39 14 39C14 39 26.5 22.5 26.5 13.5C26.5 6.6 20.9 1 14 1Z"
            fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>
      <circle cx="14" cy="13.5" r="4.5" fill="#ffffff" fill-opacity="0.92"/>
    </svg>`;

  return L.divIcon({
    html: svg,
    className: 'deal-pin',
    iconSize: [28, 40],
    iconAnchor: [14, 39],
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
