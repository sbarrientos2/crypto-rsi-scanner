# RSI Scanner

Multi-timeframe **RSI terminal** for:

| Market | Route | Universe | Data |
|--------|-------|----------|------|
| **Crypto** | `/` | Binance USDT spot pairs | Precomputed `data/scan.json` (CI) |
| **Stocks** | `/stocks` | Backpack tokenized US equities | Live via Cloudflare Pages Functions (Yahoo + Backpack) |

## Features

- Wilder RSI(14) across multiple timeframes
- Status: **Strong / Bullish / Mixed / Bearish** (all TFs must be present for Strong/Bullish/Bearish)
- Incomplete-data badge (`INC`) when any timeframe is missing
- Divergence badges (DIV↑ / DIV↓), OB/OS tags
- Starred watchlist, search, filters, dark/light theme
- Agent-friendly JSON: `?view=json` and `?filter=strong,bullish`
- Scan health chip (source, failed/incomplete counts)

## Architecture

```
Browser
  /            → loads /data/scan.json (no Binance fan-out)
  /stocks      → /api/stock-tickers + /api/stock-klines → Yahoo / Backpack

GitHub Actions (cron every 4h)
  node scan.mjs
    → data/scan.json   (full matrix)
    → data/strong.json (strong symbols only)

Shared logic: js/shared/{rsi,divergence,status,analyze,config}.js
```

## Local development

Requirements: **Node 20+**

```bash
# Unit tests (RSI, status, divergence)
npm test

# Full crypto scan (writes data/scan.json + data/strong.json)
# Uses data-api.binance.vision — can take several minutes
npm run scan

# Local Pages + Functions (stocks proxies)
npm run dev
# then open http://localhost:8788
```

Static crypto UI can also be opened with any static server once `data/scan.json` exists:

```bash
npx --yes serve .
```

## Deploy

Hosted as **Cloudflare Pages**:

- Static assets: HTML, `css/`, `js/`, `data/`
- Functions: `functions/api/stock-klines.js`, `stock-tickers.js`
- No build step required

Connect the GitHub repo to Pages; `functions/` is picked up automatically.

## CI scan job

`.github/workflows/scan.yml` runs every 4 hours (`5 */4 * * *` UTC) and on `workflow_dispatch`:

1. `node scan.mjs`
2. Commits `data/scan.json` and `data/strong.json` if changed

The crypto UI **reads** these files — they are not dead artifacts.

## Status rules

Given RSI values for all configured timeframes:

| Status | Rule |
|--------|------|
| **Strong** | All TFs present and every RSI **> 60** |
| **Bullish** | All TFs present and every RSI **> 50** (but not Strong) |
| **Bearish** | All TFs present and every RSI **< 50** |
| **Mixed** | Mixed signals **or** incomplete TF set |
| **Unknown** | No RSI values at all |

## Agent / machine API

| URL | Purpose |
|-----|---------|
| `/?view=json` | Pretty JSON of current crypto payload |
| `/?view=json&filter=all` | Full token list in JSON view |
| `/data/scan.json` | Static precomputed snapshot (crypto) |
| `/data/strong.json` | Compact strong-token list |
| `/stocks?view=json` | Live stocks scan as JSON |

## Project layout

```
index.html / stocks.html   # thin shells
css/scanner.css            # shared styles
js/
  shared/                  # RSI, divergence, status, UI controller
  markets/                 # crypto (snapshot) + stocks (live) adapters
  crypto-app.js / stocks-app.js
functions/api/             # CF Pages proxies for stocks
scan.mjs                   # CI full-market scan
data/scan.json             # precomputed crypto matrix
data/strong.json           # strong subset
tests/                     # node:test unit tests
```

## License

Private / use as you wish for personal trading research. Not financial advice.
