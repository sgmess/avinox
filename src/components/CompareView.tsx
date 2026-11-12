"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { RideSummary } from "@/lib/ride";
import type { Comparison, Effort } from "@/lib/insights";
import { modeColor, modeName, modeRank, type Settings, type Units } from "@/lib/settings";
import { avgKmh, batteryDrop, modeParts, rideWhPerKm } from "@/lib/stats";
import { distUnit, fmtDate, fmtDist, fmtDuration, fmtHeight, fmtSpeed, n, perDist } from "@/lib/format";
import { Card, Empty, ModeBar, UnitSwitch } from "./ui";
import { defaultName } from "./RideView";

/**
 * A ride against others on the same roads and trails, and each of its climbs
 * against every other time it was ridden: assist use, effort and battery.
 */
export function CompareView({ ride, data, settings, efficiency, base }: { ride: RideSummary; data: Comparison; settings: Settings; efficiency: number; base: string }) {
  const [units, setUnits] = useState<Units>(settings.units);
  const s = useMemo(() => ({ ...settings, units }), [settings, units]);
  const title = ride.name || defaultName(ride, s.timeZone);
  const routeRides = [ride, ...data.similar.map((x) => x.ride)].sort((a, b) => a.start - b.start);
  const overlap = new Map(data.similar.map((x) => [x.ride.id, x.overlap]));

  return (
    <div className="mx-auto flex max-w-[1360px] flex-col gap-4 px-4 pt-6 pb-16 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`${base}/${ride.id}`} className="flex min-h-11 items-center gap-1.5 font-medium">
          <span aria-hidden="true">←</span> {title}
        </Link>
        <UnitSwitch units={units} onChange={setUnits} />
      </div>
      <div>
        <div className="text-muted">{fmtDate(ride.start, s.timeZone)}</div>
        <h1 className="mt-1 font-display text-3xl font-semibold">Compare {title.toLowerCase().startsWith("compare") ? "" : `“${title}”`}</h1>
      </div>

      <Card
        title="Same route"
        sub={
          data.similar.length
            ? `${data.similar.length} other ${data.similar.length === 1 ? "ride follows" : "rides follow"} mostly the same roads and trails, within a quarter of the distance.`
            : undefined
        }
      >
        {data.similar.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="py-2 pr-3 font-normal">Ride</th>
                  <th className="py-2 pr-3 font-normal">Distance</th>
                  <th className="py-2 pr-3 font-normal">Moving</th>
                  <th className="py-2 pr-3 font-normal">Avg speed</th>
                  <th className="py-2 pr-3 font-normal">Climbed</th>
                  <th className="w-40 py-2 pr-3 font-normal">Assist</th>
                  <th className="py-2 pr-3 font-normal">You did</th>
                  <th className="py-2 pr-3 font-normal">Battery</th>
                  <th className="py-2 font-normal">Wh/{distUnit(units)}</th>
                </tr>
              </thead>
              <tbody>
                {routeRides.map((r) => {
                  const kmh = avgKmh(r);
                  const wh = rideWhPerKm(r, s, efficiency);
                  const work = r.riderWh + r.motorWh;
                  return (
                    <tr key={r.id} className={`border-t border-line ${r.id === ride.id ? "bg-accent-soft/40" : ""}`}>
                      <td className="py-2 pr-3">
                        <RideLink r={r} base={base} tz={s.timeZone} current={r.id === ride.id} />
                        {overlap.has(r.id) && <div className="text-xs text-muted">{n(overlap.get(r.id)! * 100)}% same route</div>}
                      </td>
                      <td className="py-2 pr-3">{fmtDist(r.km, units)}</td>
                      <td className="py-2 pr-3">{fmtDuration(r.movingS)}</td>
                      <td className="py-2 pr-3">{kmh ? fmtSpeed(kmh, units) : "–"}</td>
                      <td className="py-2 pr-3">{fmtHeight(r.ascentM, units)}</td>
                      <td className="py-2 pr-3">
                        <ModeBar parts={modeParts(r, s)} className="h-2.5" />
                      </td>
                      <td className="py-2 pr-3">{work > 0 ? `${n((r.riderWh / work) * 100)}%` : "–"}</td>
                      <td className="py-2 pr-3">{batteryDrop(r) ? `${batteryDrop(r)}%` : "–"}</td>
                      <td className="py-2">{wh ? n(perDist(wh, units), 1) : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No other ride follows this route closely enough yet. Rides count as the same route when most of the roads and trails match and the distance is within a quarter.</Empty>
        )}
        <ModeLegend rides={routeRides} settings={s} />
      </Card>

      {data.climbs.length ? (
        data.climbs.map((c, i) => <ClimbCard key={c.climb.from} index={i} c={c} ride={ride} settings={s} base={base} />)
      ) : (
        <Card title="Climbs">
          <Empty>No climb of 40 m or more on this ride.</Empty>
        </Card>
      )}
    </div>
  );
}

function RideLink({ r, base, tz, current }: { r: RideSummary; base: string; tz: string; current: boolean }) {
  return (
    <Link href={`${base}/${r.id}`} className="font-medium">
      {fmtDate(r.start, tz)}
      <span className="block text-xs font-normal text-soft">
        {r.name || defaultName(r, tz)}
        {current ? " · this ride" : ""}
      </span>
    </Link>
  );
}

function ModeLegend({ rides, settings }: { rides: RideSummary[]; settings: Settings }) {
  const seen = [...new Set(rides.flatMap((r) => Object.keys(r.modeS)).filter((k) => Number(k) !== 0))].sort((a, b) => modeRank(settings, a) - modeRank(settings, b));
  return (
    <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
      {seen.map((k) => (
        <span key={k} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: modeColor(settings, k) }} />
          {modeName(settings, k)}
        </span>
      ))}
    </div>
  );
}

function effortParts(e: Effort, s: Settings) {
  return Object.entries(e.modes)
    .filter(([k, v]) => v > 0 && Number(k) !== 0)
    .sort(([a], [b]) => modeRank(s, a) - modeRank(s, b))
    .map(([k, v]) => ({ key: k, share: v, color: modeColor(s, k), name: modeName(s, k) }));
}

function ClimbCard({ index, c, ride, settings, base }: { index: number; c: Comparison["climbs"][number]; ride: RideSummary; settings: Settings; base: string }) {
  const u = settings.units;
  // A climb with part of it unrecorded has no known time, so it can't be the fastest.
  const whole = c.efforts.filter((x) => x.effort.gapS === 0);
  const fastest = whole.reduce<(typeof c.efforts)[number] | null>((a, b) => (!a || b.effort.seconds < a.effort.seconds ? b : a), null);
  return (
    <Card
      title={`Climb ${index + 1}: ${fmtDist(c.climb.km, u, 1)}, +${fmtHeight(c.climb.gainM, u)} at ${n(c.climb.gradePct, 1)}%`}
      sub={
        c.efforts.length > 1
          ? `Ridden ${c.efforts.length} times.${fastest ? ` Fastest ${fmtDuration(fastest.effort.seconds)} on ${fmtDate(fastest.ride.start, settings.timeZone)}.` : ""}`
          : "Only ridden on this ride so far."
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="py-2 pr-3 font-normal">Ride</th>
              <th className="py-2 pr-3 font-normal">Time</th>
              <th className="py-2 pr-3 font-normal">Speed</th>
              <th className="py-2 pr-3 font-normal">Your power</th>
              <th className="py-2 pr-3 font-normal">Motor power</th>
              <th className="w-40 py-2 pr-3 font-normal">Assist</th>
              <th className="py-2 font-normal">Battery</th>
            </tr>
          </thead>
          <tbody>
            {c.efforts.map(({ ride: r, effort: e }) => (
              <tr key={r.id} className={`border-t border-line ${r.id === ride.id ? "bg-accent-soft/40" : ""}`}>
                <td className="py-2 pr-3">
                  <RideLink r={r} base={base} tz={settings.timeZone} current={r.id === ride.id} />
                </td>
                <td className="py-2 pr-3">
                  {fmtDuration(e.seconds)}
                  {fastest && r.id === fastest.ride.id && whole.length > 1 && <span className="ml-1.5 rounded-full bg-good-soft px-1.5 text-[11px] text-good">fastest</span>}
                  {e.gapS > 0 && <div className="text-xs text-warn">plus {e.gapS < 60 ? `${Math.round(e.gapS)} s` : fmtDuration(e.gapS)} not recorded: figures cover the rest</div>}
                </td>
                <td className="py-2 pr-3">{e.seconds ? fmtSpeed(e.km / (e.seconds / 3600), u) : "–"}</td>
                <td className="py-2 pr-3">{e.seconds ? `${n((e.riderWh * 3600) / e.seconds)} W` : "–"}</td>
                <td className="py-2 pr-3">{e.seconds ? `${n((e.motorWh * 3600) / e.seconds)} W` : "–"}</td>
                <td className="py-2 pr-3">
                  <ModeBar parts={effortParts(e, settings)} className="h-2.5" />
                </td>
                <td className="py-2">{e.batteryPct !== null && e.batteryPct > 0 ? `${e.batteryPct}%` : e.batteryPct === 0 ? "under 1%" : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
