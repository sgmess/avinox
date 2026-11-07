"use client";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { RideSummary, TrackPoint } from "@/lib/ride";
import { chargeCost, fmtMoney, modeColor, modeName, modeRank, type Settings, type Units } from "@/lib/settings";
import { avgKmh, batteryDrop, modeParts, packWh, rideBatteryWh, rideWhPerKm } from "@/lib/stats";
import { dist, fmtDist, fmtDuration, fmtHeight, fmtLongDate, fmtSpeed, height, heightUnit, hourOf, n, perDist, speedUnit } from "@/lib/format";
import { DEFAULT_TIME_ZONE } from "@/lib/settings";
import { Card, ModeBar, UnitSwitch } from "./ui";
import { RideMap, type Segment } from "./RideMap";
import { RideDetails } from "./RideDetails";
import { ConfidenceNote } from "./Confidence";
import { StoryImage } from "./StoryImage";
import type { Typical } from "@/lib/typical";


type ColourBy = "mode" | "speed" | "motor" | "hr";

export function RideView({
  ride,
  track,
  settings,
  efficiency,
  typical,
  base,
  demo,
}: {
  ride: RideSummary;
  track: TrackPoint[];
  settings: Settings;
  efficiency: number;
  typical: Typical | null;
  base: string;
  demo?: boolean;
}) {
  const router = useRouter();
  const [units, setUnits] = useState<Units>(settings.units);
  const s = useMemo(() => ({ ...settings, units }), [settings, units]);
  const [name, setName] = useState(ride.name ?? "");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveQueue = useRef(Promise.resolve());
  const saveVersion = useRef(0);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [colourBy, setColourBy] = useState<ColourBy>("mode");
  const [cursor, setCursor] = useState<number | null>(null);

  const kmh = avgKmh(ride);
  const wh = rideWhPerKm(ride, s, efficiency);
  const title = name || defaultName(ride, settings.timeZone);

  const segments = useMemo(() => colourSegments(track, s, colourBy), [track, s, colourBy]);

  function save() {
    if (demo || deleting) return;
    const version = ++saveVersion.current;
    const body = JSON.stringify({ name });
    setSaveStatus("saving");
    // Keep blur saves in order so an older request cannot overwrite newer edits.
    saveQueue.current = saveQueue.current.then(async () => {
      try {
        const res = await fetch(`/api/rides/${ride.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body });
        if (!res.ok) throw new Error("Save failed");
        if (version === saveVersion.current) setSaveStatus("saved");
      } catch {
        if (version === saveVersion.current) setSaveStatus("error");
      }
    });
  }

  async function remove() {
    if (demo || deleting || !confirm("Delete this ride? You can import its file again later.")) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await saveQueue.current;
      const res = await fetch(`/api/rides/${ride.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      router.replace("/");
      router.refresh();
    } catch {
      setDeleteError("Couldn't delete this ride. Check your connection and sign-in, then try again.");
      setDeleting(false);
    }
  }

  const compare = (v: number, typ: number | undefined | null, more: string, less: string, lowerIsBetter = false) => {
    if (!typ) return { text: "", tone: "text-muted" };
    const d = v / typ - 1;
    if (Math.abs(d) < 0.08) return { text: "about usual", tone: "text-muted" };
    const good = lowerIsBetter ? d < 0 : d > 0;
    return { text: `${n(Math.abs(d) * 100)}% ${d > 0 ? more : less} than usual`, tone: good ? "text-good" : "text-muted" };
  };
  const stats = [
    { label: "Distance", value: fmtDist(ride.km, units), ...compare(ride.km, typical?.km, "longer", "shorter") },
    { label: "Moving time", value: fmtDuration(ride.movingS), ...compare(ride.movingS, typical?.movingS, "longer", "shorter") },
    { label: "Climbed", value: fmtHeight(ride.ascentM, units), ...compare(ride.ascentM, typical?.ascentM, "more", "less") },
    { label: "Avg speed", value: kmh === null ? "–" : fmtSpeed(kmh, units), ...(kmh === null ? { text: "", tone: "" } : compare(kmh, typical?.kmh, "faster", "slower")) },
    { label: `Battery per ${units === "mi" ? "mile" : "km"}`, value: wh ? `${n(perDist(wh, units), 1)} Wh` : "–", ...(wh ? compare(wh, typical?.whPerKm, "more", "less", true) : { text: "", tone: "" }) },
    ride.hrAvg
      ? { label: "Heart rate", value: `${ride.hrAvg} bpm`, text: `peak ${ride.hrMax}`, tone: "text-muted" }
      : { label: "Top speed", value: fmtSpeed(ride.maxKmh, units), text: "", tone: "" },
  ];

  const drop = batteryDrop(ride);
  const left = ride.batteryEnd !== null && wh ? (((ride.batteryEnd / 100) * rideBatteryWh(ride, settings)) / wh) : null;
  const modes = Object.entries(ride.modeS)
    .filter(([, v]) => v >= 30)
    .sort(([a], [b]) => modeRank(s, a) - modeRank(s, b));

  return (
    <div className="mx-auto flex max-w-[1360px] flex-col gap-4 px-4 pt-6 pb-16 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={base.replace(/\/rides$/, "") || "/"} className="flex min-h-11 items-center gap-1.5 font-medium">
          <span aria-hidden="true">←</span> All rides
        </Link>
        <UnitSwitch units={units} onChange={setUnits} />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-muted">{fmtLongDate(ride.start, settings.timeZone)}</div>
          {demo ? (
            <h1 className="mt-1 font-display text-3xl font-semibold">{title}</h1>
          ) : (
            <label className="mt-1 block">
              <span className="sr-only">Ride name</span>
              <input
                value={name}
                disabled={deleting}
                placeholder={defaultName(ride, settings.timeZone)}
                onChange={(e) => {
                  setName(e.target.value);
                  saveVersion.current++;
                  setSaveStatus("idle");
                }}
                onBlur={save}
                className="w-full max-w-[640px] rounded-lg bg-transparent font-display text-3xl font-semibold outline-none placeholder:text-ink focus:bg-sunk focus:px-2"
              />
            </label>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`${base}/${ride.id}/compare`} className="flex min-h-11 items-center rounded-[10px] border border-edge px-4 font-semibold !text-ink hover:bg-white/5">
            Compare
          </Link>
          <button type="button" onClick={() => downloadGpx(ride, track, title)} className="min-h-11 rounded-[10px] border border-edge px-4 font-semibold hover:bg-white/5">
            Export GPX
          </button>
          {!demo && (
            <button type="button" onClick={remove} disabled={deleting} className="min-h-11 rounded-[10px] border border-edge px-4 font-semibold text-hot hover:bg-white/5 disabled:opacity-50">
              {deleting ? "Deleting…" : "Delete"}
            </button>
          )}
        </div>
      </div>

      {!demo && (
        <div aria-live="polite" className="text-sm text-muted">
          {saveStatus === "saving" && "Saving changes…"}
          {saveStatus === "saved" && "Changes saved"}
          {saveStatus === "error" && (
            <p role="alert" className="text-hot">
              Couldn&apos;t save your changes. Check your connection and sign-in. Your edits are still here.{" "}
              <button type="button" onClick={save} disabled={deleting} className="min-h-11 underline">Retry save</button>
            </p>
          )}
          {deleteError && <p role="alert" className="text-hot">{deleteError}</p>}
        </div>
      )}

      <ConfidenceNote ride={ride} />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-3 xl:grid-cols-6">
        {stats.map((x) => (
          <div key={x.label} className="bg-card px-4 py-3.5">
            <div className="text-xs text-muted">{x.label}</div>
            <div className="mt-0.5 font-display text-2xl font-semibold">{x.value}</div>
            <div className={`text-xs ${x.tone}`}>{x.text || " "}</div>
          </div>
        ))}
      </div>

      <section className="overflow-hidden rounded-2xl border border-line bg-card">
        <RideMap track={track} segments={segments} cursor={cursor} />
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-[13px] text-soft">
          <span>Colour the route by</span>
          {(
            [
              ["mode", "Assist mode"],
              ["speed", "Speed"],
              ["motor", "Motor power"],
              ["hr", "Heart rate"],
            ] as [ColourBy, string][]
          )
            .filter(([k]) => k !== "hr" || track.some((p) => p.hr))
            .map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={colourBy === k}
                onClick={() => setColourBy(k)}
                className={`min-h-9 rounded-full border px-3 ${colourBy === k ? "border-accent bg-accent-soft text-[#7dd3fc]" : "border-edge text-soft hover:text-ink"}`}
              >
                {label}
              </button>
            ))}
          <Legend by={colourBy} track={track} settings={s} />
        </div>
      </section>

      <PowerChart ride={ride} track={track} units={units} cursor={cursor} setCursor={setCursor} />

      <RideDetails ride={ride} units={units} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Battery on this ride">
          {ride.batteryStart !== null && ride.batteryEnd !== null ? (
            <>
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-display text-[28px] font-semibold">
                  {ride.batteryStart} → {ride.batteryEnd}%
                </span>
                <span className="text-muted">about {n(packWh(ride, s, efficiency))} Wh, {fmtMoney(chargeCost(packWh(ride, s, efficiency), s), s)} to put back</span>
              </div>
              <p className="mt-2 text-soft">
                {[
                  ride.tempMax !== null && `It got to ${n(ride.tempMax)} °C${ride.tempMin !== null ? `, from ${n(ride.tempMin)} °C at the coolest` : ""}.`,
                  left !== null && left >= 0.5 && drop > 0 && `At this ride's rate the rest would have taken you about ${fmtDist(left, units, 0)} more.`,
                ]
                  .filter(Boolean)
                  .join(" ")}
              </p>
            </>
          ) : (
            <p className="text-muted">This ride didn&apos;t record the battery.</p>
          )}
        </Card>
        <Card title="Assist modes" sub={`You did ${ride.riderWh + ride.motorWh > 0 ? Math.round((ride.riderWh / (ride.riderWh + ride.motorWh)) * 100) : 0}% of the work, the motor the rest`}>
          <ModeBar parts={modeParts(ride, s)} className="h-3" />
          <div className="mt-3 flex flex-col gap-1.5">
            {modes.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-2 border-t border-line pt-1.5">
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: modeColor(s, k) }} />
                  {modeName(s, k)}
                </span>
                <span className="text-soft">
                  {fmtDuration(v)} · {fmtDist(ride.modeKm[k] ?? 0, units)}
                </span>
              </div>
            ))}
          </div>
        </Card>
        <TimeCard ride={ride} units={units} />
      </div>

      <StoryImage ride={ride} settings={s} title={title} />
    </div>
  );
}

/** Where the time went: moving, stopped and gaps in the recording. */
function TimeCard({ ride, units }: { ride: RideSummary; units: Units }) {
  const total = Math.max(0, ride.end - ride.start);
  // Older imports don't know their gaps: everything not moving counts as stopped.
  const gaps = ride.unknownS ?? 0;
  const stopped = Math.max(0, total - ride.movingS - gaps);
  const overall = total ? ride.km / (total / 3600) : 0;
  const parts = [
    { label: "Moving", s: ride.movingS, color: "var(--accent)" },
    { label: "Stopped", s: stopped, color: "var(--mode-off)" },
    { label: "No data", s: gaps, color: "var(--muted)" },
  ].filter((p) => p.s > 0);
  return (
    <Card title="Time on this ride" sub={`${fmtDuration(total)} from start to finish, ${fmtSpeed(overall, units)} overall`}>
      <div className="flex h-3 overflow-hidden rounded bg-line" role="img" aria-label={parts.map((p) => `${p.label} ${fmtDuration(p.s)}`).join(", ")}>
        {parts.map((p) => (
          <div key={p.label} style={{ width: `${(p.s / Math.max(1, total)) * 100}%`, background: p.color }} />
        ))}
      </div>
      <div className="mt-3 flex flex-col gap-1.5">
        {parts.map((p) => (
          <div key={p.label} className="flex items-center justify-between gap-2 border-t border-line pt-1.5">
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: p.color }} />
              {p.label}
            </span>
            <span className="text-soft">
              {fmtDuration(p.s)} · {Math.round((p.s / Math.max(1, total)) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function defaultName(r: RideSummary, tz = DEFAULT_TIME_ZONE) {
  const h = hourOf(r.start, tz);
  const part = h < 5 ? "Night" : h < 12 ? "Morning" : h < 17 ? "Afternoon" : h < 21 ? "Evening" : "Night";
  return `${part} ride`;
}

const SPEED_COLOURS = ["#1e3a8a", "#2563eb", "#38bdf8", "#a5f3fc", "#fde68a", "#fb923c"];

function scale(v: number, lo: number, hi: number) {
  const i = Math.floor(((v - lo) / Math.max(0.001, hi - lo)) * SPEED_COLOURS.length);
  return SPEED_COLOURS[Math.max(0, Math.min(SPEED_COLOURS.length - 1, i))];
}

function ranges(track: TrackPoint[], by: ColourBy) {
  const vals = track.map((p) => (by === "speed" ? p.speed : by === "motor" ? p.motorW : p.hr ?? 0)).filter((v) => v > 0);
  const sorted = [...vals].sort((a, b) => a - b);
  return { lo: sorted[Math.floor(sorted.length * 0.05)] ?? 0, hi: sorted[Math.floor(sorted.length * 0.95)] ?? 1 };
}

function colourSegments(track: TrackPoint[], s: Settings, by: ColourBy): Segment[] {
  const { lo, hi } = ranges(track, by);
  const colour = (p: TrackPoint) =>
    by === "mode" ? (p.assist === null ? "var(--mode-off)" : modeColor(s, p.assist)) : scale(by === "speed" ? p.speed : by === "motor" ? p.motorW : p.hr ?? lo, lo, hi);
  const out: Segment[] = [];
  for (let i = 0; i < track.length - 1; i++) {
    const c = colour(track[i]);
    const last = out[out.length - 1];
    if (last && last.color === c) last.to = i + 1;
    else out.push({ from: i, to: i + 1, color: c });
  }
  // Leaflet draws with SVG attributes, which don't take CSS variables.
  const css = typeof window === "undefined" ? null : getComputedStyle(document.documentElement);
  return out.map((seg) => ({ ...seg, color: seg.color.startsWith("var(") && css ? css.getPropertyValue(seg.color.slice(4, -1)).trim() : seg.color }));
}

function Legend({ by, track, settings }: { by: ColourBy; track: TrackPoint[]; settings: Settings }) {
  if (by === "mode") {
    const seen = [...new Set(track.map((p) => p.assist).filter((a): a is number => a !== null))].sort((a, b) => modeRank(settings, a) - modeRank(settings, b));
    return (
      <span className="flex flex-wrap gap-3 sm:ml-auto">
        {seen.map((a) => (
          <span key={a} className="flex items-center gap-1.5">
            <span className="h-1 w-3.5 rounded" style={{ background: modeColor(settings, a) }} />
            {modeName(settings, a)}
          </span>
        ))}
      </span>
    );
  }
  const { lo, hi } = ranges(track, by);
  const fmt = (v: number) => (by === "speed" ? `${n(dist(v, settings.units))} ${speedUnit(settings.units)}` : by === "motor" ? `${n(v)} W` : `${n(v)} bpm`);
  return (
    <span className="flex items-center gap-2 sm:ml-auto">
      {fmt(lo)}
      <span className="flex h-2 w-24 overflow-hidden rounded">
        {SPEED_COLOURS.map((c) => (
          <span key={c} className="flex-1" style={{ background: c }} />
        ))}
      </span>
      {fmt(hi)}
    </span>
  );
}

function PowerChart({ ride, track, units, cursor, setCursor }: { ride: RideSummary; track: TrackPoint[]; units: Units; cursor: number | null; setCursor: (i: number | null) => void }) {
  if (track.length < 2) return null;
  const W = 800;
  const H = 200;
  const maxKm = Math.max(0.01, track[track.length - 1].km);
  const smooth = (f: (p: TrackPoint) => number) => track.map((_, i) => {
    const w = track.slice(Math.max(0, i - 2), i + 3);
    return w.reduce((a, p) => a + f(p), 0) / w.length;
  });
  const rider = smooth((p) => p.riderW);
  const motor = smooth((p) => p.motorW);
  const maxW = Math.max(100, ...rider, ...motor);
  const alts = track.map((p) => p.alt).filter((a): a is number => a !== null);
  const aLo = alts.length ? Math.min(...alts) : 0;
  const aHi = alts.length ? Math.max(...alts) : 1;
  const x = (km: number) => (km / maxKm) * W;
  const yW = (w: number) => H - 6 - (w / maxW) * (H - 16);
  const yA = (a: number) => H - ((a - aLo) / Math.max(1, aHi - aLo)) * (H * 0.75);
  const line = (vals: number[]) => track.map((p, i) => `${x(p.km).toFixed(1)},${yW(vals[i]).toFixed(1)}`).join(" ");
  const area = alts.length ? `M0,${H} ` + track.map((p) => `L${x(p.km).toFixed(1)},${yA(p.alt ?? aLo).toFixed(1)}`).join(" ") + ` L${W},${H} Z` : "";
  const totalKj = (ride.riderWh + ride.motorWh) * 3.6;
  const c = cursor === null ? null : track[cursor];

  function move(e: React.PointerEvent<SVGSVGElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const km = ((e.clientX - box.left) / box.width) * maxKm;
    let best = 0;
    for (let i = 1; i < track.length; i++) if (Math.abs(track[i].km - km) < Math.abs(track[best].km - km)) best = i;
    setCursor(best);
  }

  return (
    <Card
      title="You vs the motor"
      sub={
        totalKj > 0 ? (
          <>
            You put in <b className="text-ink">{n(ride.riderWh * 3.6)} kJ</b>, the motor <b className="text-ink">{n(ride.motorWh * 3.6)} kJ</b>.
          </>
        ) : undefined
      }
    >
      <div className="mb-2 min-h-5 text-xs text-soft" aria-live="polite">
        {c ? (
          <>
            <b className="text-ink">{fmtDist(c.km, units, 2)}</b> · {fmtSpeed(c.speed, units)} · you {n(c.riderW)} W · motor {n(c.motorW)} W
            {c.alt !== null && ` · ${n(height(c.alt, units))} ${heightUnit(units)}`}
            {c.hr ? ` · ${c.hr} bpm` : ""}
            {c.battery !== null ? ` · ${c.battery}%` : ""}
          </>
        ) : (
          "Move along the graph to follow the ride on the map"
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-[200px] w-full touch-none"
        role="img"
        aria-label="Your power and the motor's power along the ride, over the height profile"
        onPointerMove={move}
        onPointerDown={move}
        onPointerLeave={() => setCursor(null)}
      >
        {area && <path d={area} fill="#1c2633" />}
        <polyline points={line(motor)} fill="none" stroke="var(--accent)" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
        <polyline points={line(rider)} fill="none" stroke="var(--ink)" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
        {c && <line x1={x(c.km)} x2={x(c.km)} y1="0" y2={H} stroke="var(--muted)" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="mt-1 flex justify-between text-xs text-muted">
        <span>0</span>
        <span>{fmtDist(maxKm, units)}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-[13px] text-soft">
        <span className="flex items-center gap-1.5">
          <span className="h-[3px] w-3.5 bg-ink" />
          Your power
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-[3px] w-3.5 bg-accent" />
          Motor power
        </span>
        {area && (
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-3.5 bg-line" />
            Height
          </span>
        )}
      </div>
    </Card>
  );
}

function downloadGpx(ride: RideSummary, track: TrackPoint[], name: string) {
  const esc = (t: string) => t.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
  const pts = track
    .filter((p) => p.lat !== null && p.lng !== null)
    .map(
      (p) =>
        `<trkpt lat="${p.lat}" lon="${p.lng}">${p.alt !== null ? `<ele>${p.alt}</ele>` : ""}<time>${new Date((ride.start + p.s) * 1000).toISOString()}</time>${
          p.hr ? `<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${p.hr}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>` : ""
        }</trkpt>`,
    )
    .join("\n");
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Ride Stats" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
<trk><name>${esc(name)}</name><type>e_biking</type><trkseg>
${pts}
</trkseg></trk></gpx>`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([gpx], { type: "application/gpx+xml" }));
  a.download = `${new Date(ride.start * 1000).toISOString().slice(0, 10)} ${name}.gpx`.replace(/[^\w .-]/g, "");
  a.click();
  // Freeing the link at once can cancel the download in Safari.
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

