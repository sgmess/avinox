"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { DEFAULT_MODE_NAMES, modeName, type Settings } from "@/lib/settings";
import { dayStart, todayIn } from "@/lib/format";
import { clientAuth, firebaseConfigured } from "@/lib/firebase-client";
import { Card } from "./ui";

const input = "min-h-11 rounded-[10px] border border-edge px-3 text-sm";

/** Every timezone the browser knows (none on older browsers: the saved one is still listed). */
function timeZones(): string[] {
  try {
    return (Intl as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
}

export function SettingsForm({ settings, seenModes, email }: { settings: Settings; seenModes: string[]; email: string }) {
  const router = useRouter();
  const [s, setS] = useState(settings);
  // Take in settings saved elsewhere (a backup restore, another tab) when the page refreshes,
  // so a later Save can't write the old values back. Keyed on content: a refresh with the
  // same settings leaves edits in progress alone.
  const saved = JSON.stringify(settings);
  useEffect(() => {
    setS(JSON.parse(saved) as Settings);
  }, [saved]);
  const [state, setState] = useState<"" | "saving" | "saved" | "error">("");
  // When the pack size changes: a new battery from a date, or a correction for every ride.
  const [packChange, setPackChange] = useState<"new" | "fix">("new");
  const [swapDate, setSwapDate] = useState(() => todayIn(settings.timeZone));
  const packChanged = s.batteryWh !== settings.batteryWh;
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const modes = [...new Set([...seenModes, "1", "2", "3", "4"])].sort((a, b) => Number(a) - Number(b));
  // Read from the browser after loading, so the server's (UTC) render matches.
  const [allZones, setAllZones] = useState<string[]>([]);
  const [deviceZone, setDeviceZone] = useState("");
  useEffect(() => {
    setAllZones(timeZones());
    try {
      setDeviceZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch {
      // Unknown: no shortcut button.
    }
  }, []);
  const zones = [...new Set([s.timeZone, ...allZones])];

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState("saving");
    let next = s;
    if (packChanged && packChange === "new") {
      // Rides before the swap keep the old pack: midnight of the chosen day in the rider's
      // timezone (Settings), not the device's, so travelling doesn't move the boundary.
      const until = dayStart(swapDate, s.timeZone);
      if (until !== null) next = { ...s, batteryHistory: [...s.batteryHistory.filter((b) => b.until < until), { until, wh: settings.batteryWh }] };
    }
    const res = await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(next) }).catch(() => null);
    if (res?.ok) setS(next);
    setState(res?.ok ? "saved" : "error");
    if (res?.ok) router.refresh();
  }

  async function out(everywhere = false) {
    if (everywhere && !confirm("Sign out on every phone and computer you've used?")) return;
    await fetch(`/api/session${everywhere ? "?everywhere=1" : ""}`, { method: "DELETE" });
    if (firebaseConfigured()) await signOut(clientAuth()).catch(() => undefined);
    location.replace("/login");
  }

  async function wipe() {
    if (deleting || !confirm("Delete every ride from your account? You can import the files again.")) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const res = await fetch("/api/rides", { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      router.replace("/");
      router.refresh();
    } catch {
      setDeleteError("Couldn't delete all rides. Some may remain. Check your connection and sign-in, then try again.");
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={save} className="flex flex-col gap-4">
        <Card title="Your bike">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 font-medium">
              Name shown on the dashboard
              <input className={input} value={s.bikeName} placeholder="e.g. Amflow PL Carbon" onChange={(e) => setS({ ...s, bikeName: e.target.value })} />
            </label>
            <div className="flex flex-col gap-1.5">
              <label className="flex flex-col gap-1.5 font-medium">
                Battery size (Wh)
                <input className={input} type="number" min={200} max={2000} step={10} value={s.batteryWh} onChange={(e) => setS({ ...s, batteryWh: Number(e.target.value) })} />
                <span className="text-xs font-normal text-muted">Avinox bikes come with 600 or 800 Wh. Add a range extender here if you ride with one.</span>
              </label>
              {packChanged && (
                <span className="flex flex-col gap-1.5 text-sm font-normal">
                  <label className="flex min-h-9 items-center gap-2">
                    <input type="radio" name="pack" checked={packChange === "new"} onChange={() => setPackChange("new")} />
                    New battery from
                    <input type="date" className={`${input} min-h-9`} value={swapDate} max={todayIn(s.timeZone)} onChange={(e) => setSwapDate(e.target.value)} disabled={packChange !== "new"} />
                  </label>
                  <label className="flex min-h-9 items-center gap-2">
                    <input type="radio" name="pack" checked={packChange === "fix"} onChange={() => setPackChange("fix")} />
                    {settings.batteryWh} Wh was wrong: correct it for every ride{settings.batteryHistory.length ? " since the last battery change" : ""}
                  </label>
                </span>
              )}
              {s.batteryHistory.length > 0 && (
                <span className="flex flex-col gap-1 text-xs font-normal text-muted">
                  {s.batteryHistory.map((b, i) => (
                    <span key={b.until} className="flex items-center gap-2">
                      {b.wh} Wh before {new Date(b.until * 1000).toLocaleDateString("en-GB", { timeZone: s.timeZone })}
                      <button type="button" className="underline" onClick={() => setS({ ...s, batteryHistory: s.batteryHistory.filter((_, j) => j !== i) })}>
                        Remove
                      </button>
                    </span>
                  ))}
                </span>
              )}
            </div>
            <fieldset className="flex flex-col gap-1.5 font-medium">
              <legend className="mb-1.5">Units</legend>
              <div className="flex gap-4 font-normal">
                {(["mi", "km"] as const).map((u) => (
                  <label key={u} className="flex min-h-11 items-center gap-2">
                    <input type="radio" name="units" checked={s.units === u} onChange={() => setS({ ...s, units: u })} />
                    {u === "mi" ? "Miles and feet" : "Kilometres and metres"}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="flex flex-col gap-1.5 font-medium">
              Timezone
              <select className={input} value={s.timeZone} onChange={(e) => setS({ ...s, timeZone: e.target.value })}>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              <span className="text-xs font-normal text-muted">
                For ride dates, months and names.
                {deviceZone && deviceZone !== s.timeZone && (
                  <>
                    {" "}
                    <button type="button" className="underline" onClick={() => setS({ ...s, timeZone: deviceZone })}>
                      Use this device&apos;s ({deviceZone.replace(/_/g, " ")})
                    </button>
                  </>
                )}
              </span>
            </label>
            <div className="flex flex-col gap-1.5 font-medium">
              Electricity price
              <div className="flex gap-2">
                <label className="flex flex-col">
                  <span className="sr-only">Currency symbol</span>
                  <input className={`${input} w-16`} value={s.currency} maxLength={4} onChange={(e) => setS({ ...s, currency: e.target.value })} />
                </label>
                <label className="flex flex-1 flex-col">
                  <span className="sr-only">Price per kWh</span>
                  <input
                    className={input}
                    type="number"
                    min={0}
                    max={10}
                    step={0.001}
                    value={s.pricePerKwh}
                    onChange={(e) => setS({ ...s, pricePerKwh: Number(e.target.value) })}
                  />
                </label>
                <span className="flex items-center text-sm font-normal text-muted">per kWh</span>
              </div>
              <span className="text-xs font-normal text-muted">From your energy bill, for what charging costs. A tenth is allowed for charger losses.</span>
            </div>
          </div>
        </Card>
        <Card title="Assist mode names" sub="Ride files store a number for each mode, not its name. If a mode looks wrong on the charts, rename it here.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {modes.map((m) => (
              <label key={m} className="flex flex-col gap-1.5 font-medium">
                Mode number {m}
                <input
                  className={input}
                  value={s.modeNames[m] ?? ""}
                  placeholder={DEFAULT_MODE_NAMES[m] ?? modeName({ ...s, modeNames: {} }, m)}
                  onChange={(e) => setS({ ...s, modeNames: { ...s.modeNames, [m]: e.target.value } })}
                />
              </label>
            ))}
          </div>
        </Card>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={state === "saving"} className="min-h-11 rounded-[10px] bg-accent px-5 font-semibold text-on-accent disabled:opacity-60">
            Save
          </button>
          <span className="text-[13px] text-muted" role="status">
            {state === "saved" ? "Saved" : state === "error" ? "Couldn't save. Try again." : ""}
          </span>
        </div>
      </form>
      <Card title="Account" sub={email ? `Signed in as ${email}` : undefined}>
        <div className="flex flex-wrap gap-2.5">
          <button type="button" onClick={() => out()} disabled={deleting} className="min-h-11 rounded-[10px] border border-edge px-4 font-semibold">
            Sign out
          </button>
          <button type="button" onClick={() => out(true)} disabled={deleting} className="min-h-11 rounded-[10px] border border-edge px-4 font-semibold">
            Sign out everywhere
          </button>
          <button type="button" onClick={wipe} disabled={deleting} className="min-h-11 rounded-[10px] border border-edge px-4 font-semibold text-hot disabled:opacity-50">
            {deleting ? "Deleting…" : "Delete all rides"}
          </button>
        </div>
        {deleteError && <p role="alert" className="mt-2 text-hot">{deleteError}</p>}
      </Card>
    </div>
  );
}
