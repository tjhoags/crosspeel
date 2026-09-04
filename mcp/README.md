# Crosspeel MCP

Crosspeel measures whether independently branded machine-payable API endpoints are actually independent. It pays each endpoint, records its technical fingerprint, groups the ones whose responses agree, and reports the price difference between them.

This is the interface an agent calls mid-run to ask whether the endpoints it is about to use return the same thing as each other.

## Status

Recorded 2026-09-04.

- The three tools, the response format, and the four rules below are built.
- The endpoint is not yet serving. Nothing below has been called against a deployed server.
- No per-call price has been derived, so no price is published. See payment.
- `depth` `live` is not yet available. `check_stack` refuses it and states so rather than answering from the corpus and calling it live.

## Install

One entry. There is no package to install, no key to obtain, and no account to create.

```json
{
  "mcpServers": {
    "crosspeel": {
      "type": "http",
      "url": "https://mcp.crosspeel.com"
    }
  }
}
```

Payment is per call at the transport layer, in USDC on Base. A harness that settles x402 pays and continues. A harness that does not receives a 402 with the amount and the address.

## Tools

### check_stack

Reports which of the submitted endpoints returned matching responses when they were probed, what each one charges, and when each price was observed.

| Input | Type | Notes |
|---|---|---|
| `endpoints` | string array | Two to twelve endpoint urls, http or https, no duplicates |
| `depth` | string | `cached` or `live`. Defaults to `cached` |

`cached` answers from the recorded corpus. `live` triggers a probe run, costs more, takes longer, and adds to the corpus.

Returns `checked_at`, `depth`, `groups`, `unmatched`, `unmatched_reasons`, `prices`, `cheapest_in_group`, `coverage`, `limits`. Full shape in [`schemas/check_stack.output.schema.json`](schemas/check_stack.output.schema.json).

An abbreviated response, from a fixture corpus:

```json
{
  "checked_at": "2026-09-04T11:40:55Z",
  "depth": "cached",
  "groups": [
    {
      "endpoint_ids": [
        "https://alpha.example/v1/quote",
        "https://bravo.example/api/quote",
        "https://charlie.example/quote"
      ],
      "matched_fields": 10,
      "compared_fields": 10,
      "confidence": "high"
    }
  ],
  "unmatched": ["https://golf.example/v1/unseen"],
  "unmatched_reasons": [
    { "endpoint": "https://golf.example/v1/unseen", "reason": "the endpoint has not been observed" }
  ],
  "prices": [
    {
      "endpoint": "https://alpha.example/v1/quote",
      "price_usd": 0.12,
      "multiple_vs_cheapest": 12,
      "observed_at": "2026-09-04T05:00:00Z"
    },
    {
      "endpoint": "https://charlie.example/quote",
      "price_usd": 0.01,
      "multiple_vs_cheapest": 1,
      "observed_at": "2026-09-04T05:00:00Z"
    }
  ],
  "cheapest_in_group": [{ "group": 0, "endpoint": "https://charlie.example/quote" }],
  "coverage": { "known": 5, "unknown": 1 }
}
```

`limits` is omitted from that sample for length. It is never omitted from a response.

### get_cluster

Given one endpoint url, returns the group it was placed in: the other members, the price range with the date each price was observed, the spread multiple, the confidence, the clustering method version, and the address of the evidence page.

Returns `cluster: null` with a `reason` where the endpoint has not been observed, where no group was recorded, or where the recorded group did not reach moderate confidence.

Full shape in [`schemas/get_cluster.output.schema.json`](schemas/get_cluster.output.schema.json).

### cheapest_equivalent

Given one endpoint url, returns the cheapest recorded member of its group, the price difference, and the date each price was observed.

Returns `cheapest: null` with a `reason` where no group was recorded. It does not estimate.

Full shape in [`schemas/cheapest_equivalent.output.schema.json`](schemas/cheapest_equivalent.output.schema.json).

## The four rules

An agent acts on these responses without a human reading them, so the rules are enforced in the response builder rather than left to each tool.

1. **No match is returned where confidence is below moderate.** The endpoint appears in `unmatched` with the reason stated.
2. **Every price carries `observed_at`.** A stale price acted on automatically is a real cost to the caller.
3. **`coverage` is on every response.** `coverage.known` and `coverage.unknown` exist so an absence of duplication can be told apart from an absence of data.
4. **`limits` are on every response.** The same four constraints, every time.

The rules are checkable from the caller's side. `verifyResponse` in [`src/verify.js`](src/verify.js) runs all four against a response that has already arrived and needs nothing from Crosspeel to run.

## What the method cannot see

Carried in every response as `limits`, and repeated here.

- Two operators independently using the same upstream vendor will cluster. That is a shared dependency rather than one operator sourcing from the other, and Crosspeel cannot distinguish the two cases from the outside.
- Two operators running the same open-source template will cluster.
- An operator who deliberately randomises key order and error wording will not cluster, and Crosspeel will not detect that they are avoiding detection.
- Nothing here observes ownership, contracts, or intent. The findings are about responses, not companies.

A group is an agreement between responses. It is not a statement about the operators behind them.

## Payment

| Field | Value |
|---|---|
| Protocol | x402, on the http transport |
| Chain | Base mainnet, `eip155:8453` |
| Asset | USDC |
| Pay to | `0x9819BE816dAA1cEFFb3b9aeAda8cd1EE2477F13e` |
| Price per call | Not yet derived |

Prices are set from measured data. No figure has been derived for a per-call price, so none is published and none is charged. `cached` will quote a low price and `live` a higher one covering the probe cost.

## Disputes

Every group ships its evidence, and every raw response is stored with a timestamp and a content hash. A finding can be disputed at `disputes@crosspeel.com`. Disputes are logged and published alongside the finding, including the ones Crosspeel loses.

A response that breaks one of the four rules is a defect. It goes to the same address.

## Using the client

The client is optional. A harness configured with the entry above calls the tools directly.

```js
import { connect } from './src/index.js';

const crosspeel = await connect();
const result = await crosspeel.checkStack([
  'https://alpha.example/v1/quote',
  'https://bravo.example/api/quote',
]);
```

Every response is checked against the four rules before it is returned. Pass `{ verify: false }` to receive it unchecked.

## Licence

Apache 2.0. See [`LICENSE`](../LICENSE) at the repository root.

The method is published. The corpus is not. Anyone can read how the grouping works; the observations are what took the time to collect.
