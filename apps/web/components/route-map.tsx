"use client";

import dynamic from "next/dynamic";

const RouteMapClient = dynamic(() => import("./route-map-client"), {
  ssr: false,
  loading: () => <div className="route-map-fallback">Loading route map…</div>,
});

export default function RouteMap() {
  return <RouteMapClient />;
}
