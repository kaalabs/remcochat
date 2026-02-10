---
name: ov-nl-travel
description: |
  Dutch rail travel helper for NS Reisinformatie via the ovNlGateway server tool.
  Use this for stations, departures, arrivals, trips, journey details, and disruptions.
license: MIT
compatibility: |
  Requires the RemcoChat ovNlGateway tool to be enabled and configured with a valid NS subscription key.
allowed-tools: Read
metadata:
  author: remcochat
  version: "0.2.0"
  purpose: ov-nl-travel-assistant
---

# OV NL Travel

Use the `ovNlGateway` tool first for Dutch railway (NS) questions.

## Preferred behavior

1. Prefer `ovNlGateway` for anything that can change minute-to-minute (departures, delays, cancellations, platforms, disruptions).
2. Use web search (if available) for policy/static info that the gateway cannot answer (tickets/pricing, refunds, bike rules, accessibility, station facilities).
3. If a station name is ambiguous, ask a short disambiguation question or run a station lookup to propose options.
4. Never claim “live” updates unless you actually used `ovNlGateway` in this turn.

## Tool contract (input)

`ovNlGateway` expects an object with:

```json
{ "action": "<one of the actions below>", "args": { /* action-specific */ } }
```

### Actions and args (summary)

- `stations.search` — `{ query, limit?, countryCodes? }`
- `stations.nearest` — `{ latitude/longitude or lat/lng, limit? }`
- `departures.list` — `{ station? | stationCode? | uicCode?, dateTime?, maxJourneys?, lang?, intent? }` (station identifier required)
- `departures.window` — `{ station? | stationCode? | uicCode?, fromDateTime+toDateTime OR fromTime+toTime, date?, maxJourneys?, lang?, intent? }`
- `arrivals.list` — `{ station? | stationCode? | uicCode?, dateTime?, maxJourneys?, lang?, intent? }` (station identifier required)
- `trips.search` — `{ from, to, via?, dateTime?, searchForArrival?, limit?, lang?, intent? }`
- `trips.detail` — `{ ctxRecon, date?, lang?, intent? }`
- `journey.detail` — `{ id? | train?, dateTime?, departureUicCode?, transferUicCode?, arrivalUicCode?, omitCrowdForecast?, intent? }` (id or train required)
- `disruptions.list` — `{ type? (one or more of CALAMITY/DISRUPTION/MAINTENANCE), isActive?, lang?, intent? }`
- `disruptions.by_station` — `{ station, intent? }`
- `disruptions.detail` — `{ type (CALAMITY/DISRUPTION/MAINTENANCE), id, intent? }`

### Intent contract (`args.intent`)

- `intent.hard` (strict filters): `directOnly`, `maxTransfers`, `maxDurationMinutes`, `departureAfter`, `departureBefore`, `arrivalAfter`, `arrivalBefore`, `includeModes`, `excludeModes`, `includeOperators`, `excludeOperators`, `includeTrainCategories`, `excludeTrainCategories`, `avoidStations`, `excludeCancelled`, `requireRealtime`, `platformEquals`, `disruptionTypes`, `activeOnly`.
- `intent.soft.rankBy` (ranking hints): one or more of `fastest`, `fewest_transfers`, `earliest_departure`, `earliest_arrival`, `realtime_first`, `least_walking`.
- Use hard constraints for wording like `must/only/without/no/geen/alleen/zonder/niet`.
- Use soft ranking for wording like `prefer/liefst/best/bij voorkeur`.
- If hard constraints produce no matches, ask one concise clarification to relax a single hard constraint.

### Date/time guidance

- Prefer ISO-8601 strings for `dateTime`, `fromDateTime`, `toDateTime` when you can.
- Natural language like `"today"` is accepted for `trips.search.dateTime`.
- For `departures.window` with `date` + `fromTime`/`toTime`, interpret the date/time in `Europe/Amsterdam`.

## Action mapping

- `stations.search`: station lookup by name.
- `stations.nearest`: nearest stations by coordinates.
- `departures.list`: upcoming departures for a station.
- `departures.window`: departures for a station within a requested time window (use `fromDateTime`/`toDateTime` or `date` + `fromTime`/`toTime`).
- `arrivals.list`: upcoming arrivals for a station.
- `trips.search`: trip options from A to B (with optional via + time).
- `trips.detail`: full details for one trip from `ctxRecon`.
- `journey.detail`: train/journey detail with stops and status.
- `disruptions.list`: active disruptions overview.
- `disruptions.by_station`: disruptions for a specific station.
- `disruptions.detail`: one disruption detail by type + id.

## Output handling (disambiguation + errors)

Most actions return a matching `kind` (e.g. `kind: "trips.search"`). Two special cases:

- `kind: "disambiguation"`: the tool could not uniquely resolve a station name.
  - Show the `candidates[]` succinctly (label + station code/UIC).
  - Ask the user to pick one (or restate with city/“Centraal”/etc.).
  - Re-run the *original* action using the chosen candidate’s station code/UIC where possible:
    - trips: use `from`/`to` station codes
    - boards: use `stationCode` or `uicCode`
    - disruptions.by_station: use the chosen candidate’s displayed name (args only supports `station` text)
- `kind: "error"`: surface the error message; if actionable, suggest the smallest next step.
  - `access_denied` / tool disabled: explain the local access limitation.
  - `config_error`: explain that an NS subscription key/config is missing.
  - `station_not_found`: ask for a more specific station name or nearby city.
  - `upstream_*`: suggest retrying and/or broadening time window.

## UX guidelines

- Keep answers concise and practical.
- Highlight delays, cancellations, platform changes, and transfer counts.
- When multiple trip options exist, summarize the top options first.

## Suggested call flows (recipes)

- “Next train from X” → resolve station (if needed) → `departures.list` (or `departures.window` if user gives a time window).
- “Departures between 17:00 and 18:00” → `departures.window` with `date` + `fromTime`/`toTime`.
- “Best route from A to B (via C)” → `trips.search` → summarize top 2–3 → if user picks one, `trips.detail` for richer leg detail.
- “What’s going on with this train?” → if you have a `journeyDetailRef` from a board item, call `journey.detail` with `id`.
- “Disruptions near station X” → `disruptions.by_station` (station text) or `disruptions.list` for a broad overview.

## Examples

### Station disambiguation then departures

1) Look up station:

```json
{ "action": "stations.search", "args": { "query": "Amsterdam" } }
```

2) If ambiguous, ask user to pick “Amsterdam Centraal” (code `ASD`) etc., then:

```json
{ "action": "departures.list", "args": { "stationCode": "ASD", "maxJourneys": 12 } }
```

### Departures time window (today 17:00–18:00)

```json
{
  "action": "departures.window",
  "args": { "station": "Utrecht Centraal", "date": "2026-02-08", "fromTime": "17:00", "toTime": "18:00" }
}
```

### Trip search with natural-language time

```json
{ "action": "trips.search", "args": { "from": "Almere Centrum", "to": "Groningen", "dateTime": "today", "limit": 3 } }
```

### Trip search with strict direct-only filtering

```json
{
  "action": "trips.search",
  "args": {
    "from": "Almere Centrum",
    "to": "Groningen",
    "limit": 6,
    "intent": {
      "hard": { "directOnly": true }
    }
  }
}
```

### Departures with soft ranking preference

```json
{
  "action": "departures.list",
  "args": {
    "station": "Utrecht Centraal",
    "maxJourneys": 20,
    "intent": {
      "soft": { "rankBy": ["realtime_first", "earliest_departure"] }
    }
  }
}
```

## Reference

For a short troubleshooting/planning checklist, see `references/REFERENCE.md`.
