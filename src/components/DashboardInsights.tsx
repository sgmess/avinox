"use client";
import { useMemo, useState } from "react";
import type { Stats } from "@/lib/stats";
import { median } from "@/lib/stats";
import type { Settings, Units } from "@/lib/settings";
import { HILL_BANDS, climbModel, hillBands, planRide } from "@/lib/insights";
import { KM_PER_MI, dist, distUnit, fmtDate, height, heightUnit, n, perDist } from "@/lib/format";
import { Card, Empty } from "./ui";

const FT_PER_M = 3.28084;
/** Metres per km to feet per mile. */
const FT_PER_MI_PER_M_PER_KM = FT_PER_M * KM_PER_MI;

/* ---------- Range planner ---------- */

export function PlannerCard({ st, settings }: { st: Stats; settings: Settings }) {
  const u = settings.units;
  const model = useMemo(() => climbModel(st.rides, settings, st.efficiency), [st.rides, settings, st.efficiency]);
  const usual = useMemo(() => ({ km: median(st.rides.map((r) => r.km)) ?? 30, m: median(st.rides.map((r) => r.ascentM)) ?? 500 }), [st.rides]);
  // Typed in the rider's units, kept as text so the box can be cleared while typing.
  const [distance, setDistance] = useState(() => String(Math.round(dist(usual.km, u))));
  const [climb, setClimb] = useState(() => String(Math.round(height(usual.m, u) / 10) * 10));
  const [cold, setCold] = useState(false);
  const km = (Number(distance) || 0) * (u === "mi" ? KM_PER_MI : 1);
  const climbM = (Number(climb) || 0) / (u === "mi" ? FT_PER_M : 1);
  const usableWh = st.health?.usableWh ?? settings.batteryWh;
  const plan = planRide({ km, climbM }, st.modes, st.totals.whPerKm, model, usableWh, st.coldExtra);
  const input = "min-h-11 w-28 rounded-[10px] border border-edge bg-sunk px-3 text-sm";

  return (
    <Card title="Range planner" badge="New" sub="Enter a ride and see how much battery each mode would take, from your own rides.">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm text-muted">
          Distance ({distUnit(u)})
          <input className={input} type="number" min={0} max={500} inputMode="decimal" value={distance} onChange={(e) => setDistance(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted">
          Climbing ({heightUnit(u)})
          <input className={input} type="number" min={0} max={20000} step={u === "mi" ? 100 : 50} inputMode="numeric" value={climb} onChange={(e) => setClimb(e.target.value)} />
        </label>
        {st.coldExtra !== null && st.coldExtra > 0.02 && (
          <label className="flex min-h-11 items-center gap-2 text-sm text-soft">
            <input type="checkbox" checked={cold} onChange={(e) => setCold(e.target.checked)} />
            Below 10 °C
          </label>
        )}
      </div>
      {plan.length ? (
        <div className="mt-4 flex flex-col gap-2.5">
          {plan.map((p) => {
            const pct = cold && p.coldPct !== null ? p.coldPct : p.pct;
            const over = pct > 100;
            return (
              <div key={p.value} className="grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-3">
                <span className="flex items-center gap-2 text-sm">
                  <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: p.color }} />
                  {p.name}
                </span>
                <div className="h-3 overflow-hidden rounded bg-line">
                  <div className="h-3 rounded" style={{ width: `${Math.min(100, pct)}%`, background: over ? "var(--hot)" : p.color }} />
                </div>
                <span className={`w-36 text-right text-sm ${over ? "text-hot" : ""}`}>
                  <b>{over ? "over 100" : n(pct)}%</b> <span className="text-muted">· {over ? "won't make it" : `${n(100 - pct)}% left`}</span>
                </span>
              </div>
            );
          })}
          <p className="mt-1 text-xs text-muted">
            {model
              ? `On a full battery (${n(usableWh)} Wh usable). Climbing priced from ${model.rides} rides at ${n(model.whPerM * 100, 1)} Wh per 100 m.`
              : `On a full battery (${n(usableWh)} Wh usable). Climbing isn't counted yet: that needs ${8} or more rides with different amounts of climbing.`}{" "}
            Your speed and the weather move it either way.
          </p>
        </div>
      ) : (
        <Empty>Ride at least 10 minutes in a mode, a few times, and it shows up here.</Empty>
      )}
    </Card>
  );
}

/* ---------- Climbing efficiency ---------- */

/** Two decimals for short distances, so a small number doesn't read as 0.0. */
const flatEquivalent = (d: number) => n(d, d < 1 ? 2 : 1);

const BAND_NAMES: Record<(typeof HILL_BANDS)[number]["key"], string> = { flat: "Flat", rolling: "Rolling", hilly: "Hilly", steep: "Steep" };

function bandLabel(lo: number, hi: number, u: Units) {
  const f = (m: number) => n(u === "mi" ? m * FT_PER_MI_PER_M_PER_KM : m);
  const unit = u === "mi" ? "ft/mi" : "m/km";
  return hi === Infinity ? `${f(lo)}+ ${unit}` : lo === 0 ? `under ${f(hi)} ${unit}` : `${f(lo)}–${f(hi)} ${unit}`;
}

export function ClimbingCard({ st, settings }: { st: Stats; settings: Settings }) {
  const u = settings.units;
  const model = useMemo(() => climbModel(st.rides, settings, st.efficiency), [st.rides, settings, st.efficiency]);
  const bands = useMemo(() => hillBands(st.rides, settings, st.efficiency), [st.rides, settings, st.efficiency]);
  const shown = bands.filter((b) => b.whPerKm !== null);
  const max = Math.max(1, ...shown.map((b) => b.whPerKm!));
  // Per 100 m, or per 100 ft for miles.
  const per = u === "mi" ? 100 / FT_PER_M : 100;
  const flat = shown.find((b) => b.key === "flat");
  const steepest = shown[shown.length - 1];
  return (
    <Card title="Climbing efficiency" badge="New" sub="What climbing costs, and battery per distance on flat against hilly rides">
      {model ? (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-display text-[30px] font-semibold">{n(model.whPerM * per, 1)} Wh</span>
          <span className="text-muted">
            per 100 {heightUnit(u)} climbed · about as much as {flatEquivalent(dist((model.whPerM * per) / model.flatWhPerKm, u))} {distUnit(u)} on the flat ({n(perDist(model.flatWhPerKm, u), 1)} Wh/{distUnit(u)})
          </span>
        </div>
      ) : (
        <p className="text-sm text-muted">The cost per 100 {heightUnit(u)} needs {8} or more rides with different amounts of climbing.</p>
      )}
      {shown.length >= 2 ? (
        <>
          <div className="mt-4 flex h-[130px] items-end gap-2">
            {shown.map((b) => (
              <div key={b.key} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <span className="text-[11px] text-soft">{n(perDist(b.whPerKm!, u), 1)}</span>
                <div className="w-full rounded-md bg-accent" style={{ height: `${(b.whPerKm! / max) * 100}%`, minHeight: 4, opacity: 0.45 + 0.55 * (b.whPerKm! / max) }} />
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex gap-2 text-[11px] text-muted">
            {shown.map((b) => (
              <span key={b.key} className="flex-1 text-center">
                <b className="text-soft">{BAND_NAMES[b.key]}</b>
                <br />
                {bandLabel(b.lo, b.hi, u)}
                <br />
                {b.rides} {b.rides === 1 ? "ride" : "rides"}
              </span>
            ))}
          </div>
          {flat && steepest && steepest !== flat && (
            <p className="mt-3 text-[13px] text-soft">
              {BAND_NAMES[steepest.key]} rides use {n((steepest.whPerKm! / flat.whPerKm!) * 100 - 100)}% more battery per {u === "mi" ? "mile" : "km"} than flat ones.
            </p>
          )}
          <p className="mt-1 text-xs text-muted">Wh per {distUnit(u)} from the pack, by how much each ride climbed per {distUnit(u)}.</p>
        </>
      ) : (
        <Empty>Needs rides with different amounts of climbing.</Empty>
      )}
    </Card>
  );
}

/* ---------- Power and heart-rate trends ---------- */

type Metric = "rider" | "motor" | "hr" | "cadence";
const METRICS: { key: Metric; label: string; unit: string; colour: string }[] = [
  { key: "rider", label: "Your power", unit: "W", colour: "var(--ink)" },
  { key: "motor", label: "Motor power", unit: "W", colour: "var(--accent)" },
  { key: "hr", label: "Heart rate", unit: "bpm", colour: "#ff4d5e" },
  { key: "cadence", label: "Cadence", unit: "rpm", colour: "#d77cff" },
];
const ROLLING = 10;

export function TrendsCard({ st }: { st: Stats }) {
  const series = useMemo(() => {
    const pick: Record<Metric, (r: Stats["rides"][number]) => number | null | undefined> = {
      rider: (r) => r.riderWAvg,
      motor: (r) => r.motorWAvg,
      hr: (r) => r.hrAvg,
      cadence: (r) => r.cadenceAvg,
    };
    return Object.fromEntries(
      METRICS.map((m) => [m.key, st.rides.filter((r) => r.movingS >= 600).map((r) => ({ t: r.start, v: pick[m.key](r) ?? 0 })).filter((p) => p.v > 0)]),
    ) as Record<Metric, { t: number; v: number }[]>;
  }, [st.rides]);
  const available = METRICS.filter((m) => series[m.key].length >= 5);
  const [metric, setMetric] = useState<Metric>("rider");
  const m = available.find((x) => x.key === metric) ?? available[0];
  if (!m) {
    return (
      <Card title="Power and heart-rate trends" badge="New" className="lg:col-span-2">
        <Empty>Needs five or more rides imported since power and cadence were added. Re-import with Update existing rides to fill in older ones.</Empty>
      </Card>
    );
  }
  const pts = series[m.key];
  const trend = pts.map((_, i) => median(pts.slice(Math.max(0, i - ROLLING + 1), i + 1).map((p) => p.v))!);
  const lo = Math.min(...pts.map((p) => p.v)) * 0.9;
  const hi = Math.max(...pts.map((p) => p.v)) * 1.05;
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const x = (t: number) => 8 + ((t - t0) / Math.max(1, t1 - t0)) * 1104;
  const y = (v: number) => 172 - ((v - lo) / Math.max(1, hi - lo)) * 164;
  const firstTrend = trend[Math.min(trend.length - 1, ROLLING - 1)];
  const lastTrend = trend[trend.length - 1];
  const change = firstTrend ? lastTrend / firstTrend - 1 : 0;
  return (
    <Card
      title="Power and heart-rate trends"
      badge="New"
      className="lg:col-span-2"
      sub={`Average per ride (rides over 10 minutes). The line follows the last ${ROLLING} rides.${Math.abs(change) >= 0.03 && pts.length > ROLLING ? ` ${m.label} is ${n(Math.abs(change) * 100)}% ${change > 0 ? "higher" : "lower"} than in your first ${ROLLING} rides.` : ""}`}
    >
      <div className="mb-3 flex flex-wrap gap-2 text-[13px]">
        {available.map((a) => (
          <button
            key={a.key}
            type="button"
            aria-pressed={a.key === m.key}
            onClick={() => setMetric(a.key)}
            className={`min-h-9 rounded-full border px-3 ${a.key === m.key ? "border-accent bg-accent-soft text-[#7dd3fc]" : "border-edge text-soft hover:text-ink"}`}
          >
            {a.label}
          </button>
        ))}
      </div>
      <div className="flex">
        <div className="flex h-[180px] flex-col justify-between pr-2 text-right text-xs text-muted">
          <span>
            {n(hi)} {m.unit}
          </span>
          <span>
            {n(lo)} {m.unit}
          </span>
        </div>
        <svg viewBox="0 0 1120 180" preserveAspectRatio="none" className="h-[180px] min-w-0 flex-1" role="img" aria-label={`${m.label} per ride over time`}>
          {pts.map((p) => (
            <circle key={p.t} cx={x(p.t)} cy={y(p.v)} r="2.6" fill={m.colour} fillOpacity="0.45" />
          ))}
          <polyline points={pts.map((p, i) => `${x(p.t)},${y(trend[i])}`).join(" ")} fill="none" stroke={m.colour} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div className="mt-1 flex justify-between pl-12 text-xs text-muted">
        <span>{fmtDate(t0, st.timeZone)}</span>
        <span>
          latest {n(lastTrend)} {m.unit}
        </span>
        <span>{fmtDate(t1, st.timeZone)}</span>
      </div>
    </Card>
  );
}
