// scan.mjs — runs every 4h via GitHub Actions (cron at :05 after each 4h candle).
// Writes:
//   data/scan.json   — full multi-TF RSI + divergences + status (consumed by the crypto UI)
//   data/strong.json — compact list of tokens with status === 'strong' (derived subset)
//
// Uses shared modules so CI and the browser share the same RSI / status / divergence logic.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
    BINANCE_VISION_BASE,
    CRYPTO_TIMEFRAMES,
    DEFAULT_CONFIG,
} from './js/shared/config.js';
import { analyzeTimeframes } from './js/shared/analyze.js';
import { roundRsi } from './js/shared/util.js';

const BINANCE_BASE = BINANCE_VISION_BASE;
const TIMEFRAMES = CRYPTO_TIMEFRAMES;
const KLINES_LIMIT = DEFAULT_CONFIG.KLINES_LIMIT;
const CONCURRENCY = 25;
const FETCH_TIMEOUT_MS = 20000;
const SCAN_OUTPUT = 'data/scan.json';
const STRONG_OUTPUT = 'data/strong.json';

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
                else failed++;
            } catch {
                failed++;
            }
            processed++;
            if (processed % 50 === 0) {
                console.log(`  progress: ${processed}/${pairs.length} (${failed} failed)`);
            }
        }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    // Stable sort: strong first, then by symbol
    results.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return a.base_asset.localeCompare(b.base_asset);
    });

    const last_updated = new Date().toISOString();
    const counts = {
        total: results.length,
        strong: results.filter(r => r.status === 'strong').length,
        bullish: results.filter(r => r.status === 'bullish').length,
        mixed: results.filter(r => r.status === 'mixed').length,
        bearish: results.filter(r => r.status === 'bearish').length,
    };
    const incomplete = results.filter(r => r.incomplete).length;

    const byStatus = s =>
        results
            .filter(r => r.status === s)
            .map(r => ({ symbol: r.base_asset, pair: r.symbol }));

    const scanPayload = {
        version: 1,
        market: 'crypto',
        state: 'ready',
        last_updated,
        error: null,
        filter: 'all',
        source: 'scan.mjs',
        health: {
            processed: pairs.length,
            failed,
            incomplete,
            elapsed_s: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
        },
        counts,
        categories: {
            strong: byStatus('strong'),
            bullish: byStatus('bullish'),
            mixed: byStatus('mixed'),
            bearish: byStatus('bearish'),
        },
        tokens: results.map(r => ({
            symbol: r.symbol,
            base_asset: r.base_asset,
            pair: r.symbol,
            status: r.status,
            incomplete: r.incomplete,
            rsi: r.rsi,
            divergences: r.divergences,
        })),
    };

    const strongTokens = results
        .filter(r => r.status === 'strong')
        .map(r => r.base_asset)
        .sort();

    const strongPayload = {
        last_updated,
        count: strongTokens.length,
        tokens: strongTokens,
    };

    await mkdir(dirname(SCAN_OUTPUT), { recursive: true });
    await writeFile(SCAN_OUTPUT, JSON.stringify(scanPayload) + '\n');
    await writeFile(STRONG_OUTPUT, JSON.stringify(strongPayload, null, 2) + '\n');

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(
        `✓ ${SCAN_OUTPUT} written — ${results.length} tokens ` +
            `(${counts.strong} strong, ${incomplete} incomplete, ${failed} failed) in ${elapsed}s`
    );
    console.log(`✓ ${STRONG_OUTPUT} written — ${strongTokens.length} strong tokens`);
    if (strongTokens.length > 0) console.log(`  ${strongTokens.join(', ')}`);
}

async function getUSDTPairs() {
    const r = await fetch(`${BINANCE_BASE}/exchangeInfo`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!r.ok) throw new Error(`exchangeInfo HTTP ${r.status}`);
    const data = await r.json();
    return data.symbols
        .filter(
            s =>
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
    const candlesByTf = {};
    await Promise.all(
        TIMEFRAMES.map(async tf => {
            candlesByTf[tf] = await getKlines(pair.symbol, tf);
        })
    );

    // Need at least one timeframe with data
    const any = TIMEFRAMES.some(tf => candlesByTf[tf]?.length);
    if (!any) return null;

    const analysis = analyzeTimeframes(candlesByTf, TIMEFRAMES, DEFAULT_CONFIG);

    const rsi = {};
    const divergences = {};
    for (const tf of TIMEFRAMES) {
        rsi[tf] = roundRsi(analysis.rsi[tf]);
        divergences[tf] = analysis.divergences[tf];
    }

    return {
        symbol: pair.symbol,
        base_asset: pair.baseAsset,
        status: analysis.status,
        priority: analysis.priority,
        incomplete: analysis.incomplete,
        rsi,
        divergences,
    };
}

async function getKlines(symbol, interval) {
    try {
        const url = `${BINANCE_BASE}/klines?symbol=${symbol}&interval=${interval}&limit=${KLINES_LIMIT}`;
        const r = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!r.ok) return null;
        const data = await r.json();
        return data.map(c => ({
            open: parseFloat(c[1]),
            high: parseFloat(c[2]),
            low: parseFloat(c[3]),
            close: parseFloat(c[4]),
        }));
    } catch {
        return null;
    }
}

main().catch(e => {
    console.error('Scan failed:', e);
    process.exit(1);
});
