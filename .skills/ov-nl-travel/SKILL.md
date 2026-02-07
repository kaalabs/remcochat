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
  version: "0.1.0"
  purpose: ov-nl-travel-assistant
---

# OV NL Travel

Use the `ovNlGateway` tool first for Dutch railway questions.

## Preferred behavior

1. Prefer `ovNlGateway` over web search for live train info.
2. Use web search only when the user explicitly asks for internet sources/links.
3. If a station name is ambiguous, ask a short disambiguation question.

## Action mapping

- `stations.search`: station lookup by name.
- `stations.nearest`: nearest stations by coordinates.
- `departures.list`: upcoming departures for a station.
- `departures.window`: departures for a station within a requested time window (use `fromTime`/`toTime` and optional `date` in Europe/Amsterdam).
- `arrivals.list`: upcoming arrivals for a station.
- `trips.search`: trip options from A to B (with optional via + time).
- `trips.detail`: full details for one trip from `ctxRecon`.
- `journey.detail`: train/journey detail with stops and status.
- `disruptions.list`: active disruptions overview.
- `disruptions.by_station`: disruptions for a specific station.
- `disruptions.detail`: one disruption detail by type + id.

## UX guidelines

- Keep answers concise and practical.
- Highlight delays, cancellations, platform changes, and transfer counts.
- When multiple trip options exist, summarize the top options first.
