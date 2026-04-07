export type OvNlToolAction =
  | "stations.search"
  | "stations.nearest"
  | "departures.list"
  | "departures.window"
  | "arrivals.list"
  | "trips.search"
  | "trips.detail"
  | "journey.detail"
  | "disruptions.list"
  | "disruptions.by_station"
  | "disruptions.detail";

export type OvNlErrorCode =
  | "invalid_tool_input"
  | "access_denied"
  | "config_error"
  | "constraint_no_match"
  | "station_not_found"
  | "station_ambiguous"
  | "upstream_unreachable"
  | "upstream_http_error"
  | "upstream_invalid_response"
  | "unknown";

export type OvNlToolError = {
  code: OvNlErrorCode;
  message: string;
  details?: Record<string, unknown>;
};

export type OvNlStation = {
  code: string;
  uicCode: string;
  nameShort: string;
  nameMedium: string;
  nameLong: string;
  countryCode: string;
  lat: number | null;
  lng: number | null;
  distanceMeters: number | null;
};

export type OvNlDisambiguationCandidate = {
  id: string;
  label: string;
  confidence: number;
  station: OvNlStation;
};

export type OvNlDeparture = {
  id: string;
  destination: string;
  plannedDateTime: string;
  actualDateTime: string | null;
  plannedTrack: string | null;
  actualTrack: string | null;
  status: string;
  cancelled: boolean;
  trainCategory: string;
  trainNumber: string;
  operatorName: string | null;
  crowdForecast: "UNKNOWN" | "LOW" | "MEDIUM" | "HIGH" | null;
  messages: string[];
  journeyDetailRef: string | null;
};

export type OvNlArrival = {
  id: string;
  origin: string;
  plannedDateTime: string;
  actualDateTime: string | null;
  plannedTrack: string | null;
  actualTrack: string | null;
  status: string;
  cancelled: boolean;
  trainCategory: string;
  trainNumber: string;
  operatorName: string | null;
  crowdForecast: "UNKNOWN" | "LOW" | "MEDIUM" | "HIGH" | null;
  messages: string[];
  journeyDetailRef: string | null;
};

export type OvNlTripLegStop = {
  name: string;
  plannedDateTime: string | null;
  actualDateTime: string | null;
  plannedTrack: string | null;
  actualTrack: string | null;
  cancelled: boolean;
};

export type OvNlTripLeg = {
  index: string;
  mode:
    | "PUBLIC_TRANSIT"
    | "WALK"
    | "TRANSFER"
    | "BIKE"
    | "CAR"
    | "KISS"
    | "TAXI"
    | "UNKNOWN";
  name: string;
  direction: string;
  cancelled: boolean;
  originName: string;
  originPlannedDateTime: string | null;
  originActualDateTime: string | null;
  originPlannedTrack: string | null;
  originActualTrack: string | null;
  destinationName: string;
  destinationPlannedDateTime: string | null;
  destinationActualDateTime: string | null;
  destinationPlannedTrack: string | null;
  destinationActualTrack: string | null;
  journeyDetailRef: string | null;
  messages: string[];
  stopCount: number;
  stops?: OvNlTripLegStop[];
};

export type OvNlIntentMode =
  | "PUBLIC_TRANSIT"
  | "WALK"
  | "TRANSFER"
  | "BIKE"
  | "CAR"
  | "KISS"
  | "TAXI"
  | "UNKNOWN";

export type OvNlIntentRank =
  | "fastest"
  | "fewest_transfers"
  | "earliest_departure"
  | "earliest_arrival"
  | "realtime_first"
  | "least_walking";

export type OvNlIntentHard = {
  directOnly?: boolean;
  maxTransfers?: number;
  maxDurationMinutes?: number;
  departureAfter?: string;
  departureBefore?: string;
  arrivalAfter?: string;
  arrivalBefore?: string;
  includeModes?: OvNlIntentMode[];
  excludeModes?: OvNlIntentMode[];
  includeOperators?: string[];
  excludeOperators?: string[];
  includeTrainCategories?: string[];
  excludeTrainCategories?: string[];
  avoidStations?: string[];
  excludeCancelled?: boolean;
  requireRealtime?: boolean;
  platformEquals?: string;
  disruptionTypes?: Array<"CALAMITY" | "DISRUPTION" | "MAINTENANCE">;
  activeOnly?: boolean;
};

export type OvNlIntentSoft = {
  rankBy?: OvNlIntentRank[];
};

export type OvNlIntent = {
  hard?: OvNlIntentHard;
  soft?: OvNlIntentSoft;
};

export type OvNlIntentMeta = {
  appliedHard: string[];
  appliedSoft: OvNlIntentRank[];
  ignoredSoft: OvNlIntentRank[];
  beforeCount: number;
  afterCount: number;
};

export type OvNlTripSummary = {
  uid: string;
  status: string;
  source: string;
  optimal: boolean;
  realtime: boolean;
  transfers: number;
  plannedDurationMinutes: number | null;
  actualDurationMinutes: number | null;
  departureName: string;
  departurePlannedDateTime: string | null;
  departureActualDateTime: string | null;
  arrivalName: string;
  arrivalPlannedDateTime: string | null;
  arrivalActualDateTime: string | null;
  primaryMessage: string | null;
  messages: string[];
  ctxRecon: string;
  routeId: string | null;
  legs: OvNlTripLeg[];
};

export type OvNlDisruption = {
  id: string;
  type: "CALAMITY" | "DISRUPTION" | "MAINTENANCE";
  title: string;
  topic: string | null;
  isActive: boolean;
};

export type OvNlToolOutput =
  | {
      kind: "stations.search";
      query: string;
      stations: OvNlStation[];
      intentMeta?: OvNlIntentMeta;
      cacheTtlSeconds: number;
      fetchedAt: string;
      cached: boolean;
    }
  | {
      kind: "stations.nearest";
      latitude: number;
      longitude: number;
      stations: OvNlStation[];
      intentMeta?: OvNlIntentMeta;
      cacheTtlSeconds: number;
      fetchedAt: string;
      cached: boolean;
    }
  | {
      kind: "departures.list";
      station: OvNlStation | null;
      departures: OvNlDeparture[];
      intentMeta?: OvNlIntentMeta;
      cacheTtlSeconds: number;
      fetchedAt: string;
      cached: boolean;
    }
  | {
      kind: "departures.window";
      station: OvNlStation | null;
      window: {
        fromDateTime: string;
        toDateTime: string;
        timeZone: string;
      };
      departures: OvNlDeparture[];
      intentMeta?: OvNlIntentMeta;
      cacheTtlSeconds: number;
      fetchedAt: string;
      cached: boolean;
    }
  | {
      kind: "arrivals.list";
      station: OvNlStation | null;
      arrivals: OvNlArrival[];
      intentMeta?: OvNlIntentMeta;
      cacheTtlSeconds: number;
      fetchedAt: string;
      cached: boolean;
    }
  | {
      kind: "trips.search";
      from: OvNlStation;
      to: OvNlStation;
      via: OvNlStation | null;
      trips: OvNlTripSummary[];
      recommendedTripUid?: string;
      query?: {
        from: string;
        to: string;
        via?: string;
        dateTime?: string;
        searchForArrival?: boolean;
        limit: number;
        lang: string;
        intent?: OvNlIntent;
      };
      page?: {
        hasMoreLater: boolean;
      };
      directOnlyAlternatives?: {
        maxTransfers: number;
        trips: OvNlTripSummary[];
      };
      requestMeta?: {
        requestedHardKeys: string[];
        requestedDirectOnly: boolean;
      };
      intentMeta?: OvNlIntentMeta;
      cacheTtlSeconds: number;
      fetchedAt: string;
      cached: boolean;
    }
  | {
      kind: "trips.detail";
      trip: OvNlTripSummary | null;
      intentMeta?: OvNlIntentMeta;
      cacheTtlSeconds: number;
      fetchedAt: string;
      cached: boolean;
    }
  | {
      kind: "journey.detail";
      journeyId: string;
      trainNumber: string | null;
      legs: OvNlTripLeg[];
      intentMeta?: OvNlIntentMeta;
      cacheTtlSeconds: number;
      fetchedAt: string;
      cached: boolean;
    }
  | {
      kind: "disruptions.list";
      disruptions: OvNlDisruption[];
      intentMeta?: OvNlIntentMeta;
      cacheTtlSeconds: number;
      fetchedAt: string;
      cached: boolean;
    }
  | {
      kind: "disruptions.by_station";
      station: OvNlStation | null;
      disruptions: OvNlDisruption[];
      intentMeta?: OvNlIntentMeta;
      cacheTtlSeconds: number;
      fetchedAt: string;
      cached: boolean;
    }
  | {
      kind: "disruptions.detail";
      disruption: OvNlDisruption | null;
      intentMeta?: OvNlIntentMeta;
      cacheTtlSeconds: number;
      fetchedAt: string;
      cached: boolean;
    }
  | {
      kind: "disambiguation";
      action: OvNlToolAction;
      query: string;
      message: string;
      candidates: OvNlDisambiguationCandidate[];
      fetchedAt: string;
      cached: boolean;
    }
  | {
      kind: "error";
      action: OvNlToolAction;
      error: OvNlToolError;
      fetchedAt: string;
      cached: boolean;
    };
