# OV NL Reference

Use this reference when planning or troubleshooting NS travel responses.

- Prefer station disambiguation before departures/trips when station names are unclear.
- For best-trip questions:
  - call `trips.search`
  - compare duration, transfers, and disruptions
  - if needed, call `trips.detail` for the chosen option
- For station boards:
  - departures => `departures.list`
  - arrivals => `arrivals.list`
- For disruptions:
  - broad overview => `disruptions.list`
  - station-specific => `disruptions.by_station`
  - detail => `disruptions.detail`
