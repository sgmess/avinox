import { CONFIDENCE_COLOR, CONFIDENCE_LABEL, rideConfidence } from "@/lib/confidence";
import type { RideSummary } from "@/lib/ride";

/** A dot by a ride in the list, only when its figures are worth a second look. */
export function ConfidenceDot({ ride }: { ride: RideSummary }) {
  const c = rideConfidence(ride);
  if (c.level === "high" || c.level === "unknown") return null;
  const label = `${CONFIDENCE_LABEL[c.level]} data confidence: ${c.reasons.join(" ")}`;
  return <span className="ml-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: CONFIDENCE_COLOR[c.level] }} title={label} aria-label={label} role="img" />;
}

/** The ride page's rating, with what lowered it. */
export function ConfidenceNote({ ride }: { ride: RideSummary }) {
  const c = rideConfidence(ride);
  const chip = (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-edge px-2.5 py-0.5 text-xs">
      <span className="h-2 w-2 rounded-full" style={{ background: CONFIDENCE_COLOR[c.level] }} aria-hidden="true" />
      Data confidence: <b className="font-semibold">{CONFIDENCE_LABEL[c.level]}</b>
    </span>
  );
  if (!c.reasons.length) return <div title="Full recording, no damaged readings, GPS, altitude and battery all present.">{chip}</div>;
  return (
    <details className="text-[13px]">
      <summary className="cursor-pointer list-none">{chip} <span className="text-muted">why?</span></summary>
      <ul className="mt-2 list-disc pl-5 text-soft">
        {c.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </details>
  );
}
