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

const DEFAULT_COLOR = '#94a3b8'; // slate, pour les deals sans enseigne
const LIGHT_GREY = '#cbd5e1';    // substitut visible pour les enseignes « blanches » (ex. Leclerc)

/**
 * Couleur d'affichage d'une enseigne : sa couleur, sauf si elle est vide ou
 * (quasi-)blanche — auquel cas on bascule sur un gris clair, sinon la pastille
 * serait invisible sur le fond de carte clair.
 */
export function displayColor(hex?: string | null): string {
  const c = (hex || '').trim();
  if (!c) return DEFAULT_COLOR;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (!m) return c.toLowerCase() === 'white' ? LIGHT_GREY : c;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.9 ? LIGHT_GREY : '#' + h;
}

/** Normalise un titre de colonne (minuscules, sans accents) pour une comparaison robuste. */
function normCol(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

export type DealStatus = 'demo' | 'lost' | 'active';

/**
 * Catégorise un deal d'après sa colonne :
 *  - « Démo prévue »   → 'demo'   (pastille + anneau vert)
 *  - « Pas intéressé »  → 'lost'   (pastille creuse, estompée)
 *  - toute autre étape (À appeler, À rappeler, Mail à envoyer/envoyé,
 *    Laissé coordonnées, Sans offres…) → 'active' (pastille pleine)
 */
export function dealStatus(columnTitle: string): DealStatus {
  const t = normCol(columnTitle);
  if (t === 'demo prevue') return 'demo';
  if (t === 'pas interesse') return 'lost';
  return 'active';
}

/** Pastille ronde colorée par enseigne ; l'état se lit à l'anneau vert / au creux. */
export function dotHtml(deal: Pick<MapDeal, 'brandColor' | 'columnTitle'>, size = 16): string {
  const color = displayColor(deal.brandColor);
  const status = dealStatus(deal.columnTitle);
  const common = `box-sizing:border-box;width:${size}px;height:${size}px;border-radius:50%;`;
  if (status === 'lost') {
    return `<div style="${common}background:#fff;border:${Math.max(3, size / 5)}px solid ${color};opacity:.9;box-shadow:0 1px 2px rgba(0,0,0,.35);"></div>`;
  }
  if (status === 'demo') {
    return `<div style="${common}background:${color};border:2px solid #fff;box-shadow:0 0 0 2.5px #16a34a,0 1px 2px rgba(0,0,0,.4);"></div>`;
  }
  return `<div style="${common}background:${color};border:2px solid #fff;box-shadow:0 1px 2px rgba(0,0,0,.4);"></div>`;
}

function dotIcon(deal: MapDeal): L.DivIcon {
  return L.divIcon({
    html: dotHtml(deal, 16),
    className: 'deal-dot',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -10],
  });
}

/** Recadre la vue pour englober tous les deals visibles (au chargement / filtrage). */
function FitBounds({ deals }: { deals: MapDeal[] }) {
  const map = useMap();
  useEffect(() => {
    if (deals.length === 0) return;
    const bounds = L.latLngBounds(deals.map((d) => [d.latitude, d.longitude] as [number, number]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
  }, [deals, map]);
  return null;
}

/** Recentre la carte sur un deal sélectionné dans la liste. */
function FlyTo({ focus }: { focus: { lat: number; lng: number; key: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (focus) map.flyTo([focus.lat, focus.lng], Math.max(map.getZoom(), 12), { duration: 0.7 });
  }, [focus, map]);
  return null;
}

interface Props {
  deals: MapDeal[];
  focus: { lat: number; lng: number; key: number } | null;
  onOpenDeal: (id: string) => void;
}

export default function DealsMap({ deals, focus, onOpenDeal }: Props) {
  return (
    <MapContainer
      center={[46.6, 2.4]}
      zoom={6}
      minZoom={5}
      scrollWheelZoom
      zoomControl
      style={{ height: '100%', width: '100%', background: '#eef1f5' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
        subdomains="abcd"
      />
      <FitBounds deals={deals} />
      <FlyTo focus={focus} />
      {deals.map((deal) => (
        <Marker key={deal.id} position={[deal.latitude, deal.longitude]} icon={dotIcon(deal)}>
          <Popup>
            <div
              role="button"
              onClick={() => onOpenDeal(deal.id)}
              title="Ouvrir la fiche du deal"
              style={{ fontSize: 13, lineHeight: 1.5, minWidth: 180, cursor: 'pointer' }}
            >
              <div style={{ fontWeight: 700, marginBottom: 2 }}>{deal.storeName}</div>
              {deal.brandName && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: displayColor(deal.brandColor), display: 'inline-block' }} />
                  <span style={{ color: '#475569' }}>{deal.brandName}</span>
                </div>
              )}
              <div style={{ color: '#64748b' }}>
                📍 {[deal.address, deal.postalCode, deal.city].filter(Boolean).join(', ')}
              </div>
              <div style={{ marginTop: 6 }}>
                <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: '#f1f5f9', color: '#334155' }}>
                  {deal.columnTitle}
                </span>
              </div>
              <div style={{ marginTop: 8, paddingTop: 7, borderTop: '1px solid #eef2f6', color: '#4f46e5', fontWeight: 600, fontSize: 12 }}>
                Ouvrir la fiche →
              </div>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
