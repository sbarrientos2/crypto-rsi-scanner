/**
 * Stocks market adapter: live scan via Cloudflare Pages Functions
 * (Yahoo klines + Backpack ticker discovery).
 */

import { DEFAULT_CONFIG, STOCK_TIMEFRAMES } from '../shared/config.js';
import { analyzeTimeframes, flattenAnalysis } from '../shared/analyze.js';
import { roundRsi } from '../shared/util.js';

const KLINES_API = '/api/stock-klines';
const TICKERS_API = '/api/stock-tickers';

const klinesCache = new Map();
const CACHEABLE = new Set(['1w', '1M']);

async function getKlines(symbol, interval, config = DEFAULT_CONFIG) {
    const cacheKey = `${symbol}:${interval}`;
    if (CACHEABLE.has(interval)) {
        const cached = klinesCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < config.CACHE_TTL_MS) {
            return cached.candles;
        }
    }

    try {
        const response = await fetch(
            `${KLINES_API}?symbol=${encodeURIComponent(symbol)}&interval=${interval}`,
            { signal: AbortSignal.timeout(config.FETCH_TIMEOUT_MS) }
        );
        if (!response.ok) return null;
        const data = await response.json();
        if (!Array.isArray(data.candles) || data.candles.length === 0) return null;
        const candles = data.candles.slice(-config.KLINES_LIMIT).map(c => ({
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
        }));
        if (CACHEABLE.has(interval)) {
            if (klinesCache.size >= config.MAX_CACHE_ENTRIES) {
                const oldestKey = klinesCache.keys().next().value;
                klinesCache.delete(oldestKey);
            }
            klinesCache.set(cacheKey, { candles, timestamp: Date.now() });
        }
        return candles;
    } catch {
        return null;
    }
}

async function getStockTickers(config = DEFAULT_CONFIG) {
    const response = await fetch(TICKERS_API, {
        signal: AbortSignal.timeout(config.FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.tickers || []).map(t => ({
        symbol: t.ticker,
        baseAsset: t.ticker,
        backpackSymbol: t.backpackSymbol,
    }));
}

async function processPair(pair, config = DEFAULT_CONFIG) {
    const candlesByTf = {};
    await Promise.all(
        STOCK_TIMEFRAMES.map(async tf => {
            candlesByTf[tf] = await getKlines(pair.symbol, tf, config);
        })
    );

    const analysis = analyzeTimeframes(candlesByTf, STOCK_TIMEFRAMES, config);
    const flat = flattenAnalysis(analysis, STOCK_TIMEFRAMES);

    // Round RSI for display consistency with crypto snapshot
    for (const tf of STOCK_TIMEFRAMES) {
        flat[`rsi${tf}`] = roundRsi(flat[`rsi${tf}`]);
    }

    return {
        symbol: pair.symbol,
        baseAsset: pair.baseAsset,
        backpackSymbol: pair.backpackSymbol,
        ...flat,
    };
}

/**
 * Live stocks scan with batching (small universe).
 */
export async function loadStocksScan({ updateProgress, config = DEFAULT_CONFIG } = {}) {
    updateProgress?.(0, 100, 'Fetching Backpack stock listings…');
    const pairs = await getStockTickers(config);
    if (pairs.length === 0) throw new Error('No stock tickers found');

    const rows = [];
    let failed = 0;
    const batchSize = config.BATCH_SIZE;
    const maxConcurrent = config.MAX_CONCURRENT_BATCHES;

    const batches = [];
    for (let i = 0; i < pairs.length; i += batchSize) {
        batches.push(pairs.slice(i, i + batchSize));
    }

    let batchIndex = 0;
    let completed = 0;

    async function worker() {
        while (batchIndex < batches.length) {
            const idx = batchIndex++;
            const batch = batches[idx];
            const settled = await Promise.allSettled(batch.map(p => processPair(p, config)));
            for (const r of settled) {
                if (r.status === 'fulfilled' && r.value) {
                    const hasAny = STOCK_TIMEFRAMES.some(tf => r.value[`rsi${tf}`] !== null);
                    if (hasAny) rows.push(r.value);
                    else failed++;
                } else {
                    failed++;
                }
            }
            completed += batch.length;
            updateProgress?.(
                Math.min(completed, pairs.length),
                pairs.length,
                `Scanning ${Math.min(completed, pairs.length)} of ${pairs.length} stocks…`
            );
            await new Promise(r => setTimeout(r, config.BATCH_DELAY_MS));
        }
    }

    await Promise.all(Array.from({ length: maxConcurrent }, () => worker()));

    return {
        rows,
        meta: {
            source: 'live',
            last_updated: new Date().toISOString(),
            processed: pairs.length,
            failed,
        },
    };
}

export function stockChartUrl(item) {
    return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(item.symbol)}`;
}

export function stockPairLabel(item) {
    return item.backpackSymbol || item.symbol;
}

export function stockNameLabel(item) {
    return item.baseAsset;
}
