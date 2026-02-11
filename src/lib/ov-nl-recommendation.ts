import type { OvNlTripSummary } from "./types";

export function pickRecommendedTrip(trips: OvNlTripSummary[]): OvNlTripSummary | null {
  if (trips.length === 0) return null;
  return trips[0] ?? null;
}

export function pickRecommendedTripUid(trips: OvNlTripSummary[]): string {
  return pickRecommendedTrip(trips)?.uid ?? "";
}

export function pickRecommendedTripUidForSearch({
  primaryTrips,
  alternativeTrips,
}: {
  primaryTrips: OvNlTripSummary[];
  alternativeTrips: OvNlTripSummary[];
}): string {
  return pickRecommendedTripUid(primaryTrips.length > 0 ? primaryTrips : alternativeTrips);
}
