"use client";
import { useEffect, useRef } from "react";
import type { Map as LeafletMap, CircleMarker, LayerGroup } from "leaflet";
import "leaflet/dist/leaflet.css";
import type { TrackPoint } from "@/lib/ride";

export type Segment = { from: number; to: number; color: string };

const CARTO_KEY = process.env.NEXT_PUBLIC_CARTO_API_KEY ?? "cb1_52ie_1_3fce4b7936cf62e3d1d9fc2f";
const hasGps = (p: TrackPoint): p is TrackPoint & { lat: number; lng: number } =>
  p.lat !== null && p.lng !== null && Number.isFinite(p.lat) && Number.isFinite(p.lng);

/** The route on a dark map, drawn in coloured stretches, with a dot following the graph's cursor. */
export function RideMap({ track, segments, cursor }: { track: TrackPoint[]; segments: Segment[]; cursor: number | null }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const dot = useRef<CircleMarker | null>(null);
  const L = useRef<typeof import("leaflet") | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((mod) => {
      if (cancelled || !el.current || map.current) return;
      L.current = mod;
      const m = mod.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
      mod
        .tileLayer(`https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(CARTO_KEY)}`, {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        })
        .addTo(m);
      map.current = m;
      layer.current = mod.layerGroup().addTo(m);
      const pts = track.filter(hasGps).map((p) => [p.lat, p.lng] as [number, number]);
      if (pts.length) m.fitBounds(mod.latLngBounds(pts), { padding: [24, 24] });
      draw();
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
    // The map is made once; the route redraws below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function draw() {
    const mod = L.current;
    if (!mod || !layer.current) return;
    layer.current.clearLayers();
    for (const seg of segments) {
      const pts = track.slice(seg.from, seg.to + 1).filter(hasGps).map((p) => [p.lat, p.lng] as [number, number]);
      if (pts.length > 1) mod.polyline(pts, { color: seg.color, weight: 4, opacity: 0.95 }).addTo(layer.current);
    }
    const start = track.find(hasGps);
    if (start) mod.circleMarker([start.lat, start.lng], { radius: 6, color: "#0b0f14", weight: 2, fillColor: "#e6edf3", fillOpacity: 1 }).bindTooltip("Start").addTo(layer.current);
  }

  useEffect(draw, [segments, track]);

  useEffect(() => {
    const mod = L.current;
    if (!mod || !map.current) return;
    const p = cursor === null ? null : track[cursor];
    if (!p || !hasGps(p)) {
      dot.current?.remove();
      dot.current = null;
      return;
    }
    if (!dot.current) dot.current = mod.circleMarker([p.lat, p.lng], { radius: 7, color: "#0b0f14", weight: 3, fillColor: "#38bdf8", fillOpacity: 1 }).addTo(map.current);
    else dot.current.setLatLng([p.lat, p.lng]);
  }, [cursor, track]);

  if (!track.some(hasGps)) {
    return <div className="flex h-[340px] items-center justify-center bg-sunk text-muted">This ride has no GPS.</div>;
  }
  return <div ref={el} className="h-[340px] w-full" role="region" aria-label="Map of the ride" />;
}
