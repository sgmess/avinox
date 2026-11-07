"use client";
import { useState } from "react";
import { MAX_GEAR, ZONE_TORQUE, ZONE_WATTS, type RideSummary } from "@/lib/ride";
import { fmtDist, fmtDuration, n } from "@/lib/format";
import type { Units } from "@/lib/settings";
import { Card } from "./ui";

/*
 * The per-ride stats from sgmess/avinox-stats: power, cadence, motor zones,
 * gears and gradients. Rides imported before these existed show a prompt to
 * import them again instead.
 */

const ZONE_COLOURS = ["#5aa9ff", "#2fd08a", "#ffd23f", "#ff8a33", "#ff4d5e"];
const TORQUE_NAMES = ["Cruising / flat", "Moderate incline", "Technical climb", "Steep pitch", "Peak burst"];
const WATT_NAMES = ["Low assist", "Endurance output", "Trail power", "High demand", "Max surge"];

export function zoneLabels(limits: number[], unit: string) {
  return [0, 1, 2, 3, 4].map((i) => (i === 0 ? `0–${limits[0]} ${unit}` : i === 4 ? `over ${limits[3]} ${unit}` : `${limits[i - 1]}–${limits[i]} ${unit}`));
}

const pct = (part: number, total: number) => {
  if (!total || !part) return "0%";
  const p = (part / total) * 100;
  return p < 0.5 ? "<1%" : `${Math.round(p)}%`;
};
const mins = (s: number) => (s > 0 && s < 30 ? "<1 min" : fmtDuration(s));

export function hasDetails(ride: RideSummary) {
  return ride.observedS !== undefined && Array.isArray(ride.wattZoneS);
}

export function RideDetails({ ride, units }: { ride: RideSummary; units: Units }) {
  if (!hasDetails(ride)) {
    return (
      <p className="rounded-2xl border border-line bg-card px-5 py-4 text-[13px] text-soft">
        Power, cadence, motor zones, gear changes and gradients need this ride&apos;s file again. On the Import page, select{" "}
        <b className="text-ink">Update existing rides</b> and drop the folder: ride names are kept.
      </p>
    );
  }
  const riderKj = ride.riderKj ?? ride.riderWh * 3.6;
  return (
    <>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-3 xl:grid-cols-6">
        <Pair label="Motor power" avg={`${n(ride.motorWAvg ?? 0)} W`} max={`${n(ride.motorWMax ?? 0)} W`} hint="Average over the time the motor was helping" />
        <Pair label="Your power" avg={`${n(ride.riderWAvg ?? 0)} W`} max={`${n(ride.riderWMax ?? 0)} W`} hint="Average over the time you were pedalling with force" />
        <Pair label="Cadence" avg={`${n(ride.cadenceAvg ?? 0)} rpm`} max={`${n(ride.cadenceMax ?? 0)} rpm`} hint="Average over the time the pedals were turning" />
        <Pair label="Steepest" avg={`${n(ride.gradeUpPct ?? 0, 1)}%`} max={`${n(Math.abs(ride.gradeDownPct ?? 0), 1)}%`} avgLabel="up" maxLabel="down" hint="Over 100 m stretches ridden at 6 km/h or faster" />
        <Pair label="Your energy" avg={`${n(riderKj)} kJ`} max={`${n(riderKj / 4.184)} kcal`} avgLabel="" maxLabel="" hint="Work at the pedals, not calories burned: the body uses about four times as much" />
        <Pair label="Battery" avg={batteryPer(ride, units)} max={batteryUsed(ride) > 0 ? `${batteryUsed(ride)}%` : "–"} avgLabel="per 1%" maxLabel="used" hint="Distance ridden for each 1% of battery" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Zones title="Motor torque zones" secs={ride.torqueZoneS ?? []} labels={zoneLabels(ZONE_TORQUE, "Nm")} names={TORQUE_NAMES} sub={`Peak ${n(ride.maxTorque)} Nm`} />
        <Zones title="Motor power zones" secs={ride.wattZoneS ?? []} labels={zoneLabels(ZONE_WATTS, "W")} names={WATT_NAMES} sub={`Peak ${n(ride.motorWMax ?? 0)} W`} />
        <Gears ride={ride} />
      </div>

      <DataNote ride={ride} />
    </>
  );
}

/** Battery % used, or 0 when it wasn't recorded or went up (charged, or a gauge correction). */
const batteryUsed = (ride: RideSummary) => (ride.batteryStart !== null && ride.batteryEnd !== null ? Math.max(0, ride.batteryStart - ride.batteryEnd) : 0);

function batteryPer(ride: RideSummary, units: Units) {
  const used = batteryUsed(ride);
  return used > 0 ? fmtDist(ride.km / used, units, 2) : "–";
}

function Pair({ label, avg, max, hint, avgLabel = "avg", maxLabel = "max" }: { label: string; avg: string; max: string; hint: string; avgLabel?: string; maxLabel?: string }) {
  return (
    <div className="bg-card px-4 py-3.5" title={hint}>
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5 font-display text-2xl font-semibold">
        {avg} {avgLabel && <span className="text-xs font-normal text-muted">{avgLabel}</span>}
      </div>
      <div className="text-xs text-soft">
        {max} {maxLabel}
      </div>
    </div>
  );
}

function Zones({ title, secs, labels, names, sub }: { title: string; secs: number[]; labels: string[]; names: string[]; sub: string }) {
  const total = secs.reduce((a, b) => a + b, 0);
  return (
    <Card title={title} sub={sub}>
      <div className="flex flex-col gap-2.5">
        {labels.map((label, i) => (
          <div key={label}>
            <div className="flex items-baseline justify-between gap-2 text-[13px]">
              <span>
                <b className="font-semibold">{label}</b> <span className="text-muted">{names[i]}</span>
              </span>
              <span className="whitespace-nowrap text-soft">
                {mins(secs[i] ?? 0)} · <b style={{ color: ZONE_COLOURS[i] }}>{pct(secs[i] ?? 0, total)}</b>
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded bg-line">
              <div className="h-full rounded" style={{ width: `${total ? ((secs[i] ?? 0) / total) * 100 : 0}%`, background: ZONE_COLOURS[i] }} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Gears({ ride }: { ride: RideSummary }) {
  const [pedalling, setPedalling] = useState(true);
  const map = pedalling ? ride.gearPedalS ?? {} : ride.gearS;
  // Older imports can hold glitched gear numbers: leave out anything no drivetrain has.
  const top = Math.max(12, ...Object.keys(map).map(Number).filter((g) => g <= MAX_GEAR));
  const gears = Array.from({ length: top }, (_, i) => map[String(i + 1)] ?? 0);
  const total = gears.reduce((a, b) => a + b, 0);
  const most = gears.indexOf(Math.max(...gears));
  const average = total ? gears.reduce((a, v, i) => a + v * (i + 1), 0) / total : 0;
  const peak = Math.max(1, ...gears);
  return (
    <Card title="Gears" sub={total ? `Mostly gear ${most + 1} (${pct(gears[most], total)}), average ${n(average, 1)}, ${n(ride.gearChanges ?? 0)} changes` : "No gear readings on this ride"}>
      <div className="mb-3 flex gap-2 text-[13px]">
        {[
          [true, "Pedalling"],
          [false, "All moving"],
        ].map(([v, label]) => (
          <button
            key={String(v)}
            type="button"
            aria-pressed={pedalling === v}
            onClick={() => setPedalling(v as boolean)}
            className={`min-h-9 rounded-full border px-3 ${pedalling === v ? "border-accent bg-accent-soft text-[#7dd3fc]" : "border-edge text-soft hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="grid h-[150px] items-end gap-1" style={{ gridTemplateColumns: `repeat(${top}, minmax(0, 1fr))` }} role="img" aria-label={gears.map((v, i) => `gear ${i + 1} ${pct(v, total)}`).join(", ")}>
        {gears.map((v, i) => (
          <div key={i} className="flex h-full flex-col items-center justify-end gap-1" title={`Gear ${i + 1}: ${mins(v)}`}>
            <div className="w-full rounded-t" style={{ height: `${v ? Math.max(3, (v / peak) * 120) : 0}px`, background: `hsl(${205 - (i / Math.max(1, top - 1)) * 180} 85% 60%)` }} />
            <span className="text-[11px] text-muted">{i + 1}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function DataNote({ ride }: { ride: RideSummary }) {
  const parts = [`${fmtDuration(ride.observedS ?? 0)} of readings`];
  if (ride.unknownS) parts.push(`${fmtDuration(ride.unknownS)} in gaps left out of times and averages`);
  if (ride.duplicates) parts.push(`${n(ride.duplicates)} repeated timestamps counted once`);
  const unverified = ride.checksumsVerified === false;
  if (ride.badFrames && !unverified) parts.push(`${n(ride.badFrames)} damaged ${ride.badFrames === 1 ? "reading" : "readings"} skipped`);
  return (
    <>
      {unverified && (
        <p className="rounded-xl border border-edge px-4 py-3 text-[13px] text-warn" role="note">
          None of this file&apos;s checksums matched, so it was read without them. That usually means firmware that writes them differently, but the file could be damaged: treat odd figures with care.
        </p>
      )}
      <p className="text-xs text-muted">Data: {parts.join(" · ")}. Each reading holds until the next one if that comes within a couple of seconds.</p>
    </>
  );
}
