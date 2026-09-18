"use client";

import { memo, useEffect, useRef } from "react";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";

export type RouteStop = { label: string; time?: string; coordinate: [number, number] };

const DEFAULT_CENTER: [number, number] = [35.6812, 139.7671];
const ROUTE_PIN_COLORS = 5;

// A DEMO_MAP_ID works out of the box for AdvancedMarkerElement without any
// Cloud Console map-style setup — fine for our fixed, code-driven styling.
const GOOGLE_MAPS_MAP_ID = "DEMO_MAP_ID";

if (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) {
  setOptions({ key: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY, v: "weekly" });
}

function toLatLng(coordinate: [number, number]): google.maps.LatLngLiteral {
  return { lat: coordinate[0], lng: coordinate[1] };
}

function RouteMap({ stops }: { stops: RouteStop[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) return;
    let disposed = false;
    let markers: google.maps.marker.AdvancedMarkerElement[] = [];
    let polyline: google.maps.Polyline | null = null;
    let resizeObserver: ResizeObserver | null = null;

    (async () => {
      const [{ Map }, { AdvancedMarkerElement }] = await Promise.all([
        importLibrary("maps"),
        importLibrary("marker"),
      ]);
      if (disposed || !containerRef.current) return;

      const center = stops[0]?.coordinate ?? DEFAULT_CENTER;
      const map = mapRef.current ?? new Map(containerRef.current, {
        center: toLatLng(center),
        zoom: 12,
        mapId: GOOGLE_MAPS_MAP_ID,
        scrollwheel: false,
        disableDefaultUI: false,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: false,
      });
      mapRef.current = map;

      const infoWindow = new google.maps.InfoWindow();

      markers = stops.map((stop, index) => {
        const pin = document.createElement("span");
        pin.className = `route-pin route-pin-${index % ROUTE_PIN_COLORS}`;
        pin.textContent = String(index + 1);
        const marker = new AdvancedMarkerElement({ map, position: toLatLng(stop.coordinate), content: pin });
        marker.addListener("click", () => {
          infoWindow.setContent(`${stop.label}${stop.time ? ` · ${stop.time}` : ""}`);
          infoWindow.open({ map, anchor: marker });
        });
        return marker;
      });

      if (stops.length > 1) {
        polyline = new google.maps.Polyline({
          path: stops.map((stop) => toLatLng(stop.coordinate)),
          strokeOpacity: 0,
          icons: [{
            icon: { path: "M 0,-1 0,1", strokeOpacity: 0.8, strokeColor: "#212121", scale: 3 },
            offset: "0",
            repeat: "12px",
          }],
          map,
        });
      }

      const fit = () => {
        if (stops.length === 0) return;
        if (stops.length === 1) { map.setCenter(toLatLng(stops[0].coordinate)); map.setZoom(13); return; }
        const bounds = new google.maps.LatLngBounds();
        stops.forEach((stop) => bounds.extend(toLatLng(stop.coordinate)));
        map.fitBounds(bounds, 28);
      };
      fit();

      // Maps JS handles container resizes itself; we only refit when the box
      // genuinely changes size. Refitting on every callback loops: fitBounds
      // relayouts the canvas, which fires the observer again.
      let lastSize = "";
      resizeObserver = new ResizeObserver(([entry]) => {
        const { width, height } = entry.contentRect;
        const size = `${Math.round(width)}x${Math.round(height)}`;
        if (!width || !height || size === lastSize) return;
        lastSize = size;
        fit();
      });
      resizeObserver.observe(containerRef.current);
    })();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      markers.forEach((marker) => { marker.map = null; });
      polyline?.setMap(null);
    };
  }, [stops]);

  if (!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) {
    return <div className="route-map-live route-map-fallback">Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to show the route map.</div>;
  }

  return (
    <div className="route-map-live">
      <div ref={containerRef} className="route-map-canvas" />
      {stops.length > 0 && (
        <div className="route-map-key" aria-label="Stops in order">
          {stops.map((stop, index) => <span key={index}><i className={`route-pin-${index % ROUTE_PIN_COLORS}`}>{index + 1}</i><b>{stop.label}</b></span>)}
        </div>
      )}
    </div>
  );
}

// Editor state changes recreate the array even when the route is unchanged.
export default memo(RouteMap, (previous, next) =>
  previous.stops.length === next.stops.length && previous.stops.every((stop, index) => {
    const other = next.stops[index];
    return stop.label === other.label && stop.time === other.time
      && stop.coordinate[0] === other.coordinate[0] && stop.coordinate[1] === other.coordinate[1];
  }),
);
