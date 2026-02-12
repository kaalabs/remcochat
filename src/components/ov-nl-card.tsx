"use client";

import { useCallback, useMemo, useState } from "react";
import { useI18n, type I18nContextValue } from "@/components/i18n-provider";
import type {
  OvNlDisruption,
  OvNlStation,
  OvNlToolOutput,
  OvNlTripLeg,
  OvNlTripSummary,
} from "@/lib/types";
import { pickRecommendedTrip, pickRecommendedTripUidForSearch } from "@/lib/ov-nl-recommendation";
import styles from "./ov-nl-card.module.css";

type OvNlCardProps = {
  output: OvNlToolOutput;
};

const OV_NL_TIME_ZONE = "Europe/Amsterdam";
const REMCOCHAT_LAN_ADMIN_TOKEN_LOCAL_KEY = "remcochat:lanAdminToken";
const REMCOCHAT_LAN_ADMIN_TOKEN_SESSION_KEY = "remcochat:lanAdminToken:session";

type OvNlI18n = Pick<I18nContextValue, "locale" | "t" | "uiLanguage">;

function readLanAdminToken(): string {
  if (typeof window === "undefined") return "";
  const session = window.sessionStorage.getItem(REMCOCHAT_LAN_ADMIN_TOKEN_SESSION_KEY);
  if (session && session.trim()) return session.trim();
  const local = window.localStorage.getItem(REMCOCHAT_LAN_ADMIN_TOKEN_LOCAL_KEY);
  if (local && local.trim()) return local.trim();
  return "";
}

function formatTime(value: string | null, locale: string): string {
  if (!value) return "--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return new Intl.DateTimeFormat(locale, {
    timeZone: OV_NL_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatDate(value: string | null, locale: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    timeZone: OV_NL_TIME_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
}

function zonedDateKey(value: string | null, locale: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat(locale, {
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

function tripDateLabel(trip: OvNlTripSummary, locale: string): string {
  const departure = trip.departureActualDateTime || trip.departurePlannedDateTime;
  const arrival = trip.arrivalActualDateTime || trip.arrivalPlannedDateTime;
  const depLabel = formatDate(departure, locale);
  if (!depLabel) return "";

  const depKey = zonedDateKey(departure, locale);
  const arrKey = zonedDateKey(arrival, locale);
  if (!arrKey || !depKey || depKey === arrKey) return depLabel;
  const arrLabel = formatDate(arrival, locale);
  return arrLabel ? `${depLabel} → ${arrLabel}` : depLabel;
}

// Recommendation selection is owned by the OV tool/NS ordering; avoid UI re-ranking.

function tripDurationMinutes(trip: OvNlTripSummary): number | null {
  const raw = trip.actualDurationMinutes ?? trip.plannedDurationMinutes;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return null;
  return Math.floor(raw);
}

function formatDuration(minutes: number | null, uiLanguage: OvNlI18n["uiLanguage"]): string {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 0) {
    return "--";
  }
  const rounded = Math.floor(minutes);
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  if (hours <= 0) return `${mins} min`;
  const suffix = uiLanguage === "nl" ? "u" : "h";
  return `${hours}:${String(mins).padStart(2, "0")} ${suffix}`;
}

function stationLabel(station: OvNlStation | null, t: OvNlI18n["t"]): string {
  if (!station) return t("ov_nl.station.unknown");
  return station.nameLong || station.nameMedium || station.nameShort || station.code;
}

function stationDisplayName(station: OvNlStation): string {
  return station.nameLong || station.nameMedium || station.nameShort || station.code;
}

function disruptionTypeLabel(type: OvNlDisruption["type"], t: OvNlI18n["t"]): string {
  if (type === "CALAMITY") return t("ov_nl.disruption.type.calamity");
  if (type === "MAINTENANCE") return t("ov_nl.disruption.type.maintenance");
  return t("ov_nl.disruption.type.disruption");
}

function transfersLabel(transfers: number, t: OvNlI18n["t"]): string {
  const normalized =
    typeof transfers === "number" && Number.isFinite(transfers) && transfers >= 0
      ? Math.floor(transfers)
      : 0;
  if (normalized === 1) return t("ov_nl.trips.transfer.one");
  return t("ov_nl.trips.transfer.other", { count: normalized });
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

function HeaderContent({ output, i18n }: { output: OvNlToolOutput; i18n: OvNlI18n }) {
  const { locale, t } = i18n;
  if (output.kind === "departures.list") {
    return (
      <>
        <h3 className={styles.title}>{t("ov_nl.title.departures_board")}</h3>
        <p className={styles.subtitle}>{stationLabel(output.station, t)}</p>
      </>
    );
  }
  if (output.kind === "departures.window") {
    const fromDate = formatDate(output.window.fromDateTime, locale);
    const toDate = formatDate(output.window.toDateTime, locale);
    const fromTime = formatTime(output.window.fromDateTime, locale);
    const toTime = formatTime(output.window.toDateTime, locale);
    const windowLabel =
      fromDate && toDate && fromDate !== toDate
        ? `${fromDate} ${fromTime} → ${toDate} ${toTime}`
        : `${fromDate || ""} · ${fromTime}–${toTime}`.trim();
    return (
      <>
        <h3 className={styles.title}>{t("ov_nl.title.departures_board")}</h3>
        <p className={styles.subtitle}>
          {stationLabel(output.station, t)} {windowLabel ? `· ${windowLabel}` : ""}
        </p>
      </>
    );
  }
  if (output.kind === "arrivals.list") {
    return (
      <>
        <h3 className={styles.title}>{t("ov_nl.title.arrivals_board")}</h3>
        <p className={styles.subtitle}>{stationLabel(output.station, t)}</p>
      </>
    );
  }
  if (output.kind === "trips.search") {
    const recommendedTrip =
      (output.recommendedTripUid
        ? [...output.trips, ...(output.directOnlyAlternatives?.trips ?? [])].find(
            (trip) => trip.uid === output.recommendedTripUid
          )
        : null) ?? pickRecommendedTrip(output.trips);
    const recommended = recommendedTrip;
    const dateLabel = recommended ? tripDateLabel(recommended, locale) : "";
    const routeLabel = recommended
      ? `${recommended.departureName} → ${recommended.arrivalName}`
      : `${stationLabel(output.from, t)} → ${stationLabel(output.to, t)}`;
    const summary = [dateLabel, routeLabel].filter(Boolean).join(" • ");
    return (
      <>
        <h3 className={`${styles.title} ${styles.titleTripsSearch}`}>
          {t("ov_nl.title.trip_advice")}
        </h3>
        <p className={styles.subtitle}>{summary}</p>
      </>
    );
  }
  if (output.kind === "trips.detail") {
    const trip = output.trip;
    const dateLabel = trip ? tripDateLabel(trip, locale) : "";
    const routeLabel = trip
      ? `${trip.departureName} → ${trip.arrivalName}`
      : t("ov_nl.route.unknown");
    const summary = [dateLabel, routeLabel].filter(Boolean).join(" • ");
    return (
      <>
        <h3 className={`${styles.title} ${styles.titleTripDetail}`}>
          {t("ov_nl.title.trip_details")}
        </h3>
        <p className={styles.subtitle}>{summary}</p>
      </>
    );
  }
  if (output.kind === "journey.detail") {
    return (
      <>
        <h3 className={styles.title}>{t("ov_nl.title.journey_details")}</h3>
        <p className={styles.subtitle}>
          {output.trainNumber
            ? t("ov_nl.train_number", { number: output.trainNumber })
            : output.journeyId}
        </p>
      </>
    );
  }
  if (output.kind === "disruptions.by_station") {
    return (
      <>
        <h3 className={styles.title}>{t("ov_nl.title.disruptions_near_station")}</h3>
        <p className={styles.subtitle}>{stationLabel(output.station, t)}</p>
      </>
    );
  }
  if (output.kind === "disruptions.detail") {
    return (
      <>
        <h3 className={styles.title}>{t("ov_nl.title.disruption_details")}</h3>
        <p className={styles.subtitle}>{output.disruption?.title || t("common.unknown")}</p>
      </>
    );
  }
  if (output.kind === "disruptions.list") {
    const count = output.disruptions.length;
    const countLabel =
      count === 1
        ? t("ov_nl.subtitle.disruptions_count.one")
        : t("ov_nl.subtitle.disruptions_count.other", { count });
    return (
      <>
        <h3 className={styles.title}>{t("ov_nl.title.current_disruptions")}</h3>
        <p className={styles.subtitle}>{countLabel}</p>
      </>
    );
  }
  if (output.kind === "stations.search") {
    return (
      <>
        <h3 className={styles.title}>{t("ov_nl.title.search_stations")}</h3>
        <p className={styles.subtitle}>{t("ov_nl.subtitle.query", { query: output.query })}</p>
      </>
    );
  }
  if (output.kind === "stations.nearest") {
    return (
      <>
        <h3 className={styles.title}>{t("ov_nl.title.nearest_stations")}</h3>
        <p className={styles.subtitle}>
          {t("ov_nl.subtitle.location", {
            latitude: output.latitude.toFixed(4),
            longitude: output.longitude.toFixed(4),
          })}
        </p>
      </>
    );
  }
  if (output.kind === "disambiguation") {
    return (
      <>
        <h3 className={styles.title}>{t("ov_nl.title.station_disambiguation")}</h3>
        <p className={styles.subtitle}>{output.message}</p>
      </>
    );
  }
  return (
    <>
      <h3 className={styles.title}>{t("ov_nl.title.error")}</h3>
      <p className={styles.subtitle}>{output.error.message}</p>
    </>
  );
}

function renderBoardRows(output: OvNlToolOutput, i18n: OvNlI18n) {
  if (
    output.kind !== "departures.list" &&
    output.kind !== "departures.window" &&
    output.kind !== "arrivals.list"
  ) {
    return null;
  }

  const { locale, t } = i18n;
  const isDepartures = output.kind === "departures.list" || output.kind === "departures.window";
  const rows = isDepartures ? output.departures : output.arrivals;
  const destinationTitle = isDepartures ? t("ov_nl.board.destination") : t("ov_nl.board.origin");
  const emptyLabel = isDepartures
    ? t("ov_nl.board.empty.window_hint")
    : t("ov_nl.board.empty.none");

  return (
    <div className={styles.boardWrap} data-testid="ov-nl-card:board">
      <div className={styles.boardHeader}>
        <span>{t("ov_nl.board.time")}</span>
        <span>{destinationTitle}</span>
        <span>{t("ov_nl.board.platform")}</span>
        <span>{t("ov_nl.board.status")}</span>
      </div>
      {rows.length === 0 ? (
        <div className={styles.emptyState}>{emptyLabel}</div>
      ) : (
        rows.map((row) => (
          <div className={styles.boardRow} key={row.id}>
            <div>
              <div className={styles.bigTime}>
                {formatTime(row.actualDateTime || row.plannedDateTime, locale)}
              </div>
              <div className={styles.smallTime}>
                {formatDate(row.plannedDateTime, locale)}
              </div>
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
              <span className={styles.statusBadge}>
                {row.status ||
                  (row.cancelled ? t("ov_nl.status.cancelled") : t("ov_nl.status.ok"))}
              </span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function renderTripTimeline(
  legs: OvNlTripLeg[],
  i18n: OvNlI18n,
  opts?: {
    openStopsByDefault?: boolean;
    showStopCountLabel?: boolean;
    emphasizeLegRoute?: boolean;
    showLegRouteTimes?: boolean;
    canLoadStops?: boolean;
    stopsLoadState?: "idle" | "loading" | "loaded" | "error";
    onLoadStops?: () => void;
  }
) {
  const { locale, t } = i18n;
  if (legs.length === 0) {
    return <div className={styles.emptyState}>{t("ov_nl.timeline.empty")}</div>;
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
                  {leg.originName} (
                  {formatTime(leg.originActualDateTime || leg.originPlannedDateTime, locale)})
                  {" → "}
                  {leg.destinationName} (
                  {formatTime(
                    leg.destinationActualDateTime || leg.destinationPlannedDateTime,
                    locale
                  )}
                  )
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
                <span>{t("ov_nl.timeline.stops", { count: leg.stopCount })}</span>
              ) : null}
              {leg.cancelled ? <span>{t("ov_nl.timeline.cancelled")}</span> : null}
            </div>
            {(() => {
              const rawStops = Array.isArray(leg.stops) ? leg.stops : [];
              const displayStops = rawStops.filter((stop) => {
                const planned = stop.plannedDateTime;
                const actual = stop.actualDateTime;
                if (actual && !Number.isNaN(new Date(actual).getTime())) return true;
                if (planned && !Number.isNaN(new Date(planned).getTime())) return true;
                return false;
              });

              const hasStops = displayStops.length > 0;
              const canLoadStops = Boolean(opts?.canLoadStops && opts?.onLoadStops);
              const shouldOfferStops =
                hasStops ||
                (!Array.isArray(leg.stops) &&
                  leg.stopCount > 0 &&
                  canLoadStops &&
                  opts?.stopsLoadState !== "loaded");
              if (!shouldOfferStops) return null;

              const countForLabel = hasStops
                ? displayStops.length
                : Math.max(0, Math.floor(leg.stopCount ?? 0));
              const detailsProps = opts?.openStopsByDefault ? { open: true } : {};

              return (
                <details
                  className={styles.legStops}
                  onToggle={(event) => {
                    if (!canLoadStops) return;
                    if (hasStops) return;
                    if (opts?.stopsLoadState === "loading" || opts?.stopsLoadState === "loaded") return;
                    if (event.currentTarget.open) opts?.onLoadStops?.();
                  }}
                  {...detailsProps}
                >
                  <summary className={styles.legStopsSummary}>
                    {t("ov_nl.timeline.show_stops", { count: countForLabel })}
                  </summary>
                  {hasStops ? (
                    <div className={styles.legStopsList} data-testid="ov-nl-card:leg-stops">
                      {displayStops.map((stop, idx) => {
                        const planned = stop.plannedDateTime;
                        const actual = stop.actualDateTime;
                        const actualLabel = formatTime(actual, locale);
                        const plannedLabel = formatTime(planned, locale);
                        const showPlanned =
                          Boolean(actual && planned) &&
                          actualLabel !== "--:--" &&
                          plannedLabel !== "--:--" &&
                          actualLabel !== plannedLabel;
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
                              <span>{formatTime(actual || planned, locale)}</span>
                              {showPlanned ? (
                                <span className={styles.legStopsPlanned}>{plannedLabel}</span>
                              ) : null}
                            </div>
                            <div className={styles.legStopsName}>
                              <span>{stop.name}</span>
                              {stop.cancelled ? (
                                <span className={styles.legStopsStatusInline}>
                                  {t("ov_nl.timeline.cancelled")}
                                </span>
                              ) : null}
                            </div>
                            <div className={styles.legStopsTrackCell}>
                              {track ? t("ov_nl.timeline.platform", { platform: track }) : ""}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className={styles.legStopsList}>
                      <div className={styles.secondaryText}>
                        {opts?.stopsLoadState === "error"
                          ? t("ov_nl.timeline.failed_stops")
                          : t("ov_nl.timeline.loading_stops")}
                      </div>
                    </div>
                  )}
                </details>
              );
            })()}
          </div>
        </div>
      ))}
    </div>
  );
}

function TripsView({
  output,
  i18n,
  onUpdateOutput,
}: {
  output: OvNlToolOutput;
  i18n: OvNlI18n;
  onUpdateOutput?: (output: OvNlToolOutput) => void;
}) {
  const { locale, t, uiLanguage } = i18n;
  const { directOnlyAlternatives, primaryTripOptions, alternativeTripOptions, tripOptions } =
    useMemo(() => {
      if (output.kind === "trips.search") {
        const directOnlyAlternatives = output.directOnlyAlternatives;
        const primaryTripOptions = output.trips;
        const alternativeTripOptions = directOnlyAlternatives?.trips ?? [];
        const tripOptions = [...primaryTripOptions, ...alternativeTripOptions];
        return { directOnlyAlternatives, primaryTripOptions, alternativeTripOptions, tripOptions };
      }
      if (output.kind === "trips.detail" && output.trip) {
        const primaryTripOptions: OvNlTripSummary[] = [output.trip];
        return {
          directOnlyAlternatives: undefined,
          primaryTripOptions,
          alternativeTripOptions: [],
          tripOptions: primaryTripOptions,
        };
      }
      return {
        directOnlyAlternatives: undefined,
        primaryTripOptions: [] as OvNlTripSummary[],
        alternativeTripOptions: [] as OvNlTripSummary[],
        tripOptions: [] as OvNlTripSummary[],
      };
    }, [output]);
  const journeyLegs = output.kind === "journey.detail" ? output.legs : [];

  const isTripDetail = output.kind === "trips.detail";
  const hasTrips = tripOptions.length > 0;
  const [selectedTripUid, setSelectedTripUid] = useState("");
  const [tripDetailByCtxRecon, setTripDetailByCtxRecon] = useState<
    Record<
      string,
      {
        state: "idle" | "loading" | "loaded" | "error";
        trip?: OvNlTripSummary;
      }
    >
  >({});
  const recommendedTripUid = useMemo(() => {
    if (output.kind === "trips.search") {
      return (
        output.recommendedTripUid ||
        pickRecommendedTripUidForSearch({
          primaryTrips: primaryTripOptions,
          alternativeTrips: alternativeTripOptions,
        })
      );
    }
    if (output.kind === "trips.detail") return output.trip?.uid ?? "";
    return "";
  }, [output, primaryTripOptions, alternativeTripOptions]);
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

  const effectiveSelectedTripUid =
    selectedTripUid && tripOptions.some((trip) => trip.uid === selectedTripUid)
      ? selectedTripUid
      : recommendedTripUid || tripOptions[0]?.uid || "";

  const selectedTrip = hasTrips
    ? tripOptions.find((trip) => trip.uid === effectiveSelectedTripUid) || tripOptions[0]
    : null;

  const selectedTripDetailsEntry = selectedTrip?.ctxRecon
    ? tripDetailByCtxRecon[selectedTrip.ctxRecon]
    : undefined;
  const selectedTripWithDetails =
    selectedTripDetailsEntry?.state === "loaded" && selectedTripDetailsEntry.trip
      ? selectedTripDetailsEntry.trip
      : selectedTrip;

  const loadSelectedTripDetails = useCallback(async () => {
    const ctxRecon = String(selectedTrip?.ctxRecon ?? "").trim();
    if (!ctxRecon) return;

    const existing = tripDetailByCtxRecon[ctxRecon];
    if (existing?.state === "loading" || existing?.state === "loaded") return;

    setTripDetailByCtxRecon((prev) => ({
      ...prev,
      [ctxRecon]: { state: "loading" },
    }));

    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      const adminToken = readLanAdminToken();
      if (adminToken) headers["x-remcochat-admin-token"] = adminToken;
      const res = await fetch("/api/ov-nl/trips/detail", {
        method: "POST",
        headers,
        body: JSON.stringify({
          ctxRecon,
          lang: uiLanguage,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || typeof json !== "object") {
        throw new Error("Failed to load trip details.");
      }

      const detailOutput = json as OvNlToolOutput;
      const detailedTrip = detailOutput.kind === "trips.detail" ? detailOutput.trip : null;
      if (detailedTrip) {
        setTripDetailByCtxRecon((prev) => ({
          ...prev,
          [ctxRecon]: { state: "loaded", trip: detailedTrip },
        }));
        return;
      }

      setTripDetailByCtxRecon((prev) => ({
        ...prev,
        [ctxRecon]: { state: "error" },
      }));
    } catch {
      setTripDetailByCtxRecon((prev) => ({
        ...prev,
        [ctxRecon]: { state: "error" },
      }));
    }
  }, [selectedTrip, tripDetailByCtxRecon, uiLanguage]);

  const [pagingState, setPagingState] = useState<"idle" | "earlier" | "later">("idle");

  const cursorMsForTrip = (trip: OvNlTripSummary, mode: "departure" | "arrival"): number | null => {
    const raw =
      mode === "arrival"
        ? trip.arrivalActualDateTime || trip.arrivalPlannedDateTime
        : trip.departureActualDateTime || trip.departurePlannedDateTime;
    if (!raw) return null;
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : null;
  };

  const pageCursorMode: "departure" | "arrival" =
    output.kind === "trips.search" && output.query?.searchForArrival === true ? "arrival" : "departure";

  const tripDepartures = useMemo(() => {
    let earliest: number | null = null;
    let latest: number | null = null;
    for (const trip of tripOptions) {
      const ms = cursorMsForTrip(trip, pageCursorMode);
      if (ms == null) continue;
      earliest = earliest == null ? ms : Math.min(earliest, ms);
      latest = latest == null ? ms : Math.max(latest, ms);
    }
    return { earliestMs: earliest, latestMs: latest };
  }, [pageCursorMode, tripOptions]);

  const canPage =
    output.kind === "trips.search" &&
    Boolean(output.query?.from && output.query?.to) &&
    typeof output.query?.limit === "number";
  const canLoadEarlier =
    canPage && tripDepartures.earliestMs != null && tripDepartures.earliestMs - Date.now() > 15 * 60 * 1000;
  const canLoadLater = canPage && hasTrips && tripDepartures.latestMs != null;

  const loadTripPage = useCallback(
    async (direction: "earlier" | "later") => {
      if (!canPage) return;
      if (output.kind !== "trips.search") return;
      const earliestMs = tripDepartures.earliestMs;
      const latestMs = tripDepartures.latestMs;
      if (direction === "earlier" && earliestMs == null) return;
      if (direction === "later" && latestMs == null) return;

      const base = output.query;
      if (!base) return;

      let dateTime: string;
      if (direction === "earlier") {
        const ms = earliestMs;
        if (ms == null) return;
        dateTime = new Date(Math.max(0, ms - 60 * 60 * 1000)).toISOString();
      } else {
        const ms = latestMs;
        if (ms == null) return;
        dateTime = new Date(ms + 60 * 1000).toISOString();
      }

      setPagingState(direction);
      try {
        const headers: Record<string, string> = { "content-type": "application/json" };
        const adminToken = readLanAdminToken();
        if (adminToken) headers["x-remcochat-admin-token"] = adminToken;
        const res = await fetch("/api/ov-nl/trips/search", {
          method: "POST",
          headers,
          body: JSON.stringify({ ...base, dateTime }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json || typeof json !== "object") return;
        const next = json as OvNlToolOutput;
        if (next.kind !== "trips.search") return;
        onUpdateOutput?.(next);
      } finally {
        setPagingState("idle");
      }
    },
    [canPage, onUpdateOutput, output, tripDepartures.earliestMs, tripDepartures.latestMs]
  );

  const renderTripOptionRows = (trips: OvNlTripSummary[], startIndex: number) =>
    trips.map((trip, index) => {
      const selected = selectedTrip?.uid === trip.uid;
      const isRecommended = trip.uid === recommendedTripUid;
      const isDirect = tripBadges.directTripUids.has(trip.uid);
      const isFastest = tripBadges.fastestTripUids.has(trip.uid);
      const isMinTransfers = tripBadges.minTransfersTripUids.has(trip.uid);
      const badges: Array<{ label: string; tone: "primary" | "secondary" }> = [];
      if (isRecommended) badges.push({ label: t("ov_nl.trips.badge.best"), tone: "primary" });
      if (isDirect) badges.push({ label: t("ov_nl.trips.badge.direct"), tone: "secondary" });
      if (isFastest) badges.push({ label: t("ov_nl.trips.badge.fastest"), tone: "secondary" });
      if (isMinTransfers && !isDirect) {
        badges.push({ label: t("ov_nl.trips.badge.fewest_transfers"), tone: "secondary" });
      }

      const optionIndex = startIndex + index;
      return (
        <button
          className={`${styles.optionRow} ${selected ? styles.optionRowSelected : ""}`}
          data-testid={`ov-nl-card:trip-option:${optionIndex}`}
          key={trip.uid || optionIndex}
          onClick={() => setSelectedTripUid(trip.uid)}
          type="button"
        >
          <div className={styles.optionMain}>
            <div className={styles.optionTimes}>
              {formatTime(trip.departureActualDateTime || trip.departurePlannedDateTime, locale)} →{" "}
              {formatTime(trip.arrivalActualDateTime || trip.arrivalPlannedDateTime, locale)}
            </div>
            <div className={styles.optionSubline}>
              {transfersLabel(trip.transfers, t)} •{" "}
              {formatDuration(
                trip.actualDurationMinutes || trip.plannedDurationMinutes,
                uiLanguage
              )}
            </div>
          </div>
          {badges.length > 0 ? (
            <div className={styles.badgeStack} aria-label={t("ov_nl.trips.badges.aria")}>
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
    });

  return (
    <div
      className={`${styles.tripsLayout} ${isTripDetail ? styles.tripsLayoutSingle : ""}`}
      data-testid="ov-nl-card:trips"
    >
      {!isTripDetail ? (
        <div className={styles.optionsColumn}>
          {output.kind === "trips.search" && canLoadEarlier ? (
            <div className={styles.pageButtonRow}>
              <button
                className={styles.pageButton}
                disabled={pagingState !== "idle"}
                onClick={() => loadTripPage("earlier")}
                type="button"
              >
                <span className={styles.pageButtonIcon}>↑</span>
                {t("ov_nl.trips.load_earlier")}
              </button>
            </div>
          ) : null}
          {output.kind === "journey.detail" ? (
            <div className={styles.optionRow}>
              <div className={styles.optionTimes}>{t("ov_nl.title.journey_details")}</div>
              <div className={styles.optionSubline}>
                {output.trainNumber
                  ? t("ov_nl.train_number", { number: output.trainNumber })
                  : output.journeyId}
              </div>
            </div>
          ) : output.kind === "trips.search" &&
            directOnlyAlternatives &&
            output.requestMeta?.requestedDirectOnly === true ? (
            <>
              <div className={styles.optionSectionHeader}>{t("ov_nl.trips.section.direct")}</div>
              {primaryTripOptions.length === 0 ? (
                <div className={`${styles.emptyState} ${styles.optionSectionEmpty}`}>
                  {t("ov_nl.trips.direct_only_empty")}
                </div>
              ) : (
                renderTripOptionRows(primaryTripOptions, 0)
              )}

              <div className={styles.optionSectionHeader}>
                {t("ov_nl.trips.section.alternatives", {
                  label: transfersLabel(directOnlyAlternatives.maxTransfers, t),
                })}
              </div>
              {alternativeTripOptions.length === 0 ? (
                <div className={`${styles.emptyState} ${styles.optionSectionEmpty}`}>
                  {t("ov_nl.trips.empty")}
                </div>
              ) : (
                renderTripOptionRows(alternativeTripOptions, primaryTripOptions.length)
              )}
            </>
          ) : tripOptions.length === 0 ? (
            <div className={styles.emptyState}>{t("ov_nl.trips.empty")}</div>
          ) : (
            renderTripOptionRows(tripOptions, 0)
          )}
          {output.kind === "trips.search" && canLoadLater ? (
            <div className={`${styles.pageButtonRow} ${styles.pageButtonRowBottom}`}>
              <button
                className={styles.pageButton}
                disabled={pagingState !== "idle"}
                onClick={() => loadTripPage("later")}
                type="button"
              >
                <span className={styles.pageButtonIcon}>↓</span>
                {t("ov_nl.trips.load_later")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
	      <div className={styles.detailPanel}>
	        {output.kind === "journey.detail" ? (
	          <>
	            <div className={styles.detailTop}>
	              <div>
	                <div className={styles.detailLabel}>{t("ov_nl.detail.journey")}</div>
	                <div className={styles.detailValue}>
	                  {output.trainNumber
	                    ? t("ov_nl.train_number", { number: output.trainNumber })
	                    : output.journeyId}
	                </div>
	              </div>
	            </div>
	            {renderTripTimeline(journeyLegs, i18n)}
	          </>
	        ) : !selectedTrip ? (
	          <div className={styles.emptyState}>
	            {output.kind === "trips.detail"
	              ? t("ov_nl.trips.no_details")
	              : t("ov_nl.trips.no_selection")}
	          </div>
	        ) : (
	          <>
	            <div className={styles.detailTop}>
	              <div>
	                <div className={styles.detailLabel}>{t("ov_nl.detail.departure")}</div>
	                <div className={styles.detailValue}>
	                  {formatTime(
	                    selectedTrip.departureActualDateTime || selectedTrip.departurePlannedDateTime,
	                    locale
	                  )}
	                </div>
	              </div>
	              <div>
	                <div className={styles.detailLabel}>{t("ov_nl.detail.arrival")}</div>
	                <div className={styles.detailValue}>
	                  {formatTime(
	                    selectedTrip.arrivalActualDateTime || selectedTrip.arrivalPlannedDateTime,
	                    locale
	                  )}
	                </div>
	              </div>
	              <div>
	                <div className={styles.detailLabel}>{t("ov_nl.detail.duration")}</div>
	                <div className={styles.detailValue}>
	                  {formatDuration(
	                    selectedTrip.actualDurationMinutes || selectedTrip.plannedDurationMinutes,
	                    uiLanguage
	                  )}
	                </div>
	              </div>
	            </div>
	            {renderTripTimeline(selectedTripWithDetails?.legs ?? [], i18n, {
	              openStopsByDefault: output.kind === "trips.detail",
	              showStopCountLabel: output.kind !== "trips.detail",
	              emphasizeLegRoute: output.kind === "trips.detail",
	              showLegRouteTimes: output.kind !== "trips.detail",
                canLoadStops: output.kind === "trips.search" && Boolean(selectedTrip.ctxRecon),
                stopsLoadState: selectedTripDetailsEntry?.state ?? "idle",
                onLoadStops: loadSelectedTripDetails,
	            })}
	          </>
	        )}
	      </div>
    </div>
  );
}

function renderDisruptions(output: OvNlToolOutput, i18n: OvNlI18n) {
  if (
    output.kind !== "disruptions.list" &&
    output.kind !== "disruptions.by_station" &&
    output.kind !== "disruptions.detail"
  ) {
    return null;
  }

  const { t } = i18n;
  const disruptions =
    output.kind === "disruptions.detail"
      ? output.disruption
        ? [output.disruption]
        : []
      : output.disruptions;

  return (
    <div className={styles.disruptionList} data-testid="ov-nl-card:disruptions">
      {disruptions.length === 0 ? (
        <div className={styles.emptyState}>{t("ov_nl.disruptions.empty")}</div>
      ) : (
        disruptions.map((disruption) => (
          <article className={styles.disruptionCard} key={disruption.id}>
            <div className={styles.disruptionHead}>
              <span className={styles.disruptionType}>
                {disruptionTypeLabel(disruption.type, t)}
              </span>
              <span className={styles.disruptionStatus}>
                {disruption.isActive
                  ? t("ov_nl.disruption.status.active")
                  : t("ov_nl.disruption.status.inactive")}
              </span>
            </div>
            <h4 className={styles.disruptionTitle}>
              {disruption.title || t("ov_nl.disruption.untitled")}
            </h4>
            {disruption.topic ? <p className={styles.disruptionTopic}>{disruption.topic}</p> : null}
          </article>
        ))
      )}
    </div>
  );
}

function renderSimple(output: OvNlToolOutput, i18n: OvNlI18n) {
  const { t } = i18n;
  if (output.kind === "stations.search" || output.kind === "stations.nearest") {
    return (
      <ul className={styles.stationList} data-testid="ov-nl-card:stations">
        {output.stations.length === 0 ? (
          <li className={styles.emptyState}>{t("ov_nl.stations.empty")}</li>
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
              {t("ov_nl.disambiguation.meta", {
                code: candidate.station.code,
                confidence: (candidate.confidence * 100).toFixed(0),
              })}
            </div>
          </li>
        ))}
      </ul>
    );
  }

  if (output.kind !== "error") {
    return (
      <div className={styles.emptyState} data-testid="ov-nl-card:unsupported">
        {t("ov_nl.unsupported")}
      </div>
    );
  }

  return (
    <div className={styles.errorState} data-testid="ov-nl-card:error">
      <div className={styles.errorCode}>{output.error.code}</div>
      <div>{output.error.message}</div>
      {output.error.code === "constraint_no_match" ? (
        <div className={styles.noMatchHint}>
          <div className={styles.noMatchTitle}>{t("ov_nl.error.no_match.title")}</div>
          <div className={styles.noMatchText}>{t("ov_nl.error.no_match.relax_hint")}</div>
        </div>
      ) : null}
    </div>
  );
}

export function OvNlCard({ output }: OvNlCardProps) {
  const i18n = useI18n();
  const baseKey = `${output.kind}|${"fetchedAt" in output ? output.fetchedAt : ""}|${
    "cached" in output && output.cached ? "1" : "0"
  }`;
  const [override, setOverride] = useState<{ baseKey: string; output: OvNlToolOutput } | null>(null);
  const displayOutput = override?.baseKey === baseKey ? override.output : output;
  const onUpdateOutput = useCallback(
    (next: OvNlToolOutput) => setOverride({ baseKey, output: next }),
    [baseKey]
  );
  const view = viewFromKind(displayOutput.kind);

  return (
    <section
      className={`${styles.cardRoot} ov-nl-card ov-nl-card--${view}`}
      data-ov-kind={output.kind}
      data-testid="tool:ovNlGateway"
    >
      <header className={styles.headerBand}>
        <div className={styles.headerTop}>
          <HeaderContent i18n={i18n} output={displayOutput} />
        </div>
      </header>

      <div className={styles.body}>
        {view === "board" ? renderBoardRows(displayOutput, i18n) : null}
        {view === "trips" ? (
          <TripsView
            i18n={i18n}
            onUpdateOutput={onUpdateOutput}
            output={displayOutput}
          />
        ) : null}
        {view === "alerts" ? renderDisruptions(displayOutput, i18n) : null}
        {view === "simple" ? renderSimple(displayOutput, i18n) : null}
      </div>
    </section>
  );
}
