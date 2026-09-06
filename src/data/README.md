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
evidence_dropped        integer, observations left out because their artifact was
                        not in the store; the count travels, the detail stays in
                        the private run report
evidence_verified       bool, true only when the exporter checked every permalink
                        against the store the evidence route serves
evidence_store          "r2", "manifest", "staging", or null when no store was
                        consulted; only "r2" and "manifest" certify a permalink
next_probe_run          ISO 8601 UTC, or null - nothing in D1 records a future run
stats.endpoints_observed        integer, endpoints paid for and measured
stats.endpoints_screened        integer, endpoints called at least once, paid or not
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
  latest_observed_price { observed_at, amount_usd, asset, raw_amount, provenance } | null
  observation_count     integer
  price_history[]       { observed_at, amount_usd, asset, raw_amount, provenance }
  observations[]        { observation_id, observed_at, status_code, ttfb_ms,
                          total_ms, cost_usd, body_sha256, permalink,
                          headers_permalink }

disputes[]              every dispute, including ones Crosspeel lost
featured_diff           the home page pane, or null when nothing is published
bakeoff                 price variants and probe depth, from document 04
```

## Rules that hold for every consumer of this file

- A figure that is zero displays as zero. No placeholder figure ever ships.
- `endpoints_observed` counts only endpoints with at least one observation the probe
  paid for, because document 00 defines observed as "paid for and measured". An
  endpoint that only ever returned a 402 challenge is counted in `endpoints_screened`
  and nowhere else. A surface that renders one of these figures under the other's
  label is wrong even though both numbers are real. Settled at gate G1, 2026-09-04.
- Every number rendered carries the date it was observed and links to its evidence.
- `permalink` on an evidence row must resolve. A cluster page whose evidence link
  404s is worse than no cluster page. Permalinks are `https://crosspeel.com/evidence/`
  followed by the R2 key, and `src/worker/index.js` serves that path from the
  `crosspeel-artifacts` bucket - read-only, immutable, never rendered as a page.
  The key must be in the bucket: the Worker cannot invent an artifact, and
  `crosspeel-engine/scripts/flush-artifacts.mjs` is what puts one there.
- A permalink is written only when the exporter certified it against the store
  the route serves: a direct look at the `crosspeel-artifacts` bucket
  (`evidence_store: "r2"`) or a flush manifest for that bucket
  (`evidence_store: "manifest"`). An export that only saw the staging tree
  withholds every permalink as `null` and sets `evidence_verified: false`; the
  endpoint page then renders "not yet stored" where the links would be, and no
  cluster with evidence is published. Settled at gate G2, 2026-09-05.
- The file committed on 2026-09-05 is that withheld state: 122 endpoints
  observed, 1,265 screened, 6,667 observations, every `permalink` and
  `headers_permalink` null, zero clusters. The bucket was verified empty on
  2026-09-05. The one cluster that cleared G1 (`crypto-market-analysis-01`, in
  D1 with `published = 1`) enters this file when its evidence has been
  re-probed, flushed, and exported with `--flush-manifest`.

## How the site reaches crosspeel.com

The site is a Cloudflare Worker with static assets (`wrangler.json`): `astro
build` writes `dist/`, `src/worker/index.js` answers `/evidence/*` from the
`crosspeel-artifacts` bucket and hands every other path to the assets. It serves
at `https://crosspeel.com` (custom domain) and `https://crosspeel.hoags.workers.dev`
since 2026-09-05, Version `794b1047-2e2e-48f2-9b57-ba86e6f977e3`.

Deploys are by hand. There is no Workers Builds connection on the Worker and no
CI in this repository, so a merge to `main` changes nothing on the live site.
After `npm run build`, `npx wrangler deploy` with an account API token that can
edit Workers and read R2 publishes what `dist/` holds. The evidence route and the
corpus travel together: a corpus with certified permalinks must not be deployed
before the flush that certified it has run.
