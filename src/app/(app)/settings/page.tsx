import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { getSettings, listRides } from "@/lib/data";
import { SettingsForm } from "@/components/SettingsForm";
import { BackupCard } from "@/components/BackupCard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings · Ride Stats" };

export default async function SettingsPage() {
  const viewer = await requireViewer();
  const [settings, rides] = await Promise.all([getSettings(viewer.uid), listRides(viewer.uid)]);
  const seen = [...new Set(rides.flatMap((r) => Object.keys(r.modeS)))];
  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-4 px-4 pt-6 pb-16 sm:px-6">
      <Link href="/" className="flex min-h-11 items-center gap-1.5 font-medium">
        <span aria-hidden="true">←</span> Dashboard
      </Link>
      <h1 className="font-display text-3xl font-semibold">Settings</h1>
      <SettingsForm settings={settings} seenModes={seen} email={viewer.email} />
      <BackupCard />
    </div>
  );
}
