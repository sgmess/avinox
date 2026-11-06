"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import "leaflet/dist/leaflet.css";
import type { HeatRoute } from "@/lib/heat";
import { n } from "@/lib/format";

const CARTO_KEY = process.env.NEXT_PUBLIC_CARTO_API_KEY ?? "cb1_52ie_1_3fce4b7936cf62e3d1d9fc2f";

/**
 * Every route on one dark map, each drawn faintly so roads and trails ridden
 * often build up into bright lines. Click a line to open that ride.
 */
export function Heatmap({ routes, base, timeZone, back }: { routes: HeatRoute[]; base: string; timeZone: string; back: string }) {
  const years = useMemo(
    () => [...new Set(routes.map((r) => new Date(r.start * 1000).toLocaleString("en-GB", { timeZone, year: "numeric" })))].sort(),
    [routes, timeZone],
  );
  const [year, setYear] = useState<string | null>(null);
  const shown = useMemo(
    () => (year ? routes.filter((r) => new Date(r.start * 1000).toLocaleString("en-GB", { timeZone, year: "numeric" }) === year) : routes),
    [routes, year, timeZone],
  );
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const L = useRef<typeof import("leaflet") | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((mod) => {
      if (cancelled || !el.current || map.current) return;
      L.current = mod;
      // Canvas draws hundreds of lines far faster than SVG.
      const m = mod.map(el.current, { preferCanvas: true, zoomControl: true, scrollWheelZoom: true });
      mod
        .tileLayer(`https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(CARTO_KEY)}`, {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        })
        .addTo(m);
      map.current = m;
      layer.current = mod.layerGroup().addTo(m);
      setReady(true);
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const mod = L.current;
    if (!ready || !mod || !map.current || !layer.current) return;
    layer.current.clearLayers();
    // Fainter lines when there are many, so only the busiest stretches glow.
    const opacity = Math.max(0.12, Math.min(0.6, 6 / Math.max(1, shown.length)));
    for (const r of shown) {
      mod
        .polyline(r.points, { color: "#ff6b3d", weight: 3, opacity })
        .on("click", () => {
          location.href = `${base}/${r.id}`;
        })
        .addTo(layer.current);
    }
    const all = shown.flatMap((r) => r.points);
    if (all.length) map.current.fitBounds(mod.latLngBounds(all), { padding: [24, 24] });
  }, [ready, shown, base]);

  return (
    <div className="mx-auto flex max-w-[1360px] flex-col gap-4 px-4 pt-6 pb-16 sm:px-6">
      <Link href={back} className="flex min-h-11 items-center gap-1.5 font-medium">
        <span aria-hidden="true">←</span> Dashboard
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold">Ride heatmap</h1>
          <p className="text-muted">
            {n(shown.length)} {shown.length === 1 ? "route" : "routes"}. The brighter the line, the more often you&apos;ve ridden it. Click a line to open the ride.
          </p>
        </div>
        {years.length > 1 && (
          <div className="flex flex-wrap gap-2 text-[13px]" role="group" aria-label="Year">
            {[null, ...years].map((y) => (
              <button
                key={y ?? "all"}
                type="button"
                aria-pressed={year === y}
                onClick={() => setYear(y)}
                className={`min-h-9 rounded-full border px-3 ${year === y ? "border-accent bg-accent-soft text-[#7dd3fc]" : "border-edge text-soft hover:text-ink"}`}
              >
                {y ?? "All years"}
              </button>
            ))}
          </div>
        )}
      </div>
      {routes.length ? (
        <section className="overflow-hidden rounded-2xl border border-line bg-card">
          <div ref={el} className="h-[70vh] min-h-[420px] w-full" role="region" aria-label="Map of all your routes" />
        </section>
      ) : (
        <p className="rounded-2xl border border-line bg-card p-8 text-center text-muted">None of your rides have GPS yet.</p>
      )}
    </div>
  );
}
