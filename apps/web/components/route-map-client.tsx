"use client";

import { useEffect, useMemo } from "react";
import L from "leaflet";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

export type RouteStop = { label: string; time?: string; coordinate: [number, number] };

const DEFAULT_CENTER: [number, number] = [35.6812, 139.7671];
const ROUTE_PIN_COLORS = 5;

function numberIcon(n: number, colorIndex: number) {
  return L.divIcon({
    className: "route-pin-icon",
    html: `<span class="route-pin route-pin-${colorIndex % ROUTE_PIN_COLORS}">${n}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function FitRoute({ coordinates }: { coordinates: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    // A rAF queued by the observer can fire after MapContainer destroys the
    // map (StrictMode's throwaway mount does this on every dev page-load),
    // and invalidateSize on a destroyed map throws on _leaflet_pos.
    let disposed = false;
    let frame = 0;
    const fit = () => {
      if (disposed) return;
      map.invalidateSize({ animate: false });
      if (coordinates.length === 0) return;
      if (coordinates.length === 1) { map.setView(coordinates[0], 13, { animate: false }); return; }
      map.fitBounds(coordinates, { padding: [28, 28], animate: false });
    };
    const container = map.getContainer();
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(fit);
    });
    observer.observe(container);
    const timeout = window.setTimeout(fit, 100);
    fit();
    return () => {
      disposed = true;
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [map, coordinates]);
  return null;
}

export default function RouteMap({ stops }: { stops: RouteStop[] }) {
  const coordinates = useMemo(() => stops.map((stop) => stop.coordinate), [stops]);
  const center = coordinates[0] ?? DEFAULT_CENTER;

  return (
    <div className="route-map-live">
      <MapContainer center={center} zoom={12} scrollWheelZoom={false}>
        {/* CARTO's basemap tiles now 403 without an API key we don't have —
            plain OSM tiles need none. */}
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {coordinates.length > 1 && <Polyline positions={coordinates} pathOptions={{ color: "#212121", weight: 3, opacity: 0.8, dashArray: "7 7" }} />}
        {stops.map((stop, index) => (
          <Marker key={index} position={stop.coordinate} icon={numberIcon(index + 1, index)}>
            <Popup>{stop.label}{stop.time ? ` · ${stop.time}` : ""}</Popup>
          </Marker>
        ))}
        <FitRoute coordinates={coordinates} />
      </MapContainer>
      {stops.length > 0 && (
        <div className="route-map-key" aria-label="Stops in order">
          {stops.map((stop, index) => <span key={index}><i className={`route-pin-${index % ROUTE_PIN_COLORS}`}>{index + 1}</i><b>{stop.label}</b></span>)}
        </div>
      )}
    </div>
  );
}
