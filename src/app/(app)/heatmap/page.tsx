import { requireViewer } from "@/lib/auth";
import { getSettings, listRides, listShapes } from "@/lib/data";
import { heatFromShapes } from "@/lib/heat";
import { Heatmap } from "@/components/Heatmap";

export const dynamic = "force-dynamic";
export const metadata = { title: "Heatmap · Ride Stats" };

export default async function HeatmapPage() {
  const viewer = await requireViewer();
  const [settings, rides] = await Promise.all([getSettings(viewer.uid), listRides(viewer.uid)]);
  // A few kB a ride, not its whole route.
  const shapes = await listShapes(viewer.uid, rides.map((r) => r.id));
  return <Heatmap routes={heatFromShapes(rides, shapes)} base="/rides" timeZone={settings.timeZone} back="/" />;
}
