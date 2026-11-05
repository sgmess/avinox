"use client";
import { useEffect, useRef, useState } from "react";
import { ZONE_TORQUE, ZONE_WATTS, type RideSummary } from "@/lib/ride";
import type { Settings } from "@/lib/settings";
import { modeParts } from "@/lib/stats";
import { dist, distUnit, height, heightUnit, n, speedUnit } from "@/lib/format";
import { Card } from "./ui";
import { hasDetails, zoneLabels } from "./RideDetails";

/*
 * A 1080 × 1920 story image of one ride, drawn in the browser. The layout is
 * from the Instagram story in sgmess/avinox-stats (made by temon10).
 */

type Background = "gradient" | "photo" | "clear";
type Options = { title: string; handle: string; bike: string; background: Background; photo: HTMLImageElement | null; alpha: number; font: string };

const W = 1080;
const H = 1920;
const COL = { dist: "#22c993", elev: "#a3e635", dur: "#34a8ff", avg: "#8b8cff", max: "#ffc531", bat: "#ff6b8a", grade: "#ff8a33" };
const ZONES = ["#5aa9ff", "#2fd08a", "#ffd23f", "#ff8a33", "#ff4d5e"];
const PREFS = "rideStoryPrefs";

export function StoryImage({ ride, settings, title }: { ride: RideSummary; settings: Settings; title: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [handle, setHandle] = useState("");
  const [bike, setBike] = useState(settings.bikeName);
  const [heading, setHeading] = useState(title);
  const [background, setBackground] = useState<Background>("gradient");
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null);
  const [alpha, setAlpha] = useState(60);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => setHeading(title), [title]);
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS) ?? "{}");
      if (typeof p.handle === "string") setHandle(p.handle);
      if (typeof p.bike === "string" && p.bike) setBike(p.bike);
    } catch {
      // Private windows can refuse storage; the defaults are fine.
    }
    try {
      setCanShare(!!navigator.canShare?.({ files: [new File([""], "a.png", { type: "image/png" })] }));
    } catch {
      setCanShare(false);
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(PREFS, JSON.stringify({ handle, bike }));
    } catch {
      // As above.
    }
  }, [handle, bike]);

  useEffect(() => {
    let live = true;
    document.fonts.ready.then(() => {
      if (!live || !canvas.current) return;
      const css = getComputedStyle(document.body);
      const font = css.getPropertyValue("--font-grotesk").trim() || "'Segoe UI', Arial, sans-serif";
      draw(canvas.current, ride, settings, { title: heading || title, handle, bike, background, photo, alpha: alpha / 100, font });
    });
    return () => {
      live = false;
    };
  }, [ride, settings, heading, title, handle, bike, background, photo, alpha]);

  const fileName = () => `ride-${new Date(ride.start * 1000).toISOString().slice(0, 10)}-story${background === "clear" ? "-transparent" : ""}.png`;
  const blob = () => new Promise<Blob | null>((ok) => canvas.current?.toBlob(ok, "image/png") ?? ok(null));

  async function download() {
    const b = await blob();
    if (!b) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = fileName();
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function share() {
    const b = await blob();
    if (b) navigator.share({ files: [new File([b], fileName(), { type: "image/png" })] }).catch(() => {});
  }

  const field = "min-h-11 w-full rounded-lg border border-edge bg-sunk px-3 text-sm";
  return (
    <Card title="Story image" sub="A 1080 × 1920 picture of this ride for Instagram or anywhere else. It's made on this device; nothing is uploaded.">
      <div className="grid gap-5 md:grid-cols-[minmax(0,320px)_1fr]">
        <canvas
          ref={canvas}
          width={W}
          height={H}
          className="w-full max-w-[320px] rounded-xl border border-line"
          style={background === "clear" ? { background: "repeating-conic-gradient(#2a3442 0 25%, #1a222d 0 50%) 0 0 / 24px 24px" } : undefined}
          role="img"
          aria-label={`Story image for ${heading || title}`}
        />
        <div className="flex flex-col gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-muted">Title</span>
            <input value={heading} onChange={(e) => setHeading(e.target.value)} maxLength={60} className={field} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted">Your handle</span>
            <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@emtb_rider" maxLength={40} className={field} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted">Bike</span>
            <input value={bike} onChange={(e) => setBike(e.target.value)} placeholder="Avinox Drive" maxLength={60} className={field} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted">Background</span>
            <select value={background} onChange={(e) => setBackground(e.target.value as Background)} className={field}>
              <option value="gradient">Gradient</option>
              <option value="photo">Your photo</option>
              <option value="clear">Transparent (to lay over a photo in Instagram)</option>
            </select>
          </label>
          {background === "photo" && (
            <label className="flex flex-col gap-1">
              <span className="text-muted">Photo</span>
              <input
                type="file"
                accept="image/*"
                className="text-sm"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const img = new Image();
                  img.onload = () => setPhoto(img);
                  img.src = URL.createObjectURL(f);
                }}
              />
            </label>
          )}
          {background !== "gradient" && (
            <label className="flex flex-col gap-1">
              <span className="text-muted">Panel darkness {alpha}%</span>
              <input type="range" min={0} max={95} value={alpha} onChange={(e) => setAlpha(Number(e.target.value))} />
            </label>
          )}
          <div className="mt-1 flex flex-wrap gap-2">
            <button type="button" onClick={download} className="min-h-11 rounded-[10px] bg-accent px-4 font-semibold text-on-accent hover:opacity-90">
              Download PNG
            </button>
            {canShare && (
              <button type="button" onClick={share} className="min-h-11 rounded-[10px] border border-edge px-4 font-semibold hover:bg-white/5">
                Share
              </button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ---------- Drawing ---------- */

function resolve(colour: string) {
  if (!colour.startsWith("var(")) return colour;
  return getComputedStyle(document.documentElement).getPropertyValue(colour.slice(4, -1)).trim() || "#a78bfa";
}

function hexA(hex: string, a: number) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  return `rgba(${v >> 16},${(v >> 8) & 255},${v & 255},${a})`;
}

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

type Part = { t: string; size: number; col: string; w?: string; gap?: number };

function draw(cv: HTMLCanvasElement, ride: RideSummary, settings: Settings, o: Options) {
  const g = cv.getContext("2d");
  if (!g) return;
  const u = settings.units;
  const text = (s: string, x: number, y: number, size: number, col: string, opt: { w?: string; a?: CanvasTextAlign; ls?: string } = {}) => {
    g.font = `${opt.w ?? "600"} ${size}px ${o.font}`;
    g.fillStyle = col;
    g.textAlign = opt.a ?? "left";
    g.letterSpacing = opt.ls ?? "0px";
    g.fillText(s, x, y);
  };
  const width = (parts: Part[]) =>
    parts.reduce((total, p) => {
      g.font = `${p.w ?? "700"} ${p.size}px ${o.font}`;
      g.letterSpacing = "0px";
      return total + g.measureText(p.t).width + (p.gap ?? 10);
    }, 0);

  g.clearRect(0, 0, W, H);
  const photo = o.background === "photo" ? o.photo : null;
  const light = o.background === "gradient" || (o.background === "photo" && !photo);
  if (photo) {
    const sc = Math.max(W / photo.width, H / photo.height);
    g.drawImage(photo, (W - photo.width * sc) / 2, (H - photo.height * sc) / 2, photo.width * sc, photo.height * sc);
    const shade = g.createLinearGradient(0, 0, 0, H);
    shade.addColorStop(0, "rgba(0,0,0,.45)");
    shade.addColorStop(0.3, "rgba(0,0,0,.12)");
    shade.addColorStop(0.7, "rgba(0,0,0,.12)");
    shade.addColorStop(1, "rgba(0,0,0,.5)");
    g.fillStyle = shade;
    g.fillRect(0, 0, W, H);
  } else if (light) {
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#c9f3e4");
    bg.addColorStop(0.2, "#86bfb0");
    bg.addColorStop(0.36, "#1d3148");
    bg.addColorStop(0.5, "#0d1830");
    bg.addColorStop(1, "#050b17");
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
  }
  const C = light
    ? { h: "#07262a", sub: "#2a6358", lab: "#17413c", div: "rgba(7,38,42,.35)", fdiv: "#1d2b47", ft: "#f1f5ff", tag: "#7f90b3" }
    : { h: "#ffffff", sub: "#e3f3ec", lab: "#ffffff", div: "rgba(255,255,255,.5)", fdiv: "rgba(255,255,255,.4)", ft: "#ffffff", tag: "#e3f3ec" };
  const panelAlpha = light ? 0.84 : o.alpha;
  const panelEdge = light ? "#24324f" : "rgba(150,180,230,.4)";
  const panel = (x: number, y: number, w: number, h: number) => {
    rr(g, x, y, w, h, 30);
    g.fillStyle = `rgba(4,9,20,${panelAlpha})`;
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = panelEdge;
    g.stroke();
  };
  const shadow = (on: boolean) => {
    g.shadowColor = on ? "rgba(0,0,0,.65)" : "transparent";
    g.shadowBlur = on ? 14 : 0;
    g.shadowOffsetY = on ? 2 : 0;
  };

  // Header
  shadow(!light);
  text("Ride Stats", 80, 153, 46, C.h, { w: "700" });
  if (o.bike) text(o.bike, 80, 200, 28, C.sub);
  text(new Date(ride.start * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }), 1000, 153, 32, C.sub, { a: "right" });
  if (o.handle) text(o.handle, 1000, 200, 34, C.h, { a: "right", w: "700" });
  g.fillStyle = C.div;
  g.fillRect(80, 240, 920, 3);
  text("SINGLE RIDE TELEMETRY", 80, 299, 24, C.lab, { ls: "4px", w: "700" });
  let ts = 64;
  g.letterSpacing = "0px";
  for (; ts > 22; ts -= 2) {
    g.font = `700 ${ts}px ${o.font}`;
    if (g.measureText(o.title).width <= 920) break;
  }
  text(o.title, 80, 365, ts, C.h, { w: "700" });
  shadow(false);

  // Tiles
  const big = (t: string, col: string, gap = 8): Part => ({ t, size: 66, col, gap });
  const unit = (t: string, gap = 18): Part => ({ t, size: 30, col: "#9fb0d3", w: "500", gap });
  const tile = (x: number, y: number, label: string, parts: Part[]) => {
    panel(x, y, 440, 176);
    text(label, x + 32, y + 54, 24, "#9fb0d3", { ls: "2px", w: "500" });
    let cx = x + 32;
    for (const p of parts) {
      text(p.t, cx, y + 138, p.size, p.col, { w: p.w ?? "700" });
      cx += g.measureText(p.t).width + (p.gap ?? 10);
    }
  };
  const pair = (a: string, b: string, ca: string, cb: string, un: string) => {
    let size = 66;
    const parts = (sz: number): Part[] => [
      { t: a, size: sz, col: ca, gap: 12 },
      { t: "/", size: sz, col: "#9fb0d3", w: "500", gap: 12 },
      { t: b, size: sz, col: cb, gap: 14 },
      { t: un, size: 26, col: "#9fb0d3", w: "500" },
    ];
    while (size > 34 && width(parts(size)) > 376) size -= 2;
    return parts(size);
  };
  const minutes = Math.round((ride.end - ride.start) / 60);
  const duration = minutes < 60 ? [big(String(minutes), COL.dur), unit("min")] : [big(String(Math.floor(minutes / 60)), COL.dur, 6), unit("h", 16), big(String(minutes % 60), COL.dur, 6), unit("m")];
  const kmh = ride.movingS ? ride.km / (ride.movingS / 3600) : 0;
  const used = ride.batteryStart !== null && ride.batteryEnd !== null ? ride.batteryStart - ride.batteryEnd : null;
  const row = (i: number) => 410 + i * 196;
  tile(80, row(0), "DISTANCE", [big(n(dist(ride.km, u), 1), COL.dist), unit(distUnit(u))]);
  tile(560, row(0), "DURATION", duration);
  tile(80, row(1), "BATTERY USED", [big(used === null ? "–" : String(used), COL.bat), unit("%")]);
  tile(560, row(1), "ELEVATION GAIN", [big(`+${n(height(ride.ascentM, u))}`, COL.elev), unit(heightUnit(u))]);
  tile(80, row(2), "STEEPEST GRADIENT", [big(ride.gradeUpPct === undefined ? "–" : n(ride.gradeUpPct, 1), COL.grade), unit("%")]);
  tile(560, row(2), "AVG / MAX SPEED", pair(n(dist(kmh, u), 1), n(dist(ride.maxKmh, u), 1), COL.avg, COL.max, speedUnit(u)));

  // Assist modes
  const sy = row(2) + 176 + 26;
  panel(80, sy, 920, 240);
  text("SUPPORT LEVEL %", 116, sy + 64, 30, "#f1f5ff", { w: "700", ls: "1px" });
  const parts = modeParts(ride, settings).map((p) => ({ ...p, color: resolve(p.color) }));
  g.save();
  rr(g, 116, sy + 94, 848, 24, 12);
  g.clip();
  g.fillStyle = "#101a30";
  g.fillRect(116, sy + 94, 848, 24);
  let px = 116;
  for (const p of parts) {
    g.fillStyle = p.color;
    g.fillRect(px, sy + 94, p.share * 848, 24);
    px += p.share * 848;
  }
  g.restore();
  const chips = parts.slice(0, 4);
  const cw = chips.length ? (848 - (chips.length - 1) * 14) / chips.length : 0;
  chips.forEach((p, i) => {
    const x = 116 + i * (cw + 14);
    rr(g, x, sy + 144, cw, 70, 18);
    g.fillStyle = hexA(p.color, 0.13);
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = hexA(p.color, 0.6);
    g.stroke();
    const label = `${p.name} ${Math.round(p.share * 100)}%`;
    let size = 29;
    g.letterSpacing = "0px";
    for (; size > 18; size--) {
      g.font = `700 ${size}px ${o.font}`;
      if (g.measureText(label).width <= cw - 20) break;
    }
    text(label, x + cw / 2, sy + 190, size, p.color, { a: "center", w: "700" });
  });

  // Motor zones
  const zy = sy + 240 + 28;
  if (hasDetails(ride)) {
    const zones = (x: number, title: string, secs: number[], labels: string[]) => {
      panel(x, zy, 440, 360);
      text(title, x + 30, zy + 58, 25, "#f1f5ff", { w: "700" });
      const total = secs.reduce((a, b) => a + b, 0) || 1;
      labels.forEach((label, i) => {
        const y = zy + 120 + i * 54;
        const p = secs[i] / total;
        const ps = `(${p > 0 && p < 0.005 ? "<1" : Math.round(p * 100)}%)`;
        text(label, x + 30, y, 25, "#9fb0d3", { w: "500" });
        text(ps, x + 410, y, 25, ZONES[i], { a: "right", w: "700" });
        const pw = g.measureText(ps).width;
        const m = secs[i] > 0 && secs[i] < 30 ? "<1m" : `${Math.round(secs[i] / 60)}m`;
        text(m, x + 400 - pw, y, 25, "#f1f5ff", { a: "right", w: "700" });
      });
    };
    zones(80, "MOTOR TORQUE ZONES", ride.torqueZoneS ?? [], zoneLabels(ZONE_TORQUE, "Nm"));
    zones(560, "MOTOR POWER ZONES", ride.wattZoneS ?? [], zoneLabels(ZONE_WATTS, "W"));
  }

  // Footer
  const fy = zy + 360 + 38;
  shadow(!light);
  g.fillStyle = C.fdiv;
  g.fillRect(80, fy, 920, 3);
  text("Ride Stats", 80, fy + 60, 34, C.ft, { w: "600" });
  text("#eMTB #RideData", 1000, fy + 58, 26, C.tag, { a: "right", w: "500" });
  if (ride.unknownS) text(`Telemetry gaps: ${Math.round(ride.unknownS)} s left out of time-based stats`, 540, fy + 100, 20, C.tag, { a: "center", w: "500" });
  text("design by temon10", 540, fy + 142, 22, C.tag, { a: "center", w: "500", ls: "1px" });
  shadow(false);
}
