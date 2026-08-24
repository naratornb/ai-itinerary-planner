"use client";

import { useEffect } from "react";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

const NARITA: [number, number] = [35.7719, 140.3929];
const SHIBUYA: [number, number] = [35.6595, 139.7005];

function FitRoute() {
  const map = useMap();
  useEffect(() => {
    const fit = () => {
      map.invalidateSize({ animate: false });
      map.fitBounds([NARITA, SHIBUYA], { padding: [28, 28], animate: false });
    };
    const container = map.getContainer();
    const observer = new ResizeObserver(() => window.requestAnimationFrame(fit));
    observer.observe(container);
    const timeout = window.setTimeout(fit, 100);
    fit();
    return () => {
      observer.disconnect();
      window.clearTimeout(timeout);
    };
  }, [map]);
  return null;
}

export default function RouteMap() {
  return (
    <div className="route-map-live">
      <MapContainer center={[35.715, 140.04]} zoom={9} scrollWheelZoom={false}>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Polyline positions={[NARITA, SHIBUYA]} pathOptions={{ color: "#212121", weight: 3, opacity: 0.8, dashArray: "7 7" }} />
        <CircleMarker center={NARITA} radius={7} pathOptions={{ color: "#fff", weight: 3, fillColor: "#D40119", fillOpacity: 1 }}><Popup>Narita Airport · 14:30</Popup></CircleMarker>
        <CircleMarker center={SHIBUYA} radius={7} pathOptions={{ color: "#fff", weight: 3, fillColor: "#0072EA", fillOpacity: 1 }}><Popup>Shibuya Crossing · 14:40</Popup></CircleMarker>
        <FitRoute />
      </MapContainer>
      <div className="route-map-key" aria-label="Route locations"><span><i className="narita-dot" />Narita</span><span><i className="shibuya-dot" />Shibuya</span></div>
    </div>
  );
}
