// build-cmc-slugs.mjs — builds data/cmc-slugs.json for direct CoinMarketCap links.
// CMC pages use SEO slugs (JST → "just"), not tickers. This maps Binance USDT
// base assets → best CMC slug (active + lowest rank wins on collisions).
//
// Source: public CMC crypto directory (no API key).
// Intended to run in CI alongside scan.mjs.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const CMC_CRYPTOS_URL = 'https://s3.coinmarketcap.com/generated/core/crypto/cryptos.json';
const BINANCE_BASE = 'https://data-api.binance.vision/api/v3';
const OUTPUT = 'data/cmc-slugs.json';
const FETCH_TIMEOUT_MS = 60000;

async function main() {
    const startedAt = Date.now();
    console.log(`[${new Date().toISOString()}] Building CMC slug map`);

    const [cryptos, baseAssets] = await Promise.all([
        fetchJson(CMC_CRYPTOS_URL),
        getBinanceUsdtBaseAssets(),
    ]);

    const allSlugs = buildSymbolSlugMap(cryptos);
    console.log(`  CMC directory: ${allSlugs.size} unique symbols`);

    const slugs = {};
    let hit = 0;
    let miss = 0;
    for (const base of baseAssets) {
        const slug = allSlugs.get(base);
        if (slug) {
            slugs[base] = slug;
            hit++;
        } else {
            miss++;
        }
    }

    // Stable key order for cleaner git diffs
    const ordered = {};
    for (const key of Object.keys(slugs).sort()) {
        ordered[key] = slugs[key];
    }

    const payload = {
        last_updated: new Date().toISOString(),
        source: CMC_CRYPTOS_URL,
        binance_bases: baseAssets.length,
        mapped: hit,
        unmapped: miss,
        slugs: ordered,
    };

    await mkdir(dirname(OUTPUT), { recursive: true });
    await writeFile(OUTPUT, JSON.stringify(payload) + '\n');

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(
        `✓ ${OUTPUT} written — ${hit}/${baseAssets.length} bases mapped` +
            (miss ? ` (${miss} unmapped → UI falls back to search)` : '') +
            ` in ${elapsed}s`
    );
    // Smoke-check known slug
    if (ordered.JST && ordered.JST !== 'just') {
        console.warn(`  warning: expected JST→just, got ${ordered.JST}`);
    } else if (ordered.JST) {
        console.log('  check: JST → just ✓');
    }
}

/**
 * Parse CMC cryptos.json compact format:
 * { fields: ["id","name","symbol","slug",...], values: [[...], ...] }
 * Prefer active listings, then lowest rank when symbols collide.
 */
function buildSymbolSlugMap(cryptos) {
    const fields = cryptos.fields || [];
    const values = cryptos.values || [];
    const idx = Object.fromEntries(fields.map((f, i) => [f, i]));

    if (idx.symbol == null || idx.slug == null) {
        throw new Error('CMC cryptos.json missing symbol/slug fields');
    }

    /** @type {Map<string, { slug: string, rank: number, active: number }>} */
    const best = new Map();

    for (const row of values) {
        const symbol = row[idx.symbol];
        const slug = row[idx.slug];
        if (!symbol || !slug) continue;

        const active = idx.is_active != null ? Number(row[idx.is_active]) : 1;
        const rankRaw = idx.rank != null ? Number(row[idx.rank]) : 0;
        const rank = rankRaw > 0 ? rankRaw : 999999;

        const cand = { slug, rank, active };
        const cur = best.get(symbol);
        if (!cur || isBetter(cand, cur)) {
            best.set(symbol, cand);
        }
    }

    const map = new Map();
    for (const [symbol, info] of best) {
        map.set(symbol, info.slug);
    }
    return map;
}

function isBetter(cand, cur) {
    if (cand.active === 1 && cur.active !== 1) return true;
    if (cand.active !== 1 && cur.active === 1) return false;
    return cand.rank < cur.rank;
}

async function getBinanceUsdtBaseAssets() {
    const data = await fetchJson(`${BINANCE_BASE}/exchangeInfo`);
    const bases = new Set();
    for (const s of data.symbols || []) {
        if (
            s.quoteAsset === 'USDT' &&
            s.status === 'TRADING' &&
            !s.symbol.includes('UP') &&
            !s.symbol.includes('DOWN') &&
            !s.symbol.includes('BEAR') &&
            !s.symbol.includes('BULL')
        ) {
            bases.add(s.baseAsset);
        }
    }
    return [...bases].sort();
}

async function fetchJson(url) {
    const r = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
    return r.json();
}

main().catch(e => {
    console.error('CMC slug build failed:', e);
    process.exit(1);
});
