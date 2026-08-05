// scan.mjs — runs hourly via GitHub Actions, writes data/strong.json
// "Strong" = every available RSI timeframe (4h/12h/1d/3d/1w/1M) is > 60.
// Output is intentionally minimal: { last_updated, count, tokens: ["BTC", ...] }

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// Binance's public market-data CDN. Same API surface as api.binance.com but
// hosted on Cloudflare and geo-permissive — required because api.binance.com
// returns HTTP 451 to GitHub Actions runners.
const BINANCE_BASE = 'https://data-api.binance.vision/api/v3';
const TIMEFRAMES = ['4h', '12h', '1d', '3d', '1w', '1M'];
const KLINES_LIMIT = 35;
const RSI_PERIOD = 14;
const STRONG_THRESHOLD = 60;
const CONCURRENCY = 25;
const FETCH_TIMEOUT_MS = 20000;
const OUTPUT = 'data/strong.json';

async function main() {
    const startedAt = Date.now();
    console.log(`[${new Date().toISOString()}] Scan starting`);

    const pairs = await getUSDTPairs();
    if (pairs.length === 0) throw new Error('No pairs returned from /exchangeInfo');
    console.log(`  ${pairs.length} USDT pairs to scan`);

    const results = [];
    let idx = 0;
    let processed = 0;
    let failed = 0;

    async function worker() {
        while (idx < pairs.length) {
            const pair = pairs[idx++];
            try {
                const r = await processPair(pair);
                if (r) results.push(r);
            } catch (e) {
                failed++;
            }
            processed++;
            if (processed % 50 === 0) {
                console.log(`  progress: ${processed}/${pairs.length} (${failed} failed)`);
            }
        }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    const strong = results
        .filter(r => r.status === 'strong')
        .map(r => r.baseAsset)
        .sort();

    const payload = {
        last_updated: new Date().toISOString(),
        count: strong.length,
        tokens: strong
    };

    await mkdir(dirname(OUTPUT), { recursive: true });
    await writeFile(OUTPUT, JSON.stringify(payload, null, 2) + '\n');

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`✓ ${OUTPUT} written — ${strong.length} strong tokens in ${elapsed}s`);
    if (strong.length > 0) console.log(`  ${strong.join(', ')}`);
}

async function getUSDTPairs() {
    const r = await fetch(`${BINANCE_BASE}/exchangeInfo`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (!r.ok) throw new Error(`exchangeInfo HTTP ${r.status}`);
    const data = await r.json();
    return data.symbols
        .filter(s =>
            s.quoteAsset === 'USDT' &&
            s.status === 'TRADING' &&
            !s.symbol.includes('UP') &&
            !s.symbol.includes('DOWN') &&
            !s.symbol.includes('BEAR') &&
            !s.symbol.includes('BULL')
        )
        .map(s => ({ symbol: s.symbol, baseAsset: s.baseAsset }));
}

async function processPair(pair) {
    const candlesPerTf = await Promise.all(
        TIMEFRAMES.map(tf => getKlines(pair.symbol, tf))
    );

    const rsiValues = [];
    for (const candles of candlesPerTf) {
        if (!candles) continue;
        const closes = candles.map(c => parseFloat(c[4]));
        const rsi = calculateRSI(closes);
        if (rsi !== null) rsiValues.push(rsi);
    }
    if (rsiValues.length === 0) return null;

    // Mirrors getStatus() in index.html: "strong" = ALL non-null RSI values > 60.
    const status = rsiValues.every(v => v > STRONG_THRESHOLD) ? 'strong' : 'other';
    return { symbol: pair.symbol, baseAsset: pair.baseAsset, status };
}

async function getKlines(symbol, interval) {
    try {
        const url = `${BINANCE_BASE}/klines?symbol=${symbol}&interval=${interval}&limit=${KLINES_LIMIT}`;
        const r = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!r.ok) return null;
        return await r.json();
    } catch {
        return null;
    }
}

// Wilder's smoothed RSI — same formula as index.html
function calculateRSI(closes, period = RSI_PERIOD) {
    if (closes.length < period + 1) return null;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff > 0) gains += diff;
        else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    for (let i = period + 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff > 0) {
            avgGain = (avgGain * (period - 1) + diff) / period;
            avgLoss = (avgLoss * (period - 1)) / period;
        } else {
            avgGain = (avgGain * (period - 1)) / period;
            avgLoss = (avgLoss * (period - 1) - diff) / period;
        }
    }
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

main().catch(e => {
    console.error('Scan failed:', e);
    process.exit(1);
});
