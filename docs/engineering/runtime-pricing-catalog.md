# Runtime Pricing Catalog

This catalog is the authoritative, versioned source used by Coding Runtime cost settlement. A run
stores the exact pricing snapshot it used; historical runs are never repriced from a newer catalog.

## DeepSeek V4 snapshot

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
