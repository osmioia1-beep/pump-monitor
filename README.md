# Pump Monitor

Static, read-only dashboard for `pump_events`. Serve this directory with any static HTTP server; no build or npm dependencies are required.

## Metric definitions

- The installation time zone is **Europe/Lisbon**, independent of the viewer's device. Calendar boundaries account for 23-hour and 25-hour daylight-saving days.
- **Completed cycles:** one accepted start followed by one stop. A cycle belongs to the calendar day of its stop; day windows are half-open, so a stop at midnight belongs to the new day.
- **Running time in period:** overlap of reconstructed intervals with that period, including an open interval through the displayed snapshot. A cycle crossing midnight contributes time to both days.
- **Average / maximum / minimum running:** full durations of completed cycles assigned to the period. These deliberately exclude the unfinished cycle. Daily running time divided by completed cycles is therefore not necessarily the displayed average.
- **Cycles/hour:** completed cycles divided by actual elapsed hours in the observation window. Today uses local midnight through the snapshot; yesterday uses its full calendar day. Daily windows predating the earliest accessible valid event are marked partial and have no hourly rate. Global uses the first accessible valid event through the snapshot, including subsequent idle time. Zero-length or unobserved windows have no rate.
- **Global cycles/day:** completed cycles divided by all Lisbon calendar dates from the first accessible event to the snapshot, inclusive, including idle dates. The first and current dates may be partial; this is a calendar-date average, not cycles/hour multiplied by 24.
- A completely observed period without activity shows zero cycles and zero running time; duration extrema and average are N/A. A period with no observation coverage is N/A, not zero activity. Coverage starts at the first accessible valid event; this does not establish when the physical monitoring system was installed.

## History and data quality

The table's 1–500 row limit only affects the table. Statistics load all accessible events at or before the snapshot cutoff via paginated GETs. Every page is checked against the exact total and returned range; server row caps smaller than the requested page size are supported. A failed/inconsistent page clears the dashboard instead of showing partial history as Global. Requests use the existing publishable API key in `apikey`, without treating it as a user JWT. Existing database permissions and RLS remain unchanged.

Pairing is shared by the table and statistics. Repeated starts retain the earliest open start and flag the extra start; repeated/unmatched stops are not assigned a duration. Opposing transitions at the same parsed millisecond have unknown order, so they are flagged and excluded rather than inventing a cycle. Invalid events are flagged and excluded. Missing events cannot be reconstructed reliably; warnings explain that totals may differ from actual operation. The open state is inferred from the event stream, not independently verified pump telemetry. Nothing sends start/stop commands.

The snapshot and all metrics stay fixed until Refresh. Changing the table limit makes no network request. Requests exclude later timestamps; changing row counts during pagination aborts the load. Multiple REST requests are **not a transactional database snapshot**: concurrent edits or backdated inserts/deletes with unchanged total count cannot always be detected. If history grows large or is edited concurrently, move reconstruction/aggregation to a server-side snapshot API. Above 250,000 rows the dashboard explicitly refuses browser aggregation. RLS-hidden or deleted records are unknowable from the browser; “Global” covers accessible retained history only.

## Verification

Requires Node.js 18+:

```sh
node --test tests/*.test.cjs
```

Tests exercise the actual metric and pagination modules: cross-midnight allocation, full-day rates, idle dates, Lisbon/UTC differences, both DST transitions, events without pairs, duplicates, ambiguous timestamps, invalid data, incomplete coverage, zero-length windows, short server pages, changing counts and page failures. No test contacts Supabase or controls the pump.
