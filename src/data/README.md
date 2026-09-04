# Build-time data contract

`corpus.json` is written by `crosspeel-engine/scripts/export-site-data.mjs` before
every Astro build. The site reads this file and nothing else. It never queries D1
at runtime - document 02, routes: "the built site never queries D1 at runtime",
so a database problem cannot take the site down or show a reader a half-written
row.

The file committed here is the empty state. It is valid and the site must build
and render correctly from it: zero clusters, zero endpoints, every figure showing
zero rather than a placeholder.

## Shape

```
generated_at            ISO 8601 UTC string, or null when never exported
observed_through        ISO 8601 UTC of the newest observation, or null
stats.endpoints_observed        integer
stats.clusters_published        integer
stats.widest_spread_multiple    number, 2dp
stats.last_probe_run            ISO 8601 UTC, or null
method_version          string, e.g. "v1"

clusters[]              only rows with published = 1
  id, slug, capability, confidence, method_version
  matched_fields, compared_fields, paired_obs_count
  min_price_usd, max_price_usd, spread_multiple
  first_published, last_updated
  members[]             { endpoint_id, hostname, url, operator_name,
                          price_usd, multiple_vs_min, observed_at }
  fields[]              { field, values: { endpoint_id: value }, identical: bool }
  evidence[]            { observation_id, endpoint_id, observed_at, status_code,
                          body_sha256, r2_body_key, r2_headers_key, permalink }
  observation_window    { from, to, distinct_inputs }
  disputes[]            { id, received_at, claimant, claim, response, outcome }

endpoints[]
  id, slug, url, hostname, operator_name, capability, tag,
  source_directory, first_seen, last_seen, status,
  cluster_slug | null,
  price_history[]       { observed_at, amount_usd, asset, raw_amount, provenance }
  observations[]        { observation_id, observed_at, status_code, ttfb_ms,
                          total_ms, cost_usd, body_sha256, permalink }

disputes[]              every dispute, including ones Crosspeel lost
featured_diff           the home page pane, or null when nothing is published
bakeoff                 price variants and probe depth, from document 04
```

## Rules that hold for every consumer of this file

- A figure that is zero displays as zero. No placeholder figure ever ships.
- Every number rendered carries the date it was observed and links to its evidence.
- `permalink` on an evidence row must resolve. A cluster page whose evidence link
  404s is worse than no cluster page.
