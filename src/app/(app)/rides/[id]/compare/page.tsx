import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { getSettings, listRides, listTracks } from "@/lib/data";
import { measureEfficiency } from "@/lib/stats";
import { compareRide } from "@/lib/insights";
import { RIDE_ID } from "@/lib/validate";
import { CompareView } from "@/components/CompareView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Compare · Ride Stats" };

export default async function ComparePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!RIDE_ID.test(id)) notFound();
  const viewer = await requireViewer();
  const [settings, rides, tracks] = await Promise.all([getSettings(viewer.uid), listRides(viewer.uid), listTracks(viewer.uid)]);
  const ride = rides.find((r) => r.id === id);
  if (!ride) notFound();
  const data = compareRide(ride, tracks[id] ?? [], rides.map((r) => ({ ride: r, track: tracks[r.id] ?? [] })));
  return <CompareView ride={ride} data={data} settings={settings} efficiency={measureEfficiency(rides, settings)} base="/rides" />;
}
