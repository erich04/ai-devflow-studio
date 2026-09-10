# Runtime Pricing Catalog

This catalog is the authoritative, versioned source used by Coding Runtime cost settlement. A run
stores the exact pricing snapshot it used; historical runs are never repriced from a newer catalog.

## DeepSeek Flash snapshot verified on 2026-09-10

- Source version: `deepseek-pricing-snapshot-2026-09-10`.
- Verified at `2026-09-10T15:17:38.000Z`. This is our verification time, **not an asserted official launch instant**.
- Sources: [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/),
  [official updates](https://api-docs.deepseek.com/updates/).
- `deepseek-flash` is the new public name. The existing `deepseek-v4-flash` and
  `deepseek-v4-flash-vision-exp` aliases route to V4.1 Flash; saved user configuration is preserved.
- The announcement gives the Flash release date but no exact switch instant. Calls between the
  start of that Beijing calendar day (`2026-09-09T16:00:00Z`) and our verification time are unpriced
  by this resolver. Already saved historical settlements are retained, not recalculated.
- `deepseek-v4-pro` keeps its previous rates until the explicitly announced routing change at
  `2026-09-14T04:00:00Z` (12:00 Beijing), then uses the Flash snapshot.

| Model / aliases | Tier | Cache-hit input | Cache-miss input | Output |
| --- | --- | ---: | ---: | ---: |
| Flash | off-peak | $0.003 | $0.15 | $0.60 |
| Flash | peak | $0.006 | $0.30 | $1.20 |

All prices are USD per 1 million tokens. Peak hours follow the same schedule below.

## Historical DeepSeek V4 snapshot

- Source checked: 2026-08-30.
- Source version: `deepseek-pricing-snapshot-2026-08-30`.
- Official effective time: `2026-08-16T16:00:00.000Z`.
- Currency/unit: USD per 1 million tokens.
- Official sources: [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/),
  [Chat Completions usage schema](https://api-docs.deepseek.com/api/create-chat-completion/), and
  [Context caching](https://api-docs.deepseek.com/guides/kv_cache/).
- Effective-version source: [DeepSeek V4 pricing announcement](https://api-docs.deepseek.com/news/news260813/).

| Model | Tier | Cache-hit input | Cache-miss input | Output |
| --- | --- | ---: | ---: | ---: |
| `deepseek-v4-flash` | off-peak | $0.007 | $0.22 | $0.66 |
| `deepseek-v4-flash` | peak | $0.014 | $0.44 | $1.32 |
| `deepseek-v4-pro` | off-peak | $0.022 | $0.66 | $1.98 |
| `deepseek-v4-pro` | peak | $0.044 | $1.32 | $3.96 |
| `deepseek-v4-flash-vision-exp` | off-peak | $0.007 | $0.22 | $0.66 |
| `deepseek-v4-flash-vision-exp` | peak | $0.014 | $0.44 | $1.32 |

Peak hours are Monday through Friday `01:00–04:00` and `06:00–10:00` UTC (Beijing
`09:00–12:00` and `14:00–18:00`), with start inclusive and end exclusive. Weekends and all other
hours are off-peak.

## Settlement contract

DeepSeek reports `prompt_cache_hit_tokens` and `prompt_cache_miss_tokens`. Both must be non-negative
integers and their sum must equal `prompt_tokens`; `total_tokens` must equal prompt plus completion.
Cache tokens are a partition of prompt tokens, never an additional token count.

The persisted settlement contains provider, model, tier, effective time, source/version, three unit
prices, hit/miss/output tokens, hit rate, three cost components, and total. Missing cache fields are
stored as incomplete with null cache values and null cost. A conflicting split is `invalid_usage` and
fails closed. Unknown models and legacy rows without a trustworthy split remain unknown; they are not
silently treated as zero cache hits and do not enter exact settled-cost rollups.

Settlement selects this catalog only when the configured provider context and response parser identify
DeepSeek as the billing provider. A matching model name from another compatible gateway is not enough
to apply DeepSeek prices.

Preflight is separate: it reserves the bounded provider-call envelope using an all-cache-miss peak
estimate. Provider-reported settlement replaces neither the saved preflight decision nor its audit
meaning.

## Stage Agent accounting

Direct Provider and OpenCode stage calls persist `AgentTokenUsage` independently of successful
artifacts. Executor-reported usage also survives output JSON, citation, and read-only repository
validation failures. Retries have distinct records; a failed stage does not advance the workflow.
Missing or partial telemetry is explicit. Model-authored usage and OpenCode's price table are not
accepted as billing authority.

For a verified official DeepSeek binding with complete cache telemetry, stage accounting saves a
**peak-rate estimate** and the exact snapshot. A multi-call Agent session can cross pricing tiers;
this aggregate is not presented as an exact provider invoice. Unrecognized gateways/models or
incomplete telemetry retain the reported token counts and a null amount, displayed as 金额待确认.
Historical traces without an accounting row remain visibly incomplete and are not backfilled.

An allowlisted accounting projection accompanies the existing Run summary. The API appends records
idempotently, rejects conflicting reuse of an ID, and includes unknown amounts in project/member
rollups. Desktop uploads pending stage usage before the next remote budget evaluation. Unknown
amounts or failed synchronization keep the existing budget guard unavailable and blocking.
