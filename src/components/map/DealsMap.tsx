'use client';
import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, ZoomControl, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { basemap } from './basemap';

export interface MapDeal {
  id: string;
  storeName: string;
  brandName: string | null;
  brandColor: string | null;
  pipelineName: string;
  columnTitle: string;
  columnColor: string;
  columnPosition: number;
  city: string;
  postalCode: string;
  address: string;
  phone: string;
  priority: string;
  isPV: boolean;
  isClient: boolean;
  // Null quand le magasin n'a pas (encore) pu être géocodé.
  latitude: number | null;
  longitude: number | null;
}

/** Magasin localisé : les coordonnées sont garanties non nulles. */
export type LocatedDeal = MapDeal & { latitude: number; longitude: number };

export function isLocated(deal: MapDeal): deal is LocatedDeal {
  return deal.latitude != null && deal.longitude != null;
}

const DEFAULT_COLOR = '#8a8594'; // gris chaud, pour les magasins sans enseigne
const LIGHT_GREY = '#cbc5bb';    // substitut visible pour les enseignes « blanches » (ex. Leclerc)

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

/** Couleur de l'étape (colonne de pipeline), avec repli neutre. */
export function stageColor(hex?: string | null): string {
  return (hex || '').trim() || '#a9a294';
}

/**
 * Goutte du marqueur : remplie à la couleur de l'ENSEIGNE, cerclée à la couleur
 * de l'ÉTAPE du pipeline. On lit donc d'un coup d'œil « qui » et « où en est-on ».
 */
export function markerHtml(deal: Pick<MapDeal, 'brandColor' | 'columnColor'>, selected = false): string {
  const fill = displayColor(deal.brandColor);
  const ring = stageColor(deal.columnColor);
  const shadow = selected
    ? `0 0 0 3px ${ring}, 0 0 0 6px rgba(25,23,34,.16), 0 3px 8px rgba(0,0,0,.45)`
    : `0 0 0 2px ${ring}, 0 3px 7px rgba(0,0,0,.3)`;
  return `<div class="slm-marker${selected ? ' is-sel' : ''}" style="background:${fill};box-shadow:${shadow}"></div>`;
}

function markerIcon(deal: LocatedDeal, selected: boolean): L.DivIcon {
  return L.divIcon({
    html: markerHtml(deal, selected),
    className: '',
    iconSize: [18, 18],
    iconAnchor: [9, 18],
    popupAnchor: [0, -16],
  });
}

const zoneIcon = (): L.DivIcon =>
  L.divIcon({
    html: '<div class="slm-zonemarker"></div>',
    className: '',
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -28],
  });

/** Rayon (m) du cercle de prospection dessiné autour d'une zone recherchée. */
export const ZONE_RADIUS_M = 100000;

/** Vue par défaut : la France métropolitaine entière. */
const FRANCE_CENTER: [number, number] = [46.6, 2.4];
const FRANCE_ZOOM = 6;

/** Emprise de la France métropolitaine (Corse comprise). */
const METROPOLE = L.latLngBounds([41.0, -5.8], [51.5, 10.0]);

/**
 * Recadre la vue pour englober les magasins affichés. Le recadrage n'est
 * déclenché que lorsque l'ENSEMBLE affiché change réellement (chargement,
 * onglet, filtre, recherche) — pas à chaque rendu — pour ne pas défaire une
 * navigation manuelle de l'utilisateur.
 *
 * Le cadrage se limite aux magasins de métropole dès qu'il y en a : un magasin
 * d'outre-mer suffirait sinon à étirer la vue de la Bretagne à l'océan Indien,
 * et la carte s'ouvrirait centrée quelque part au-dessus de l'Afrique. Ce
 * magasin reste bien sur la carte — un clic sur sa ligne y emmène.
 */
function FitBounds({ deals }: { deals: LocatedDeal[] }) {
  const map = useMap();
  const signature = deals.map((d) => d.id).join(',');
  useEffect(() => {
    const points = deals.map((d) => [d.latitude, d.longitude] as [number, number]);
    const metropole = points.filter((p) => METROPOLE.contains(p));
    const target = metropole.length ? metropole : points;
    if (target.length === 0) {
      map.setView(FRANCE_CENTER, FRANCE_ZOOM);
      return;
    }
    map.fitBounds(L.latLngBounds(target), { padding: [50, 50], maxZoom: 12 });
    // On ne dépend que de la signature : `deals` change d'identité à chaque
    // rendu du parent alors que son contenu, lui, est souvent identique.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, map]);
  return null;
}

/** Recentre la carte sur un magasin sélectionné dans la liste. */
function FlyTo({ focus }: { focus: { lat: number; lng: number; key: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (focus) map.flyTo([focus.lat, focus.lng], Math.max(map.getZoom(), 12), { duration: 0.7 });
  }, [focus, map]);
  return null;
}

/** Cadre la vue sur la zone de prospection recherchée (rayon de 100 km). */
function ZoneFocus({ zone }: { zone: Zone | null }) {
  const map = useMap();
  useEffect(() => {
    if (!zone) return;
    map.fitBounds(L.latLng(zone.lat, zone.lng).toBounds(ZONE_RADIUS_M * 2), { padding: [40, 40] });
  }, [zone, map]);
  return null;
}

export interface Zone {
  lat: number;
  lng: number;
  label: string;
  key: number;
}

interface Props {
  deals: LocatedDeal[];
  focus: { lat: number; lng: number; key: number } | null;
  zone: Zone | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenDeal: (id: string) => void;
}

export default function DealsMap({ deals, focus, zone, selectedId, onSelect, onOpenDeal }: Props) {
  const zIcon = useMemo(() => zoneIcon(), []);
  const fond = useMemo(() => basemap(), []);

  return (
    <MapContainer
      center={FRANCE_CENTER}
      zoom={FRANCE_ZOOM}
      minZoom={5}
      scrollWheelZoom
      zoomControl={false}
      className={fond.desaturate ? 'slm-tiles-plain' : undefined}
      style={{ height: '100%', width: '100%' }}
    >
      <TileLayer
        attribution={fond.attribution}
        url={fond.url}
        subdomains={fond.subdomains}
        maxZoom={fond.maxZoom}
      />
      <ZoomControl position="topright" />
      <FitBounds deals={deals} />
      <FlyTo focus={focus} />
      <ZoneFocus zone={zone} />

      {zone && (
        <>
          <Circle
            center={[zone.lat, zone.lng]}
            radius={ZONE_RADIUS_M}
            pathOptions={{ color: '#7a5cff', weight: 2, dashArray: '6 7', fillColor: '#7a5cff', fillOpacity: 0.07 }}
          />
          <Marker position={[zone.lat, zone.lng]} icon={zIcon} zIndexOffset={2000}>
            <Popup>
              <div className="slm-pop">
                <b>{zone.label}</b>
                <span className="slm-pop-sub">Rayon de 100 km</span>
              </div>
            </Popup>
          </Marker>
        </>
      )}

      {deals.map((deal) => (
        <Marker
          key={deal.id}
          position={[deal.latitude, deal.longitude]}
          icon={markerIcon(deal, deal.id === selectedId)}
          eventHandlers={{ click: () => onSelect(deal.id) }}
        >
          <Popup>
            <div
              role="button"
              tabIndex={0}
              onClick={() => onOpenDeal(deal.id)}
              onKeyDown={(e) => { if (e.key === 'Enter') onOpenDeal(deal.id); }}
              title="Ouvrir la fiche de l'affaire"
              className="slm-pop"
              style={{ cursor: 'pointer' }}
            >
              <b>{deal.storeName}</b>
              {(() => {
                const place = [deal.address, [deal.postalCode, deal.city].filter(Boolean).join(' ')]
                  .filter(Boolean)
                  .join(', ');
                return place ? <span className="slm-pop-sub">{place}</span> : null;
              })()}
              {deal.phone && <span className="slm-pop-sub">{deal.phone}</span>}
              <div>
                <span
                  className="slm-pop-badge"
                  style={{ background: stageColor(deal.columnColor) + '22', color: stageColor(deal.columnColor) }}
                >
                  {deal.columnTitle}
                </span>{' '}
                <span className="slm-pop-badge" style={{ background: '#f3efe6', color: '#5b5766' }}>
                  {deal.pipelineName}
                </span>
              </div>
              <div className="slm-pop-open">Ouvrir la fiche →</div>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
