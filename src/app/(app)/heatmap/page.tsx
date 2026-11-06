import { requireViewer } from "@/lib/auth";
import { getSettings, listRides, listTracks } from "@/lib/data";
import { heatRoutes } from "@/lib/heat";
import { Heatmap } from "@/components/Heatmap";

export const dynamic = "force-dynamic";
export const metadata = { title: "Heatmap · Ride Stats" };

export default async function HeatmapPage() {
  const viewer = await requireViewer();
  const [settings, rides, tracks] = await Promise.all([getSettings(viewer.uid), listRides(viewer.uid), listTracks(viewer.uid)]);
  return <Heatmap routes={heatRoutes(rides, tracks)} base="/rides" timeZone={settings.timeZone} back="/" />;
}
