import { notFound } from "next/navigation";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { measureEfficiency } from "@/lib/stats";
import { compareRide } from "@/lib/insights";
import { CompareView } from "@/components/CompareView";
import { demo } from "../../../data";

export default async function DemoCompare({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { summaries, tracks } = demo();
  const ride = summaries.find((r) => r.id === id);
  if (!ride) notFound();
  const data = compareRide(ride, tracks[id] ?? [], summaries.map((r) => ({ ride: r, track: tracks[r.id] ?? [] })));
  return <CompareView ride={ride} data={data} settings={DEFAULT_SETTINGS} efficiency={measureEfficiency(summaries, DEFAULT_SETTINGS)} base="/demo/rides" />;
}
