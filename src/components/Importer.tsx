"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { isRideFile, parseRide } from "@/lib/parseRide";
import { summarise } from "@/lib/ride";
import { fmtDay, n } from "@/lib/format";

type Status = { phase: "idle" | "reading" | "saving" | "done"; found: number; fresh: number; saved: number; skipped: number; failed: string[]; latest: string };

const START: Status = { phase: "idle", found: 0, fresh: 0, saved: 0, skipped: 0, failed: [], latest: "" };
const AT_ONCE = 3;
const RIDE_DIR = "Android/data/com.avinox.ride/files/ebike/data";

export function Importer() {
  const [st, setSt] = useState<Status>(START);
  const [over, setOver] = useState(false);
  const [updateExisting, setUpdateExisting] = useState(false);
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const busy = st.phase === "reading" || st.phase === "saving";

  async function run(list: File[]) {
    // A ride folder holds other files too: keep only ride recordings.
    // Prefer the largest copy when a folder contains multiple versions of a ride.
    const candidates = list.filter((f) => /\.proto$/i.test(f.name) || /cloud_ride_rec/i.test(f.name)).sort((a, b) => b.size - a.size);
    setSt({ ...START, phase: "reading", found: candidates.length });
    let seen: Set<string>;
    try {
      const res = await fetch("/api/rides");
      if (!res.ok) throw new Error("Couldn't check existing rides");
      const data = await res.json() as { ids?: unknown };
      if (!Array.isArray(data.ids) || !data.ids.every((id) => typeof id === "string")) throw new Error("Invalid ride list");
      seen = new Set(data.ids as string[]);
    } catch {
      setSt({ ...START, phase: "done", found: candidates.length, failed: ["Couldn't check existing rides. Check your connection and sign-in, then choose your files again."] });
      return;
    }
    const queued = new Set<string>();

    const jobs: { name: string; body: string; label: string }[] = [];
    let skipped = 0;
    const failed: string[] = [];
    for (const f of candidates) {
      try {
        const buf = await f.arrayBuffer();
        if (!isRideFile(buf)) {
          failed.push(`${f.name}: not a ride recording`);
          continue;
        }
        const { summary, track } = summarise(parseRide(buf));
        if (summary.km < 0.05 && summary.movingS < 60) {
          skipped++;
          continue;
        }
        if (queued.has(summary.id) || (!updateExisting && seen.has(summary.id))) {
          skipped++;
          continue;
        }
        queued.add(summary.id);
        jobs.push({ name: f.name, body: JSON.stringify({ summary, track }), label: fmtDay(summary.start) });
      } catch (e) {
        failed.push(`${f.name}: ${(e as Error).message}`);
      }
    }

    let saved = 0;
    setSt((s) => ({ ...s, phase: "saving", fresh: jobs.length, skipped, failed: [...failed] }));
    let next = 0;
    async function worker() {
      while (next < jobs.length) {
        const job = jobs[next++];
        const res = await fetch("/api/rides", { method: "POST", headers: { "content-type": "application/json" }, body: job.body }).catch(() => null);
        if (res?.ok) saved++;
        else failed.push(`${job.name}: couldn't save (${res ? res.status : "offline"})`);
        setSt((s) => ({ ...s, saved, failed: [...failed], latest: job.label }));
      }
    }
    await Promise.all(Array.from({ length: AT_ONCE }, worker));
    setSt((s) => ({ ...s, phase: "done" }));
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setOver(false);
    if (busy) return;
    collectDropped(e.dataTransfer).then(run);
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed px-6 py-10 text-center ${over ? "border-accent bg-accent-soft/40" : "border-edge bg-card"}`}
      >
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
        </svg>
        <div>
          <div className="font-display text-lg font-semibold">Drop your ride files or the whole data folder here</div>
          <div className="mt-1 text-muted">Files named cloud_ride_rec_….proto. Existing rides are skipped unless you choose to update them.</div>
        </div>
        <div className="flex flex-wrap justify-center gap-2.5">
          <button type="button" disabled={busy} onClick={() => folder.current?.click()} className="min-h-11 rounded-[10px] bg-accent px-4 font-semibold text-on-accent disabled:opacity-50">
            Choose a folder
          </button>
          <button type="button" disabled={busy} onClick={() => files.current?.click()} className="min-h-11 rounded-[10px] border border-edge px-4 font-semibold disabled:opacity-50">
            Choose files
          </button>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm text-soft">
          <input type="checkbox" checked={updateExisting} disabled={busy} onChange={(e) => setUpdateExisting(e.target.checked)} />
          Update existing rides (keeps ride names)
        </label>
        <p className="max-w-xl text-xs text-muted">Use this with complete recordings to replace an earlier partial import or recalculate a ride after a fix.</p>
        <input ref={files} type="file" multiple className="hidden" onChange={(e) => {
          const selected = [...(e.target.files ?? [])];
          e.target.value = "";
          if (selected.length) void run(selected);
        }} />
        <input
          ref={folder}
          type="file"
          className="hidden"
          // Picks a whole folder, subfolders included.
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          onChange={(e) => {
            const selected = [...(e.target.files ?? [])];
            e.target.value = "";
            if (selected.length) void run(selected);
          }}
        />
      </div>

      {st.phase !== "idle" && (
        <section className="rounded-2xl border border-line bg-card p-5" aria-live="polite">
          {st.phase === "reading" && <p>Reading {n(st.found)} files…</p>}
          {st.phase !== "reading" && (
            <>
              <p className="font-display text-lg font-semibold">
                {st.phase === "done" ? `Saved ${n(st.saved)} ${st.saved === 1 ? "ride" : "rides"}` : `Saving ${n(st.saved)} of ${n(st.fresh)} rides…`}
              </p>
              <div className="mt-2 h-2 overflow-hidden rounded bg-line">
                <div className="h-2 bg-accent transition-all" style={{ width: `${st.fresh ? (st.saved / st.fresh) * 100 : 100}%` }} />
              </div>
              <p className="mt-2 text-[13px] text-muted">
                {n(st.found)} ride files found
                {st.skipped ? ` · ${n(st.skipped)} already here or too short` : ""}
                {st.latest && st.phase === "saving" ? ` · ${st.latest}` : ""}
              </p>
            </>
          )}
          {st.found === 0 && st.phase === "done" && <p className="mt-2 text-warn">No ride files in there. Look for files starting cloud_ride_rec in the folder below.</p>}
          {st.failed.length > 0 && (
            <details className="mt-3 text-[13px] text-warn">
              <summary className="cursor-pointer">{st.failed.length} couldn&apos;t be read</summary>
              <ul className="mt-2 list-disc pl-5 text-muted">
                {st.failed.slice(0, 50).map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </details>
          )}
          {st.phase === "done" && (
            <Link href="/" className="mt-4 inline-flex min-h-11 items-center rounded-[10px] bg-accent px-4 font-semibold !text-on-accent">
              See your stats
            </Link>
          )}
        </section>
      )}

      <section className="rounded-2xl border border-line bg-card p-5">
        <h2 className="font-display text-base font-semibold">Getting the files off your phone</h2>
        <p className="mt-1 text-[13px] text-muted">The Avinox Ride app keeps a recording of every ride on your phone, more detailed than what it sends to Strava.</p>
        <ol className="mt-4 flex list-decimal flex-col gap-3 pl-5 text-soft">
          <li>Plug your Android phone into your computer with a USB cable and pick <b className="text-ink">File transfer</b> on the phone.</li>
          <li>
            On the computer, open the phone and go to <code className="rounded bg-sunk px-1.5 py-0.5 text-[13px] text-ink">{RIDE_DIR}</code>.
          </li>
          <li>
            Copy the whole <b className="text-ink">data</b> folder to your computer, then press <b className="text-ink">Choose a folder</b> above and pick it. Next time, copy it again: only new rides are added unless you select Update existing rides.
          </li>
        </ol>
        <details className="mt-4 text-[13px] text-muted">
          <summary className="cursor-pointer text-soft">Can&apos;t see the Android/data folder?</summary>
          <div className="mt-2 flex flex-col gap-2">
            <p>Newer phones hide it from some computers. With USB debugging switched on (Settings › About phone, tap Build number seven times, then Developer options › USB debugging), this copies it in one go:</p>
            <pre className="overflow-x-auto rounded-lg bg-sunk p-3 text-ink">adb pull /sdcard/{RIDE_DIR} avinox-rides</pre>
            <p>On iPhone nobody has confirmed a way to get the raw files out yet.</p>
          </div>
        </details>
      </section>
    </div>
  );
}

/** Everything dropped, opening any folders. */
async function collectDropped(dt: DataTransfer): Promise<File[]> {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  if (!entries.length) return [...dt.files];
  const out: File[] = [];
  async function walk(entry: FileSystemEntry): Promise<void> {
    if (entry.isFile) {
      out.push(await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej)));
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e);
      }
    }
  }
  for (const e of entries) await walk(e);
  return out;
}
