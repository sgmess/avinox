"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { RideSummary } from "@/lib/ride";
import { computeStats, median, type Stats } from "@/lib/stats";
import type { Settings, Units } from "@/lib/settings";
import { dist, distUnit, fmtDate, fmtDist, fmtHeight, fmtHours, fmtSpeed, height, monthLabel, n, perDist } from "@/lib/format";
import { ButtonLink, Card, Empty, Logo, Stat, UnitSwitch } from "./ui";
import { RideTable } from "./RideTable";

type Props = {
  rides: RideSummary[];
  settings: Settings;
  /** Where ride pages live: "/rides" or "/demo/rides". */
  base: string;
  demo?: boolean;
};

export function Dashboard({ rides, settings, base, demo }: Props) {
  const [units, setUnits] = useState<Units>(settings.units);
  const [month, setMonth] = useState<string | null>(null);
  const s = useMemo(() => ({ ...settings, units }), [settings, units]);
  const st = useMemo(() => computeStats(rides, s), [rides, s]);

  function changeUnits(u: Units) {
    setUnits(u);
    if (!demo) {
      fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...settings, units: u }) }).catch(() => undefined);
    }
  }

  const first = st.rides[0];
  const last = st.rides[st.rides.length - 1];

  return (
    <div className="mx-auto flex max-w-[1360px] flex-col gap-5 px-4 pt-6 pb-16 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4 pb-2">
        <div className="flex items-center gap-3.5">
          <Logo />
          <div>
            <h1 className="font-display text-[22px] font-bold">Ride Stats{demo && <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 align-middle text-xs text-accent">Demo</span>}</h1>
            <div className="text-[13px] text-muted">
              {[settings.bikeName, first && `${fmtDate(first.start, s.timeZone)} to ${fmtDate(last.start, s.timeZone)}`].filter(Boolean).join(" · ") || "No rides yet"}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <UnitSwitch units={units} onChange={changeUnits} />
          {demo ? (
            <ButtonLink href="/login" primary>
              Sign in to add yours
            </ButtonLink>
          ) : (
            <>
              <ButtonLink href="/settings">Settings</ButtonLink>
              <ButtonLink href="/import" primary>
                Import rides
              </ButtonLink>
            </>
          )}
        </div>
      </header>

      {!rides.length ? (
        <section className="rounded-2xl border border-line bg-card p-8 text-center">
          <h2 className="font-display text-xl font-semibold">Bring in your first rides</h2>
          <p className="mx-auto mt-2 max-w-xl text-soft">
            The Avinox Ride app keeps every ride on your phone as a file. Copy them across and drop them in, and this page fills with your miles, modes, range and battery health.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/import" primary>
              Import rides
            </ButtonLink>
            <ButtonLink href="/demo">See it with sample rides</ButtonLink>
          </div>
        </section>
      ) : (
        <>
          <Kpis st={st} units={units} />
          <div className="grid gap-4 lg:grid-cols-2">
            <MonthsCard st={st} units={units} selected={month} onSelect={setMonth} />
            <ModesCard st={st} units={units} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <RangeCard st={st} units={units} />
            <HealthCard st={st} settings={s} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <GearsCard st={st} />
            <TorqueCard st={st} />
          </div>
          <h2 className="mt-2 text-xs font-semibold tracking-[0.12em] text-accent uppercase">Weather and battery</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            <TempCard st={st} />
            <ColdCard st={st} units={units} />
          </div>
          <Records st={st} units={units} base={base} />
          <RideTable rides={st.rides} settings={s} efficiency={st.efficiency} base={base} month={month} onClearMonth={() => setMonth(null)} />
        </>
      )}
      <p className="text-center text-xs text-muted">
        {demo ? "Made-up rides, to show what the app does." : "Ride files are read in your browser. Only each ride's totals and a simplified route are saved to your account."}
      </p>
    </div>
  );
}

/** Charging at about 27p a kWh, with a tenth lost in the charger. */
const electricityCost = (packWh: number) => (packWh / 1000 / 0.9) * 0.27;

function Kpis({ st, units }: { st: Stats; units: Units }) {
  const t = st.totals;
  const everest = height(t.ascentM, "km") / 8849;
  const trend = t.thisYear && t.lastYear ? t.thisYear / t.lastYear - 1 : null;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <Stat label="Distance" value={fmtDist(t.km, units, 0)} sub={`${n(t.rides)} rides`} />
      <Stat label="Riding time" value={fmtHours(t.movingS)} sub={t.rides ? `about ${Math.round(t.movingS / t.rides / 60)} min a ride` : undefined} />
      <Stat label="Climbed" value={fmtHeight(t.ascentM, units)} sub={everest >= 1 ? `${n(everest, everest < 10 ? 1 : 0)} times up Everest` : undefined} />
      <Stat label="Battery used" value={`${n(t.wh / 1000, 1)} kWh`} sub={`about £${n(electricityCost(t.wh), 2)} of electricity`} />
      <Stat
        className="col-span-2 md:col-span-1"
        label="Efficiency"
        value={t.whPerKm ? `${n(perDist(t.whPerKm, units), 1)} Wh/${distUnit(units)}` : "–"}
        sub={trend === null ? "battery per " + (units === "mi" ? "mile" : "km") : `${n(Math.abs(trend) * 100)}% ${trend < 0 ? "better" : "worse"} than the year before`}
      />
    </div>
  );
}

function MonthsCard({ st, units, selected, onSelect }: { st: Stats; units: Units; selected: string | null; onSelect: (k: string | null) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...st.months.map((m) => m.km));
  const shown = st.months.find((m) => m.key === (hover ?? selected)) ?? null;
  const labelEvery = Math.max(1, Math.ceil(st.months.length / 6));
  return (
    <Card title={units === "mi" ? "Miles per month" : "Kilometres per month"} sub="Tap a month to list its rides below">
      <div className="mb-2 h-5 text-xs text-soft" aria-live="polite">
        {shown ? (
          <>
            <b className="text-ink">{monthLabel(shown.key)}</b> · {fmtDist(shown.km, units, 0)} · {shown.rides} rides · {fmtHeight(shown.ascentM, units)}
          </>
        ) : (
          " "
        )}
      </div>
      <div className="flex h-[200px] items-end gap-1 border-b border-edge">
        {st.months.map((m) => (
          <button
            key={m.key}
            type="button"
            aria-label={`${monthLabel(m.key)}: ${fmtDist(m.km, units, 0)}, ${m.rides} rides`}
            aria-pressed={selected === m.key}
            onMouseEnter={() => setHover(m.key)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(m.key)}
            onBlur={() => setHover(null)}
            onClick={() => onSelect(selected === m.key ? null : m.key)}
            className="group flex h-full flex-1 items-end"
          >
            <span
              className={`block w-full rounded-t ${selected === m.key ? "bg-ink" : "bg-accent group-hover:opacity-80"}`}
              style={{ height: `${Math.max(m.km ? 2 : 0, (m.km / max) * 100)}%` }}
            />
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex text-xs text-muted">
        {st.months.map((m, i) => (
          <span key={m.key} className="flex-1 overflow-visible whitespace-nowrap">
            {i % labelEvery === 0 ? monthLabel(m.key) : ""}
          </span>
        ))}
      </div>
    </Card>
  );
}

function ModesCard({ st, units }: { st: Stats; units: Units }) {
  const modes = st.modes.filter((m) => m.seconds >= 60);
  const max = Math.max(1, ...modes.map((m) => m.seconds));
  const total = modes.reduce((a, m) => a + m.seconds, 0);
  const top = [...modes].sort((a, b) => b.seconds - a.seconds)[0];
  const costed = modes.filter((m) => m.whPerKm && Number(m.value) !== 0);
  const cheap = costed.length > 1 ? costed.reduce((a, b) => (a.whPerKm! < b.whPerKm! ? a : b)) : null;
  const dear = costed.length > 1 ? costed.reduce((a, b) => (a.whPerKm! > b.whPerKm! ? a : b)) : null;
  return (
    <Card title="Assist modes" sub={`Time in each mode, and the battery each one uses per ${units === "mi" ? "mile" : "km"}`}>
      <div className="grid grid-cols-[72px_minmax(0,1fr)_64px_84px] items-center gap-x-3 gap-y-2.5">
        <div className="text-xs text-muted">Mode</div>
        <div className="text-xs text-muted">Time</div>
        <div className="text-right text-xs text-muted">Hours</div>
        <div className="text-right text-xs text-muted">Wh/{distUnit(units)}</div>
        {modes.map((m) => (
          <ModeRow key={m.value} m={m} max={max} units={units} />
        ))}
      </div>
      {top && total > 0 && (
        <p className="mt-4 rounded-[10px] bg-accent-soft/60 px-3.5 py-3 text-[13px] text-soft">
          {top.name} is {Math.round((top.seconds / total) * 100)}% of your riding.
          {cheap && dear && cheap !== dear && ` ${cheap.name} takes you ${n(dear.whPerKm! / cheap.whPerKm!, 1)} times as far as ${dear.name} on the same charge.`}
        </p>
      )}
    </Card>
  );
}

function ModeRow({ m, max, units }: { m: Stats["modes"][number]; max: number; units: Units }) {
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: m.color }} />
        {m.name}
      </div>
      <div className="h-3 rounded-md bg-line">
        <div className="h-3 rounded-md" style={{ width: `${Math.max(1.5, (m.seconds / max) * 100)}%`, background: m.color }} />
      </div>
      <div className="text-right">{n(m.seconds / 3600, m.seconds < 36000 ? 1 : 0)}</div>
      <div className="text-right font-semibold">{m.whPerKm ? n(perDist(m.whPerKm, units), 1) : "–"}</div>
    </>
  );
}

function RangeCard({ st, units }: { st: Stats; units: Units }) {
  return (
    <Card
      title="Range on a full battery"
      badge="New"
      sub={`Worked out from your own rides, on your usual hills${st.health ? `, with the battery at ${Math.round(st.health.pct)}%` : ""}`}
    >
      {st.range.length ? (
        <>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {st.range.map((r) => (
              <div key={r.value} className="rounded-xl border-t-[3px] bg-sunk p-3.5" style={{ borderTopColor: r.color }}>
                <div className="text-xs text-muted">{r.name}</div>
                <div className="mt-1 font-display text-[28px] leading-tight font-semibold">{n(dist(r.km, units))}</div>
                <div className="text-xs text-muted">
                  {units === "mi" ? "miles" : "km"}
                  {r.coldKm && <> · {n(dist(r.coldKm, units))} in the cold</>}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3.5 text-xs text-muted">If you rode only in that mode. Mixed rides land in between.</p>
        </>
      ) : (
        <Empty>Ride a few more times in each mode and the range for each shows up here.</Empty>
      )}
    </Card>
  );
}

function HealthCard({ st, settings }: { st: Stats; settings: Settings }) {
  const h = st.health;
  return (
    <Card title="Battery health" badge="New" sub="How much the motor gets out of each 1% of battery, your first rides against your latest">
      {h ? (
        <>
          <div className="flex flex-wrap items-baseline gap-2.5">
            <span className="font-display text-[30px] font-semibold">{Math.round(h.pct)}%</span>
            <span className="text-muted">
              of when you started · about {n(h.usableWh)} of {n(settings.batteryWh)} Wh · {h.pct >= 90 ? "normal wear" : h.pct >= 80 ? "worth keeping an eye on" : "ask your dealer to test it"}
            </span>
          </div>
          <LineChart points={h.series.map((p) => ({ t: p.t, v: p.pct }))} lo={Math.min(80, ...h.series.map((p) => p.pct))} hi={Math.max(105, ...h.series.map((p) => p.pct))} label="Battery health over time" tz={st.timeZone} />
          <p className="mt-1 text-xs text-muted">From rides that used at least 20% of the battery. Cold rides read a little low.</p>
        </>
      ) : (
        <Empty>Needs about a dozen rides that each use at least 20% of the battery.</Empty>
      )}
    </Card>
  );
}

function LineChart({ points, lo, hi, label, tz }: { points: { t: number; v: number }[]; lo: number; hi: number; label: string; tz: string }) {
  if (points.length < 2) return null;
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * 560;
  const y = (v: number) => 130 - ((v - lo) / (hi - lo)) * 120;
  return (
    <>
      <svg viewBox="0 0 560 140" preserveAspectRatio="none" className="mt-2 h-[140px] w-full" role="img" aria-label={label}>
        {[0, 0.5, 1].map((f) => (
          <line key={f} x1="0" x2="560" y1={10 + f * 120} y2={10 + f * 120} stroke="var(--line)" vectorEffect="non-scaling-stroke" />
        ))}
        <polyline points={points.map((p) => `${x(p.t)},${y(p.v)}`).join(" ")} fill="none" stroke="var(--ink)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-xs text-muted">
        <span>{fmtDate(t0, tz)}</span>
        <span>{fmtDate(t1, tz)}</span>
      </div>
    </>
  );
}

function GearsCard({ st }: { st: Stats }) {
  const max = Math.max(0.0001, ...st.gears.map((g) => g.share));
  return (
    <Card title="Gear use" sub="Share of riding time in each gear, 1 is the easiest">
      {st.gears.length ? (
        <>
          <div className="flex h-[170px] items-end gap-2 border-b border-edge">
            {st.gears.map((g) => (
              <div key={g.gear} className="flex h-full flex-1 flex-col justify-end" title={`Gear ${g.gear}: ${n(g.share * 100, 1)}%`}>
                <div className="rounded-t bg-accent" style={{ height: `${(g.share / max) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex gap-2 text-xs text-muted">
            {st.gears.map((g) => (
              <span key={g.gear} className="flex-1 text-center">
                {g.gear}
              </span>
            ))}
          </div>
        </>
      ) : (
        <Empty>Your rides don&apos;t record gears. Bikes with electronic shifting paired to the motor do.</Empty>
      )}
    </Card>
  );
}

function TorqueCard({ st }: { st: Stats }) {
  const t = st.torque;
  const max = Math.max(1, ...t.bands.map((b) => b.seconds));
  return (
    <Card
      title="Motor torque"
      sub={
        t.underFifty === null ? (
          "Time at each torque"
        ) : (
          <>
            <b className="text-xl text-ink">{n(t.underFifty * 100, 1)}%</b> of the time under 50 Nm. The hardest-working ranges, highest {n(t.max)} Nm:
          </>
        )
      }
    >
      <div className="grid grid-cols-[100px_minmax(0,1fr)_112px] items-center gap-x-3 gap-y-2">
        {t.bands.map((b) => (
          <TorqueRow key={b.label} b={b} max={max} />
        ))}
      </div>
    </Card>
  );
}

function TorqueRow({ b, max }: { b: Stats["torque"]["bands"][number]; max: number }) {
  return (
    <>
      <div className="text-soft">{b.label}</div>
      <div className="h-3">
        {b.seconds > 0 && <div className="h-3 rounded" style={{ width: `${Math.max(1, (b.seconds / max) * 100)}%`, background: b.hot ? "var(--hot)" : "var(--accent)" }} />}
      </div>
      <div className="text-xs text-muted">{b.seconds ? `${fmtHours(b.seconds)} · ${b.share < 0.001 ? "< 0.1" : n(b.share * 100, 1)}%` : "never"}</div>
    </>
  );
}

function TempCard({ st }: { st: Stats }) {
  const pts = st.temps;
  if (pts.length < 2)
    return (
      <Card title="Temperature per ride">
        <Empty>Your rides don&apos;t record a temperature yet.</Empty>
      </Card>
    );
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const lo = Math.min(0, ...pts.map((p) => p.min));
  const hi = Math.max(40, ...pts.map((p) => p.max));
  const x = (t: number) => 8 + ((t - t0) / Math.max(1, t1 - t0)) * 544;
  const y = (v: number) => 172 - ((v - lo) / (hi - lo)) * 164;
  const trend = pts.map((_, i) => median(pts.slice(Math.max(0, i - 9), i + 1).map((p) => p.max))!);
  const coldest = pts.reduce((a, b) => (b.min < a.min ? b : a));
  const hottest = pts.reduce((a, b) => (b.max > a.max ? b : a));
  return (
    <Card title="Temperature per ride" sub="From the bike's sensor. Orange is the highest on each ride, blue the lowest, the line follows the last 10 rides' highs.">
      <div className="flex">
        <div className="flex h-[180px] flex-col justify-between pr-2 text-right text-xs text-muted">
          <span>{Math.round(hi)} °C</span>
          <span>{Math.round(lo)} °C</span>
        </div>
        <svg viewBox="0 0 560 180" preserveAspectRatio="none" className="h-[180px] min-w-0 flex-1" role="img" aria-label="Lowest and highest temperature on each ride">
          {pts.map((p) => (
            <g key={p.t}>
              <circle cx={x(p.t)} cy={y(p.max)} r="2.4" fill="#f59e0b" fillOpacity="0.75" />
              <circle cx={x(p.t)} cy={y(p.min)} r="2.4" fill="#38bdf8" fillOpacity="0.75" />
            </g>
          ))}
          <polyline points={pts.map((p, i) => `${x(p.t)},${y(trend[i])}`).join(" ")} fill="none" stroke="var(--ink)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div className="mt-1 flex justify-between pl-10 text-xs text-muted">
        <span>{fmtDate(t0, st.timeZone)}</span>
        <span>{fmtDate(t1, st.timeZone)}</span>
      </div>
      <p className="mt-3 text-xs text-muted">
        Coldest: {n(coldest.min)} °C on {fmtDate(coldest.t, st.timeZone)} · Hottest: {n(hottest.max)} °C on {fmtDate(hottest.t, st.timeZone)}
      </p>
    </Card>
  );
}

function ColdCard({ st, units }: { st: Stats; units: Units }) {
  const bands = st.tempBands.filter((b) => b.whPerKm);
  const max = Math.max(...bands.map((b) => b.whPerKm!), 1);
  const min = Math.min(...bands.map((b) => b.whPerKm!), max) * 0.7;
  return (
    <Card title="Cold costs range" badge="New" sub={`Battery per ${units === "mi" ? "mile" : "km"} by the coldest temperature on the ride`}>
      {bands.length >= 2 ? (
        <>
          <div className="flex h-[150px] items-end gap-2">
            {bands.map((b) => (
              <div key={b.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <span className="text-[11px] text-soft">{n(perDist(b.whPerKm!, units), 1)}</span>
                <div className="w-full rounded-md" style={{ height: `${((b.whPerKm! - min) / (max - min)) * 100}%`, minHeight: 4, background: b.label.startsWith("Under") || b.label.startsWith("5") ? "#7dd3fc" : "var(--edge)" }} />
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex gap-2 text-[11px] text-muted">
            {bands.map((b) => (
              <span key={b.label} className="flex-1 text-center">
                {b.label}
                <br />
                {b.rides} rides
              </span>
            ))}
          </div>
          {st.coldExtra !== null && (
            <p className="mt-3 text-[13px] text-soft">
              {st.coldExtra > 0.02
                ? `Below 10 °C you use ${Math.round(st.coldExtra * 100)}% more battery per ${units === "mi" ? "mile" : "km"} than above 15 °C, so expect less range in winter.`
                : "Cold weather hardly changes how much battery you use."}{" "}
              <span className="text-muted">
                From {st.coldRides.cold} {st.coldRides.cold === 1 ? "ride" : "rides"} below 10 °C and {st.coldRides.mild} above 15 °C.
              </span>
            </p>
          )}
          {st.coldExtra === null && (
            <p className="mt-3 text-[13px] text-muted">
              Needs at least 3 rides below 10 °C and 3 above 15 °C to say what the cold costs (so far {st.coldRides.cold} and {st.coldRides.mild}).
            </p>
          )}
        </>
      ) : (
        <Empty>Needs rides in a few different temperatures.</Empty>
      )}
    </Card>
  );
}

function Records({ st, units, base }: { st: Stats; units: Units; base: string }) {
  const r = st.records;
  const items = [
    r.longest && { label: "Longest ride", value: fmtDist(r.longest.km, units), ride: r.longest },
    r.climb && { label: "Biggest climb", value: fmtHeight(r.climb.ascentM, units), ride: r.climb },
    r.speed && { label: "Top speed", value: fmtSpeed(r.speed.maxKmh, units), ride: r.speed },
    r.time && { label: "Longest time out", value: fmtHours(r.time.movingS), ride: r.time },
    r.coldest && r.coldest.tempMin !== null && { label: "Coldest ride", value: `${n(r.coldest.tempMin)} °C`, ride: r.coldest },
  ].filter(Boolean) as { label: string; value: string; ride: RideSummary }[];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {items.map((i) => (
        <Link key={i.label} href={`${base}/${i.ride.id}`} className="rounded-2xl border border-line bg-card px-4 py-4 !text-ink hover:border-edge">
          <div className="text-xs text-muted">{i.label}</div>
          <div className="mt-1 font-display text-[22px] font-semibold">{i.value}</div>
          <div className="text-xs text-accent">{fmtDate(i.ride.start, st.timeZone)}</div>
        </Link>
      ))}
    </div>
  );
}
