"use client";

import dynamic from "next/dynamic";
import type { RouteStop } from "./route-map-client";

export type { RouteStop };

const RouteMapClient = dynamic(() => import("./route-map-client"), {
  ssr: false,
  loading: () => <div className="route-map-fallback">Loading route map…</div>,
});

export default function RouteMap({ stops }: { stops: RouteStop[] }) {
  return <RouteMapClient stops={stops} />;
}
