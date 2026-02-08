"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  OvNlDisruption,
  OvNlStation,
  OvNlToolOutput,
  OvNlTripLeg,
  OvNlTripSummary,
} from "@/lib/types";
import styles from "./ov-nl-card.module.css";

type OvNlCardProps = {
  output: OvNlToolOutput;
  canRequestTripDetails?: boolean;
  onRequestTripDetails?: (ctxRecon: string) => void;
};

const OV_NL_TIME_ZONE = "Europe/Amsterdam";

function formatTime(value: string | null): string {
  if (!value) return "--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: OV_NL_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: OV_NL_TIME_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
}

function zonedDateKey(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("nl-NL", {
    timeZone: OV_NL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((p) => p.type === "year")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  if (!year || !month || !day) return "";
  return `${year}-${month}-${day}`;
}

function tripDateLabel(trip: OvNlTripSummary): string {
  const departure = trip.departureActualDateTime || trip.departurePlannedDateTime;
  const arrival = trip.arrivalActualDateTime || trip.arrivalPlannedDateTime;
  const depLabel = formatDate(departure);
  if (!depLabel) return "";

  const depKey = zonedDateKey(departure);
  const arrKey = zonedDateKey(arrival);
  if (!arrKey || !depKey || depKey === arrKey) return depLabel;
  const arrLabel = formatDate(arrival);
  return arrLabel ? `${depLabel} → ${arrLabel}` : depLabel;
}

function pickRecommendedTrip(trips: OvNlTripSummary[]): OvNlTripSummary | null {
  if (trips.length === 0) return null;

  const optimal = trips.find((trip) => trip.optimal);
  if (optimal) return optimal;

  const withIndex = trips.map((trip, index) => ({ trip, index }));
  withIndex.sort((a, b) => {
    if (a.trip.transfers !== b.trip.transfers) return a.trip.transfers - b.trip.transfers;

    const aDuration = a.trip.actualDurationMinutes ?? a.trip.plannedDurationMinutes ?? Number.POSITIVE_INFINITY;
    const bDuration = b.trip.actualDurationMinutes ?? b.trip.plannedDurationMinutes ?? Number.POSITIVE_INFINITY;
    if (aDuration !== bDuration) return aDuration - bDuration;

    const aDeparture = Date.parse(a.trip.departureActualDateTime || a.trip.departurePlannedDateTime || "");
    const bDeparture = Date.parse(b.trip.departureActualDateTime || b.trip.departurePlannedDateTime || "");
    if (Number.isFinite(aDeparture) && Number.isFinite(bDeparture) && aDeparture !== bDeparture) {
      return aDeparture - bDeparture;
    }

    return a.index - b.index;
  });

  return withIndex[0]?.trip ?? trips[0] ?? null;
}

function tripDurationMinutes(trip: OvNlTripSummary): number | null {
  const raw = trip.actualDurationMinutes ?? trip.plannedDurationMinutes;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return null;
  return Math.floor(raw);
}

function formatDuration(minutes: number | null): string {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 0) {
    return "--";
  }
  const rounded = Math.floor(minutes);
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  if (hours <= 0) return `${mins} min`;
  return `${hours}:${String(mins).padStart(2, "0")} u`;
}

function stationLabel(station: OvNlStation | null): string {
  if (!station) return "Onbekend station";
  return station.nameLong || station.nameMedium || station.nameShort || station.code;
}

function stationDisplayName(station: OvNlStation): string {
  return station.nameLong || station.nameMedium || station.nameShort || station.code;
}

function disruptionTypeLabel(type: OvNlDisruption["type"]): string {
  if (type === "CALAMITY") return "Calamiteit";
  if (type === "MAINTENANCE") return "Werkzaamheden";
  return "Storing";
}

function viewFromKind(kind: OvNlToolOutput["kind"]): "trips" | "board" | "alerts" | "simple" {
  if (kind === "trips.search" || kind === "trips.detail" || kind === "journey.detail") {
    return "trips";
  }
  if (kind === "departures.list" || kind === "departures.window" || kind === "arrivals.list") return "board";
  if (
    kind === "disruptions.list" ||
    kind === "disruptions.by_station" ||
    kind === "disruptions.detail"
  ) {
    return "alerts";
  }
  return "simple";
}

function HeaderContent({ output }: { output: OvNlToolOutput }) {
  if (output.kind === "departures.list") {
    return (
      <>
        <h3 className={styles.title}>Vertrekbord</h3>
        <p className={styles.subtitle}>{stationLabel(output.station)}</p>
      </>
    );
  }
  if (output.kind === "departures.window") {
    const fromDate = formatDate(output.window.fromDateTime);
    const toDate = formatDate(output.window.toDateTime);
    const fromTime = formatTime(output.window.fromDateTime);
    const toTime = formatTime(output.window.toDateTime);
    const windowLabel =
      fromDate && toDate && fromDate !== toDate
        ? `${fromDate} ${fromTime} → ${toDate} ${toTime}`
        : `${fromDate || ""} · ${fromTime}–${toTime}`.trim();
    return (
      <>
        <h3 className={styles.title}>Vertrekbord</h3>
        <p className={styles.subtitle}>
          {stationLabel(output.station)} {windowLabel ? `· ${windowLabel}` : ""}
        </p>
      </>
    );
  }
  if (output.kind === "arrivals.list") {
    return (
      <>
        <h3 className={styles.title}>Aankomstbord</h3>
        <p className={styles.subtitle}>{stationLabel(output.station)}</p>
      </>
    );
  }
  if (output.kind === "trips.search") {
    const recommended = pickRecommendedTrip(output.trips);
    const dateLabel = recommended ? tripDateLabel(recommended) : "";
    const routeLabel = recommended
      ? `${recommended.departureName} → ${recommended.arrivalName}`
      : `${stationLabel(output.from)} → ${stationLabel(output.to)}`;
    const summary = [dateLabel, routeLabel].filter(Boolean).join(" • ");
    return (
      <>
        <h3 className={styles.title}>Reisadvies</h3>
        <p className={styles.subtitle}>{summary}</p>
      </>
    );
  }
  if (output.kind === "trips.detail") {
    const trip = output.trip;
    const dateLabel = trip ? tripDateLabel(trip) : "";
    const routeLabel = trip ? `${trip.departureName} → ${trip.arrivalName}` : "Onbekende route";
    const summary = [dateLabel, routeLabel].filter(Boolean).join(" • ");
    return (
      <>
        <h3 className={styles.title}>Reisoverzicht - gedetailleerd</h3>
        <p className={styles.subtitle}>{summary}</p>
      </>
    );
  }
  if (output.kind === "journey.detail") {
    return (
      <>
        <h3 className={styles.title}>Journey detail</h3>
        <p className={styles.subtitle}>
          {output.trainNumber ? `Trein ${output.trainNumber}` : output.journeyId}
        </p>
      </>
    );
  }
  if (output.kind === "disruptions.by_station") {
    return (
      <>
        <h3 className={styles.title}>Storingen rond station</h3>
        <p className={styles.subtitle}>{stationLabel(output.station)}</p>
      </>
    );
  }
  if (output.kind === "disruptions.detail") {
    return (
      <>
        <h3 className={styles.title}>Storing detail</h3>
        <p className={styles.subtitle}>{output.disruption?.title || "Onbekend"}</p>
      </>
    );
  }
  if (output.kind === "disruptions.list") {
    return (
      <>
        <h3 className={styles.title}>Actuele storingen</h3>
        <p className={styles.subtitle}>{output.disruptions.length} meldingen</p>
      </>
    );
  }
  if (output.kind === "stations.search") {
    return (
      <>
        <h3 className={styles.title}>Stations zoeken</h3>
        <p className={styles.subtitle}>Query: {output.query}</p>
      </>
    );
  }
  if (output.kind === "stations.nearest") {
    return (
      <>
        <h3 className={styles.title}>Dichtstbijzijnde stations</h3>
        <p className={styles.subtitle}>
          Locatie: {output.latitude.toFixed(4)}, {output.longitude.toFixed(4)}
        </p>
      </>
    );
  }
  if (output.kind === "disambiguation") {
    return (
      <>
        <h3 className={styles.title}>Station verduidelijking</h3>
        <p className={styles.subtitle}>{output.message}</p>
      </>
    );
  }
  return (
    <>
      <h3 className={styles.title}>OV NL fout</h3>
      <p className={styles.subtitle}>{output.error.message}</p>
    </>
  );
}

function renderBoardRows(output: OvNlToolOutput) {
  if (
    output.kind !== "departures.list" &&
    output.kind !== "departures.window" &&
    output.kind !== "arrivals.list"
  ) {
    return null;
  }

  const isDepartures = output.kind === "departures.list" || output.kind === "departures.window";
  const rows = isDepartures ? output.departures : output.arrivals;
  const destinationTitle = isDepartures ? "Bestemming" : "Herkomst";
  const emptyLabel = isDepartures
    ? "Geen data beschikbaar, vraag om een meer actueel tijdswindow"
    : "Geen ritten beschikbaar.";

  return (
    <div className={styles.boardWrap} data-testid="ov-nl-card:board">
      <div className={styles.boardHeader}>
        <span>Tijd</span>
        <span>{destinationTitle}</span>
        <span>Spoor</span>
        <span>Status</span>
      </div>
      {rows.length === 0 ? (
        <div className={styles.emptyState}>{emptyLabel}</div>
      ) : (
        rows.map((row) => (
          <div className={styles.boardRow} key={row.id}>
            <div>
              <div className={styles.bigTime}>{formatTime(row.actualDateTime || row.plannedDateTime)}</div>
              <div className={styles.smallTime}>{formatDate(row.plannedDateTime)}</div>
            </div>
            <div>
              <div className={styles.primaryText}>
                {"destination" in row ? row.destination : row.origin}
              </div>
              <div className={styles.secondaryText}>
                {row.trainCategory} {row.trainNumber}
              </div>
            </div>
            <div className={styles.platformCell}>{row.actualTrack || row.plannedTrack || "-"}</div>
            <div>
              <span className={styles.statusBadge}>{row.status || (row.cancelled ? "CANCELLED" : "OK")}</span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function renderTripTimeline(
  legs: OvNlTripLeg[],
  opts?: {
    openStopsByDefault?: boolean;
    showStopCountLabel?: boolean;
    emphasizeLegRoute?: boolean;
    showLegRouteTimes?: boolean;
  }
) {
  if (legs.length === 0) {
    return <div className={styles.emptyState}>Geen trajectdetails beschikbaar.</div>;
  }

  const stationKey = (value: unknown) =>
    String(value ?? "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const stationMatches = (a: string, b: string) => {
    if (!a || !b) return false;
    if (a === b) return true;
    // Handle common abbreviations like "Almere C" vs "Almere Centrum".
    if (a.startsWith(b) || b.startsWith(a)) return true;
    return false;
  };

  const showLegRouteTimes = opts?.showLegRouteTimes !== false;

  return (
    <div className={styles.timeline} data-testid="ov-nl-card:timeline">
      {legs.map((leg) => (
        <div className={styles.timelineItem} key={`${leg.index}-${leg.originName}-${leg.destinationName}`}>
          <div className={styles.timelineRail}>
            <span className={styles.timelineDot} />
            <span className={styles.timelineLine} />
          </div>
          <div className={styles.timelineMain}>
            <div className={styles.legHead}>
              <span className={styles.legName}>{leg.name}</span>
            </div>
            <div
              className={`${styles.legRoute} ${opts?.emphasizeLegRoute ? styles.legRouteEmphasis : ""}`}
            >
              {showLegRouteTimes ? (
                <>
                  {leg.originName} ({formatTime(leg.originActualDateTime || leg.originPlannedDateTime)})
                  {" → "}
                  {leg.destinationName} ({formatTime(leg.destinationActualDateTime || leg.destinationPlannedDateTime)})
                </>
              ) : (
                <>
                  {leg.originName}
                  {" → "}
                  {leg.destinationName}
                </>
              )}
            </div>
            <div className={styles.legMeta}>
              {opts?.showStopCountLabel !== false && leg.stopCount > 0 ? (
                <span>Stops: {leg.stopCount}</span>
              ) : null}
              {leg.cancelled ? <span>Geannuleerd</span> : null}
            </div>
            {Array.isArray(leg.stops) && leg.stops.length > 0 ? (
              <details className={styles.legStops} open={Boolean(opts?.openStopsByDefault)}>
                {(() => {
                  const displayStops = leg.stops.filter((stop) => {
                    const planned = stop.plannedDateTime;
                    const actual = stop.actualDateTime;
                    if (actual && !Number.isNaN(new Date(actual).getTime())) return true;
                    if (planned && !Number.isNaN(new Date(planned).getTime())) return true;
                    return false;
                  });
                  if (displayStops.length === 0) return null;

                  return (
                    <>
                      <summary className={styles.legStopsSummary}>
                        Show stops ({displayStops.length})
                      </summary>
                      <div className={styles.legStopsList} data-testid="ov-nl-card:leg-stops">
                        {displayStops.map((stop, idx) => {
                          const planned = stop.plannedDateTime;
                          const actual = stop.actualDateTime;
                          const showPlanned =
                            Boolean(actual && planned) &&
                      formatTime(actual) !== "--:--" &&
                      formatTime(planned) !== "--:--" &&
                      formatTime(actual) !== formatTime(planned);
                          const stopNameKey = stationKey(stop.name);
                          const originKey = stationKey(leg.originName);
                          const destinationKey = stationKey(leg.destinationName);
                          const inferredTrack =
                            stationMatches(stopNameKey, originKey)
                              ? leg.originActualTrack || leg.originPlannedTrack || ""
                              : stationMatches(stopNameKey, destinationKey)
                                ? leg.destinationActualTrack || leg.destinationPlannedTrack || ""
                                : "";

                          const track = stop.actualTrack || stop.plannedTrack || inferredTrack || "";
                          return (
                            <div className={styles.legStopsRow} key={`${stop.name}-${idx}`}>
                              <div className={styles.legStopsTime}>
                                <span>{formatTime(actual || planned)}</span>
                          {showPlanned ? (
                            <span className={styles.legStopsPlanned}>
                              {formatTime(planned)}
                            </span>
                          ) : null}
                              </div>
                              <div className={styles.legStopsName}>
                                <span>{stop.name}</span>
                                {stop.cancelled ? (
                                  <span className={styles.legStopsStatusInline}>Geannuleerd</span>
                                ) : null}
                              </div>
                              <div className={styles.legStopsTrackCell}>
                                {track ? `Spoor ${track}` : ""}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  );
                })()}
              </details>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function TripsView({
  output,
  canRequestTripDetails,
  onRequestTripDetails,
}: {
  output: OvNlToolOutput;
  canRequestTripDetails?: boolean;
  onRequestTripDetails?: (ctxRecon: string) => void;
}) {
  const tripOptions: OvNlTripSummary[] =
    output.kind === "trips.search"
      ? output.trips
      : output.kind === "trips.detail" && output.trip
        ? [output.trip]
        : [];
  const journeyLegs = output.kind === "journey.detail" ? output.legs : [];

  const isTripDetail = output.kind === "trips.detail";
  const hasTrips = tripOptions.length > 0;
  const [selectedTripUid, setSelectedTripUid] = useState("");
  const recommendedTrip = useMemo(() => pickRecommendedTrip(tripOptions), [tripOptions]);
  const recommendedTripUid = recommendedTrip?.uid ?? "";
  const tripBadges = useMemo(() => {
    const directTripUids = new Set<string>();
    for (const trip of tripOptions) {
      if (trip.transfers === 0) directTripUids.add(trip.uid);
    }

    let fastestDuration: number | null = null;
    for (const trip of tripOptions) {
      const duration = tripDurationMinutes(trip);
      if (duration == null) continue;
      fastestDuration = fastestDuration == null ? duration : Math.min(fastestDuration, duration);
    }
    const fastestTripUids = new Set<string>();
    if (fastestDuration != null) {
      for (const trip of tripOptions) {
        const duration = tripDurationMinutes(trip);
        if (duration != null && duration === fastestDuration) fastestTripUids.add(trip.uid);
      }
    }

    let minTransfers: number | null = null;
    for (const trip of tripOptions) {
      const transfers = typeof trip.transfers === "number" && Number.isFinite(trip.transfers) ? trip.transfers : null;
      if (transfers == null) continue;
      minTransfers = minTransfers == null ? transfers : Math.min(minTransfers, transfers);
    }
    const minTransfersTripUids = new Set<string>();
    if (minTransfers != null) {
      for (const trip of tripOptions) {
        if (trip.transfers === minTransfers) minTransfersTripUids.add(trip.uid);
      }
    }

    return {
      directTripUids,
      fastestTripUids,
      minTransfersTripUids,
    };
  }, [tripOptions]);

  useEffect(() => {
    if (tripOptions.length === 0) return;
    if (selectedTripUid && tripOptions.some((trip) => trip.uid === selectedTripUid)) return;
    setSelectedTripUid(recommendedTripUid || tripOptions[0]?.uid || "");
  }, [recommendedTripUid, selectedTripUid, tripOptions]);

  const selectedTrip = hasTrips
    ? tripOptions.find((trip) => trip.uid === selectedTripUid) || tripOptions[0]
    : null;

  return (
    <div
      className={`${styles.tripsLayout} ${isTripDetail ? styles.tripsLayoutSingle : ""}`}
      data-testid="ov-nl-card:trips"
    >
      {!isTripDetail ? (
        <div className={styles.optionsColumn}>
          {output.kind === "journey.detail" ? (
            <div className={styles.optionRow}>
              <div className={styles.optionTimes}>Journey detail</div>
              <div className={styles.optionSubline}>
                {output.trainNumber ? `Trein ${output.trainNumber}` : output.journeyId}
              </div>
            </div>
          ) : tripOptions.length === 0 ? (
            <div className={styles.emptyState}>Geen reisopties gevonden.</div>
          ) : (
            tripOptions.map((trip, index) => {
              const selected = selectedTrip?.uid === trip.uid;
              const isRecommended = trip.uid === recommendedTripUid;
              const isDirect = tripBadges.directTripUids.has(trip.uid);
              const isFastest = tripBadges.fastestTripUids.has(trip.uid);
              const isMinTransfers = tripBadges.minTransfersTripUids.has(trip.uid);
              const badges: Array<{ label: string; tone: "primary" | "secondary" }> = [];
              if (isRecommended) badges.push({ label: "Beste optie", tone: "primary" });
              if (isDirect) badges.push({ label: "Direct", tone: "secondary" });
              if (isFastest) badges.push({ label: "Snelste", tone: "secondary" });
              if (isMinTransfers && !isDirect) {
                badges.push({ label: "Min. overstappen", tone: "secondary" });
              }

              return (
                <button
                  className={`${styles.optionRow} ${selected ? styles.optionRowSelected : ""}`}
                  data-testid={`ov-nl-card:trip-option:${index}`}
                  key={trip.uid || index}
                  onClick={() => setSelectedTripUid(trip.uid)}
                  type="button"
                >
                <div className={styles.optionMain}>
                  <div className={styles.optionTimes}>
                    {formatTime(trip.departureActualDateTime || trip.departurePlannedDateTime)} →{" "}
                    {formatTime(trip.arrivalActualDateTime || trip.arrivalPlannedDateTime)}
                  </div>
                  <div className={styles.optionSubline}>
                    {trip.transfers}x overstap • {formatDuration(trip.actualDurationMinutes || trip.plannedDurationMinutes)}
                  </div>
                </div>
                  {badges.length > 0 ? (
                    <div className={styles.badgeStack} aria-label="Reisoptie badges">
                      {badges.map((badge) => (
                        <span
                          className={`${styles.badge} ${badge.tone === "primary" ? styles.badgePrimary : styles.badgeSecondary}`}
                          key={badge.label}
                        >
                          {badge.label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
      <div className={styles.detailPanel}>
        {output.kind === "journey.detail" ? (
          <>
            <div className={styles.detailTop}>
              <div>
                <div className={styles.detailLabel}>Journey</div>
                <div className={styles.detailValue}>
                  {output.trainNumber ? `Trein ${output.trainNumber}` : output.journeyId}
                </div>
              </div>
            </div>
            {renderTripTimeline(journeyLegs)}
          </>
        ) : !selectedTrip ? (
          <div className={styles.emptyState}>
            {output.kind === "trips.detail"
              ? "No trip details available. Try again or run a new trip search."
              : "Geen gekozen route."}
          </div>
        ) : (
          <>
            <div className={styles.detailTop}>
              <div>
                <div className={styles.detailLabel}>Vertrek</div>
                <div className={styles.detailValue}>
                  {formatTime(selectedTrip.departureActualDateTime || selectedTrip.departurePlannedDateTime)}
                </div>
              </div>
              <div>
                <div className={styles.detailLabel}>Aankomst</div>
                <div className={styles.detailValue}>
                  {formatTime(selectedTrip.arrivalActualDateTime || selectedTrip.arrivalPlannedDateTime)}
                </div>
              </div>
              <div>
                <div className={styles.detailLabel}>Reistijd</div>
                <div className={styles.detailValue}>
                  {formatDuration(selectedTrip.actualDurationMinutes || selectedTrip.plannedDurationMinutes)}
                </div>
              </div>
            </div>
            {output.kind !== "trips.detail" ? (
              <div className={styles.detailSubline}>
                {tripDateLabel(selectedTrip) ? `${tripDateLabel(selectedTrip)} • ` : ""}
                {selectedTrip.departureName} → {selectedTrip.arrivalName} • {selectedTrip.transfers}x overstap
              </div>
            ) : null}
            {output.kind === "trips.search" ? (
              <div className={styles.detailActions}>
                <button
                  className={styles.detailButton}
                  data-testid="ov-nl-card:load-details"
                  disabled={
                    !canRequestTripDetails ||
                    !onRequestTripDetails ||
                    !selectedTrip.ctxRecon
                  }
                  onClick={() => onRequestTripDetails?.(selectedTrip.ctxRecon)}
                  type="button"
                >
                  Load detailed legs
                </button>
              </div>
            ) : null}
            {renderTripTimeline(selectedTrip.legs, {
              openStopsByDefault: output.kind === "trips.detail",
              showStopCountLabel: output.kind !== "trips.detail",
              emphasizeLegRoute: output.kind === "trips.detail",
              showLegRouteTimes: output.kind !== "trips.detail",
            })}
          </>
        )}
      </div>
    </div>
  );
}

function renderDisruptions(output: OvNlToolOutput) {
  if (
    output.kind !== "disruptions.list" &&
    output.kind !== "disruptions.by_station" &&
    output.kind !== "disruptions.detail"
  ) {
    return null;
  }

  const disruptions =
    output.kind === "disruptions.detail"
      ? output.disruption
        ? [output.disruption]
        : []
      : output.disruptions;

  return (
    <div className={styles.disruptionList} data-testid="ov-nl-card:disruptions">
      {disruptions.length === 0 ? (
        <div className={styles.emptyState}>Geen verstoringen gevonden.</div>
      ) : (
        disruptions.map((disruption) => (
          <article className={styles.disruptionCard} key={disruption.id}>
            <div className={styles.disruptionHead}>
              <span className={styles.disruptionType}>{disruptionTypeLabel(disruption.type)}</span>
              <span className={styles.disruptionStatus}>
                {disruption.isActive ? "Actief" : "Niet actief"}
              </span>
            </div>
            <h4 className={styles.disruptionTitle}>{disruption.title || "Onbenoemde storing"}</h4>
            {disruption.topic ? <p className={styles.disruptionTopic}>{disruption.topic}</p> : null}
          </article>
        ))
      )}
    </div>
  );
}

function renderSimple(output: OvNlToolOutput) {
  if (output.kind === "stations.search" || output.kind === "stations.nearest") {
    return (
      <ul className={styles.stationList} data-testid="ov-nl-card:stations">
        {output.stations.length === 0 ? (
          <li className={styles.emptyState}>Geen stations gevonden.</li>
        ) : (
          output.stations.map((station) => (
            <li className={styles.stationRow} key={`${station.code}-${station.uicCode}`}>
              <div className={styles.primaryText}>{stationDisplayName(station)}</div>
              <div className={styles.secondaryText}>
                {station.code} • UIC {station.uicCode || "?"}
              </div>
            </li>
          ))
        )}
      </ul>
    );
  }

  if (output.kind === "disambiguation") {
    return (
      <ul className={styles.stationList} data-testid="ov-nl-card:disambiguation">
        {output.candidates.map((candidate, index) => (
          <li className={styles.stationRow} key={`${candidate.id}-${index}`}>
            <div className={styles.primaryText}>{candidate.label}</div>
            <div className={styles.secondaryText}>
              code {candidate.station.code} • confidence {(candidate.confidence * 100).toFixed(0)}%
            </div>
          </li>
        ))}
      </ul>
    );
  }

  if (output.kind !== "error") {
    return (
      <div className={styles.emptyState} data-testid="ov-nl-card:unsupported">
        Onbekende OV output.
      </div>
    );
  }

  return (
    <div className={styles.errorState} data-testid="ov-nl-card:error">
      <div className={styles.errorCode}>{output.error.code}</div>
      <div>{output.error.message}</div>
    </div>
  );
}

export function OvNlCard({ output, canRequestTripDetails, onRequestTripDetails }: OvNlCardProps) {
  const view = viewFromKind(output.kind);

  return (
    <section
      className={`${styles.cardRoot} ov-nl-card ov-nl-card--${view}`}
      data-ov-kind={output.kind}
      data-testid="tool:ovNlGateway"
    >
      <header className={styles.headerBand}>
        <div className={styles.headerTop}>
          <HeaderContent output={output} />
        </div>
      </header>

      <div className={styles.body}>
        {view === "board" ? renderBoardRows(output) : null}
        {view === "trips" ? (
          <TripsView
            canRequestTripDetails={canRequestTripDetails}
            onRequestTripDetails={onRequestTripDetails}
            output={output}
          />
        ) : null}
        {view === "alerts" ? renderDisruptions(output) : null}
        {view === "simple" ? renderSimple(output) : null}
      </div>
    </section>
  );
}
