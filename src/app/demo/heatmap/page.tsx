import { DEFAULT_SETTINGS } from "@/lib/settings";
import { heatRoutes } from "@/lib/heat";
import { Heatmap } from "@/components/Heatmap";
import { demo } from "../data";

export const metadata = { title: "Heatmap · Demo · Ride Stats" };

export default function DemoHeatmap() {
  const { summaries, tracks } = demo();
  return <Heatmap routes={heatRoutes(summaries, tracks)} base="/demo/rides" timeZone={DEFAULT_SETTINGS.timeZone} back="/demo" />;
}
