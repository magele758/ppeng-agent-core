# @ppeng/agent-stock

Equity-research domain bundle for `@ppeng/agent-core`. Mounted by the daemon when `RAW_AGENT_DOMAINS=stock` (alone or combined).

## Personas

| Persona | Use case | Allowed tools |
| --- | --- | --- |
| `stock-analyst` | Deep individual-stock report | `quote_get`, `fundamentals_get`, `news_search`, `web_fetch`, safe repo reads, `write_file` |
| `stock-screener` | Watchlist scan / outlier detection | `quote_get`, `fundamentals_get`, `news_search` (no writes) |

Both personas auto-load the **Stock Analysis Playbook** skill (PE-Band, quick DCF, industry comparison, output template, "not investment advice" disclaimer).

## Tools (all read-only)

| Tool | Purpose | Provider switch |
| --- | --- | --- |
| `quote_get` | Latest quote for a symbol | yahoo (default) / alphavantage / mock |
| `fundamentals_get` | PE / PB / ROE / margins | yahoo (default) / alphavantage / mock |
| `news_search` | Recent news for a ticker or topic | yahoo (default) / mock; `STOCK_NEWS_URL` overrides |

Provider is chosen by `STOCK_QUOTE_PROVIDER` (per-call `provider` arg overrides). The `mock` provider returns deterministic fixtures without touching the network — ideal for CI / offline development.

## Local config example

```bash
RAW_AGENT_DOMAINS=stock

# Default Yahoo (no key required, but rate-limited):
STOCK_QUOTE_PROVIDER=yahoo

# Or Alpha Vantage (requires a free API key):
STOCK_QUOTE_PROVIDER=alphavantage
STOCK_API_KEY=...

# Or fully offline:
STOCK_QUOTE_PROVIDER=mock
```

## Boundaries

- Stock tools only fetch data; **no** order placement / portfolio mutation tools are included.
- The `stock-analyst` persona's instructions enforce: cite the source per number, end every reply with "Not investment advice."
