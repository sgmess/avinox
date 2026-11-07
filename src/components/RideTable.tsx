"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { RideSummary } from "@/lib/ride";
import { modeName, type Settings } from "@/lib/settings";
import { avgKmh, modeParts, rideWhPerKm } from "@/lib/stats";
import { KM_PER_MI, dist, distUnit, fmtDate, fmtDay, fmtDuration, fmtShortDate, height, heightUnit, monthKey, monthLabel, n, perDist, speedUnit } from "@/lib/format";
import { ModeBar } from "./ui";
import { ConfidenceDot } from "./Confidence";
import { CONFIDENCE_LABEL, rideConfidence } from "@/lib/confidence";

type SortKey = "start" | "km" | "movingS" | "speed" | "ascentM" | "used" | "wh";
const PAGE = 50;

export function RideTable({
  rides,
  settings,
  efficiency,
  base,
  month,
  onClearMonth,
}: {
  rides: RideSummary[];
  settings: Settings;
  efficiency: number;
  base: string;
  month: string | null;
  onClearMonth: () => void;
}) {
  const u = settings.units;
  const tz = settings.timeZone;
  const [q, setQ] = useState("");
  const [distanceFilter, setDistanceFilter] = useState(2);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "start", desc: true });
  const [shown, setShown] = useState(PAGE);
  const short = u === "mi" ? [0, KM_PER_MI, 6 * KM_PER_MI] : [0, 1, 10];
  const minKm = short[distanceFilter];

  const rows = useMemo(() => {
    const value = (r: RideSummary): number => {
      switch (sort.key) {
        case "speed":
          return avgKmh(r) ?? -1;
        case "used":
          return r.batteryStart !== null && r.batteryEnd !== null ? r.batteryStart - r.batteryEnd : -1;
        case "wh":
          return rideWhPerKm(r, settings, efficiency) ?? -1;
        default:
          return r[sort.key];
      }
    };
    const needle = q.trim().toLowerCase();
    return rides
      .filter((r) => r.km >= minKm - 0.001)
      .filter((r) => !month || monthKey(r.start, tz) === month)
      .filter((r) => !needle || `${fmtDay(r.start, tz)} ${fmtDate(r.start, tz)} ${fmtShortDate(r.start, tz)} ${r.name ?? ""} ${r.notes ?? ""}`.toLowerCase().includes(needle))
      .sort((a, b) => (value(a) - value(b)) * (sort.desc ? -1 : 1));
  }, [rides, minKm, month, q, sort, settings, efficiency, tz]);

  const head = (key: SortKey, label: string, right = true) => (
    <th className={`px-2.5 py-2 font-medium ${right ? "text-right" : "text-left"}`} aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button type="button" className="min-h-8 hover:text-ink" onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }))}>
        {label}
        {sort.key === key ? (sort.desc ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );

  function downloadCsv() {
    const cols = ["Date", "Name", `Distance (${distUnit(u)})`, "Moving time (min)", `Avg speed (${speedUnit(u)})`, `Max speed (${speedUnit(u)})`, `Climb (${heightUnit(u)})`, "Battery start %", "Battery end %", `Battery Wh/${distUnit(u)}`, "Motor Wh", "Rider Wh", "Min temp °C", "Max temp °C", "Avg heart rate", "Data confidence"];
    const modes = [...new Set(rides.flatMap((r) => Object.keys(r.modeS)))];
    const lines = [
      [...cols, ...modes.map((m) => `${modeName(settings, m)} (min)`)],
      ...rows.map((r) => {
        const wh = rideWhPerKm(r, settings, efficiency);
        const kmh = avgKmh(r);
        return [
          new Date(r.start * 1000).toISOString(),
          r.name ?? "",
          dist(r.km, u).toFixed(2),
          (r.movingS / 60).toFixed(0),
          kmh === null ? "" : dist(kmh, u).toFixed(1),
          dist(r.maxKmh, u).toFixed(1),
          height(r.ascentM, u).toFixed(0),
          r.batteryStart ?? "",
          r.batteryEnd ?? "",
          wh ? perDist(wh, u).toFixed(1) : "",
          r.motorWh.toFixed(0),
          r.riderWh.toFixed(0),
          r.tempMin ?? "",
          r.tempMax ?? "",
          r.hrAvg ?? "",
          CONFIDENCE_LABEL[rideConfidence(r).level],
          ...modes.map((m) => ((r.modeS[m] ?? 0) / 60).toFixed(0)),
        ];
      }),
    ];
    // Text a spreadsheet would run as a formula (a ride named "=…") gets a leading apostrophe.
    const cell = (c: string | number) => {
      const text = typeof c === "string" && /^[=+\-@\t\r]/.test(c) && Number.isNaN(Number(c)) ?`'${c}` : String(c);
      return `"${text.replace(/"/g, '""')}"`;
    };
    const csv = lines.map((l) => l.map(cell).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "rides.csv";
    a.click();
    // Freeing the link at once can cancel the download in Safari.
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  const chip = (active: boolean) =>
    `min-h-10 rounded-full border px-3.5 text-[13px] font-medium ${active ? "border-accent bg-accent-soft text-[#7dd3fc]" : "border-edge bg-sunk text-soft hover:text-ink"}`;

  return (
    <section id="rides" className="rounded-2xl border border-line bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h2 className="font-display text-base font-semibold">Rides</h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-h-10 items-center gap-2 rounded-[10px] border border-edge bg-sunk px-3">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-4-4" />
            </svg>
            <span className="sr-only">Search rides</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search, e.g. 08/10/2026" className="w-44 bg-transparent text-[13px] outline-none" />
          </label>
          {short.map((k, i) => (
            <button key={i} type="button" className={chip(distanceFilter === i)} onClick={() => setDistanceFilter(i)}>
              {i === 0 ? "All" : `${u === "mi" ? n(k / KM_PER_MI) : n(k)} ${distUnit(u)} +`}
            </button>
          ))}
          {month && (
            <button type="button" className={chip(true)} onClick={onClearMonth} aria-label={`Showing ${monthLabel(month)} only. Show all months`}>
              {monthLabel(month)} ✕
            </button>
          )}
          <button type="button" className={chip(false)} onClick={downloadCsv}>
            Download CSV
          </button>
          <span className="text-[13px] text-muted">{n(rows.length)} rides</span>
        </div>
      </div>
      <div className="mt-3.5 overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse">
          <thead>
            <tr className="text-xs text-muted">
              {head("start", "Date", false)}
              {head("km", distUnit(u) === "mi" ? "Miles" : "Km")}
              {head("movingS", "Time")}
              {head("speed", `Avg ${speedUnit(u)}`)}
              {head("ascentM", `Climb ${heightUnit(u)}`)}
              {head("used", "Battery")}
              {head("wh", `Wh/${distUnit(u)}`)}
              <th className="px-2.5 py-2 text-left font-medium">Assist mix</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((r) => {
              const wh = rideWhPerKm(r, settings, efficiency);
              return (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-2.5 py-3">
                    <Link href={`${base}/${r.id}`}>{fmtDay(r.start, tz)}</Link>
                    <ConfidenceDot ride={r} />
                    {r.name && <div className="text-xs text-muted">{r.name}</div>}
                  </td>
                  <td className="px-2.5 py-3 text-right">{n(dist(r.km, u), 1)}</td>
                  <td className="px-2.5 py-3 text-right">{fmtDuration(r.movingS)}</td>
                  <td className="px-2.5 py-3 text-right">{avgKmh(r) === null ? "–" : n(dist(avgKmh(r)!, u), 1)}</td>
                  <td className="px-2.5 py-3 text-right">{n(height(r.ascentM, u))}</td>
                  <td className="px-2.5 py-3 text-right whitespace-nowrap">{r.batteryStart !== null && r.batteryEnd !== null ? <Battery from={r.batteryStart} to={r.batteryEnd} /> : "–"}</td>
                  <td className="px-2.5 py-3 text-right">{wh ? n(perDist(wh, u), 1) : "–"}</td>
                  <td className="w-[220px] px-2.5 py-3">
                    <ModeBar parts={modeParts(r, settings)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > shown && (
        <button type="button" className="mt-3 min-h-11 w-full rounded-[10px] border border-edge text-soft hover:text-ink" onClick={() => setShown((s) => s + PAGE)}>
          Show more ({n(rows.length - shown)} left)
        </button>
      )}
    </section>
  );
}

function Battery({ from, to }: { from: number; to: number }) {
  const used = from - to;
  return (
    <span className="inline-flex items-center gap-2" aria-label={`${from}% to ${to}%`}>
      <span className="text-muted">
        {from} → {to}%
      </span>
      <span className="inline-block h-2.5 w-10 overflow-hidden rounded-sm bg-line" aria-hidden="true">
        <span className="block h-full" style={{ width: `${Math.max(0, Math.min(100, used))}%`, background: used > 75 ? "var(--hot)" : "var(--warn)" }} />
      </span>
    </span>
  );
}
