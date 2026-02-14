import type { OvNlTripLeg, OvNlTripSummary } from "./types";

const DEFAULT_DELAY_THRESHOLD_MINUTES = 2;

function parseDateTimeMs(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function hasSignificantDelay(opts: {
  planned: string | null;
  actual: string | null;
  thresholdMinutes?: number;
}): boolean {
  const plannedMs = parseDateTimeMs(opts.planned);
  const actualMs = parseDateTimeMs(opts.actual);
  if (plannedMs == null || actualMs == null) return false;
  const thresholdMinutes = opts.thresholdMinutes ?? DEFAULT_DELAY_THRESHOLD_MINUTES;
  const diffMinutes = Math.abs(actualMs - plannedMs) / (60 * 1000);
  return diffMinutes >= thresholdMinutes;
}

function hasTrackChange(planned: string | null, actual: string | null): boolean {
  const plannedNorm = String(planned ?? "").trim();
  const actualNorm = String(actual ?? "").trim();
  if (!plannedNorm || !actualNorm) return false;
  return plannedNorm !== actualNorm;
}

export function legHasDisruption(leg: OvNlTripLeg): boolean {
  if (leg.cancelled) return true;
  if (Array.isArray(leg.messages) && leg.messages.length > 0) return true;

  if (
    hasSignificantDelay({
      planned: leg.originPlannedDateTime,
      actual: leg.originActualDateTime,
    }) ||
    hasSignificantDelay({
      planned: leg.destinationPlannedDateTime,
      actual: leg.destinationActualDateTime,
    })
  ) {
    return true;
  }

  if (
    hasTrackChange(leg.originPlannedTrack, leg.originActualTrack) ||
    hasTrackChange(leg.destinationPlannedTrack, leg.destinationActualTrack)
  ) {
    return true;
  }

  return false;
}

export function tripHasLegDisruptions(trip: OvNlTripSummary): boolean {
  if (!trip || !Array.isArray(trip.legs) || trip.legs.length === 0) return false;

  const status = String(trip.status ?? "").trim().toUpperCase();
  if (status.includes("CANCEL") || status.includes("DISRUPT")) {
    return true;
  }

  return trip.legs.some((leg) => legHasDisruption(leg));
}
