"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { DEFAULT_MODE_NAMES, modeName, type Settings } from "@/lib/settings";
import { clientAuth, firebaseConfigured } from "@/lib/firebase-client";
import { Card } from "./ui";

const input = "min-h-11 rounded-[10px] border border-edge px-3 text-sm";

export function SettingsForm({ settings, seenModes, email }: { settings: Settings; seenModes: string[]; email: string }) {
  const router = useRouter();
  const [s, setS] = useState(settings);
  const [state, setState] = useState<"" | "saving" | "saved" | "error">("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const modes = [...new Set([...seenModes, "1", "2", "3", "4"])].sort((a, b) => Number(a) - Number(b));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState("saving");
    const res = await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(s) }).catch(() => null);
    setState(res?.ok ? "saved" : "error");
    if (res?.ok) router.refresh();
  }

  async function out() {
    await fetch("/api/session", { method: "DELETE" });
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
            <label className="flex flex-col gap-1.5 font-medium">
              Battery size (Wh)
              <input className={input} type="number" min={200} max={2000} step={10} value={s.batteryWh} onChange={(e) => setS({ ...s, batteryWh: Number(e.target.value) })} />
              <span className="text-xs font-normal text-muted">Avinox bikes come with 600 or 800 Wh. Add a range extender here if you ride with one.</span>
            </label>
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
          <button type="button" onClick={out} disabled={deleting} className="min-h-11 rounded-[10px] border border-edge px-4 font-semibold">
            Sign out
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
