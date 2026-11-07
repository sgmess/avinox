"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RESTORE_BATCH, readBackup, type BackupRide } from "@/lib/backup";
import { n } from "@/lib/format";
import { Card } from "./ui";

/** What happened to the backup's settings: not asked for (or none in the file), restored, or failed. */
type SettingsResult = "none" | "restored" | "failed";

type State =
  | { phase: "idle" }
  | { phase: "restoring"; done: number; total: number }
  | { phase: "done"; saved: number; skipped: number; invalid: number; failed: number; settings: SettingsResult }
  | { phase: "error"; why: string };

/** Tries a request three times before giving up, for dropped connections. */
async function send(url: string, init: RequestInit) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, init).catch(() => null);
    if (res?.ok || i >= 2 || (res && res.status < 500 && res.status !== 429)) return res;
    await new Promise((r) => setTimeout(r, 1000 * 3 ** i));
  }
}

export function BackupCard() {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [withSettings, setWithSettings] = useState(true);
  const [state, setState] = useState<State>({ phase: "idle" });
  const busy = state.phase === "restoring";

  async function restore(f: File) {
    let data: unknown;
    try {
      data = JSON.parse(await f.text());
    } catch {
      setState({ phase: "error", why: "That file isn't valid JSON." });
      return;
    }
    const read = readBackup(data);
    if (!read.ok) {
      setState({ phase: "error", why: read.why });
      return;
    }
    const { rides, settings } = read.backup;
    if (!confirm(`Restore ${rides.length} ${rides.length === 1 ? "ride" : "rides"}${withSettings ? " and your settings" : ""}? ${overwrite ? "Rides already here will be replaced." : "Rides already here are kept as they are."}`)) return;

    let settingsResult: SettingsResult = "none";
    if (withSettings && settings) {
      const res = await send("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(settings) });
      settingsResult = res?.ok ? "restored" : "failed";
    }
    const total = { saved: 0, skipped: 0, invalid: 0, failed: 0 };
    setState({ phase: "restoring", done: 0, total: rides.length });
    for (let i = 0; i < rides.length; i += RESTORE_BATCH) {
      const chunk: BackupRide[] = rides.slice(i, i + RESTORE_BATCH);
      const res = await send("/api/backup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rides: chunk, overwrite }) });
      const out = res?.ok ? ((await res.json().catch(() => null)) as { saved?: number; skipped?: number; invalid?: number } | null) : null;
      if (out) {
        total.saved += out.saved ?? 0;
        total.skipped += out.skipped ?? 0;
        total.invalid += out.invalid ?? 0;
      } else total.failed += chunk.length;
      setState({ phase: "restoring", done: Math.min(rides.length, i + RESTORE_BATCH), total: rides.length });
    }
    setState({ phase: "done", ...total, settings: settingsResult });
    router.refresh();
  }

  return (
    <Card title="Backup" sub="Your settings, every ride's details (names and notes too) and routes, in one file you keep.">
      <div className="flex flex-wrap gap-2.5">
        <a href="/api/backup" download className="flex min-h-11 items-center rounded-[10px] bg-accent px-4 font-semibold !text-on-accent hover:opacity-90">
          Download backup
        </a>
        <button type="button" disabled={busy} onClick={() => file.current?.click()} className="min-h-11 rounded-[10px] border border-edge px-4 font-semibold disabled:opacity-50">
          Restore from a backup…
        </button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void restore(f);
          }}
        />
      </div>
      <div className="mt-3 flex flex-col gap-1 text-sm text-soft">
        <label className="flex min-h-9 items-center gap-2">
          <input type="checkbox" checked={withSettings} disabled={busy} onChange={(e) => setWithSettings(e.target.checked)} />
          Restore settings too
        </label>
        <label className="flex min-h-9 items-center gap-2">
          <input type="checkbox" checked={overwrite} disabled={busy} onChange={(e) => setOverwrite(e.target.checked)} />
          Replace rides that are already here
        </label>
      </div>
      <div aria-live="polite" className="mt-2 text-sm">
        {state.phase === "restoring" && <p className="text-soft">Restoring {n(state.done)} of {n(state.total)} rides…</p>}
        {state.phase === "done" && (
          <p className={state.failed || state.settings === "failed" ? "text-warn" : "text-soft"} role={state.failed || state.settings === "failed" ? "alert" : undefined}>
            Restored {n(state.saved)} {state.saved === 1 ? "ride" : "rides"}
            {state.settings === "restored" ? " and your settings" : ""}.
            {state.settings === "failed" ? " Your settings didn't restore: check your connection and restore the same file again (rides already restored are skipped)." : ""}
            {state.skipped ? ` ${n(state.skipped)} already here, left as they were.` : ""}
            {state.invalid ? ` ${n(state.invalid)} in the file couldn't be read.` : ""}
            {state.failed ? ` ${n(state.failed)} didn't save: check your connection and restore the same file again (rides already restored are skipped).` : ""}
          </p>
        )}
        {state.phase === "error" && (
          <p role="alert" className="text-hot">
            {state.why}
          </p>
        )}
      </div>
    </Card>
  );
}
