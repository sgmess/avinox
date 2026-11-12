import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { getRide, getSettings, getTracks, listRides, listShapes } from "@/lib/data";
import { measureEfficiency } from "@/lib/stats";
import { climbCandidates, compareRide } from "@/lib/insights";
import { RIDE_ID } from "@/lib/validate";
import { CompareView } from "@/components/CompareView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Compare · Ride Stats" };

export default async function ComparePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!RIDE_ID.test(id)) notFound();
  const viewer = await requireViewer();
  const [settings, rides, found] = await Promise.all([getSettings(viewer.uid), listRides(viewer.uid), getRide(viewer.uid, id)]);
  if (!found) notFound();
  const { ride, track } = found;
  // Every ride's squares say which share the route and which passed this ride's
  // climbs; only those few have their full route loaded.
  const shapes = await listShapes(viewer.uid, rides.map((r) => r.id));
  const cells = new Map(rides.map((r) => [r.id, new Set(shapes[r.id]?.cells ?? [])]));
  const others = rides.filter((r) => r.id !== id);
  const tracks = await getTracks(viewer.uid, climbCandidates(track, others.map((r) => ({ id: r.id, cells: cells.get(r.id)! }))));
  const all = rides.map((r) => ({ ride: r, track: r.id === id ? track : tracks[r.id] ?? [], cells: cells.get(r.id)! }));
  return <CompareView ride={ride} data={compareRide(ride, track, all)} settings={settings} efficiency={measureEfficiency(rides, settings)} base="/rides" />;
}
