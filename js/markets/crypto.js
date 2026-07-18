/**
 * Crypto market adapter: load precomputed scan from /data/scan.json
 * (produced by scan.mjs via GitHub Actions). No per-visitor Binance fan-out.
 */

import { CRYPTO_TIMEFRAMES } from '../shared/config.js';
import { roundRsi } from '../shared/util.js';

const SCAN_URL = '/data/scan.json';
const STRONG_URL = '/data/strong.json';

/**
 * Convert agent/scan.json token objects into table rows.
 */
export function tokensToRows(tokens, timeframeKeys = CRYPTO_TIMEFRAMES) {
    return (tokens || []).map(t => {
        const row = {
            symbol: t.symbol || `${t.base_asset}USDT`,
            baseAsset: t.base_asset || t.symbol,
            status: t.status,
            priority: statusPriority(t.status),
            incomplete: !!t.incomplete,
        };
        for (const tf of timeframeKeys) {
            const rsi = t.rsi?.[tf] ?? null;
            row[`rsi${tf}`] = rsi === null ? null : roundRsi(rsi);
            row[`div${tf}`] = t.divergences?.[tf] ?? null;
        }
        return row;
    });
}

function statusPriority(status) {
    switch (status) {
        case 'strong':
            return 4;
        case 'bullish':
            return 3;
        case 'mixed':
            return 2;
        case 'bearish':
            return 1;
        default:
            return 0;
    }
}

/**
 * Fetch precomputed crypto scan snapshot.
 * Falls back to strong.json (symbols only) if scan.json is missing — UI still loads.
 */
export async function loadCryptoScan({ updateProgress } = {}) {
    updateProgress?.(10, 100, 'Loading precomputed scan…');

    let response;
    try {
        response = await fetch(`${SCAN_URL}?t=${Date.now()}`, {
            signal: AbortSignal.timeout(15000),
            cache: 'no-cache',
        });
    } catch (e) {
        throw new Error(`Failed to fetch scan.json: ${e.message}`);
    }

    if (response.ok) {
        updateProgress?.(60, 100, 'Parsing scan snapshot…');
        const data = await response.json();
        const rows = tokensToRows(data.tokens, CRYPTO_TIMEFRAMES);
        updateProgress?.(100, 100, `Loaded ${rows.length} pairs`);
        return {
            rows,
            meta: {
                source: 'scan.json',
                last_updated: data.last_updated || null,
                processed: data.health?.processed ?? data.counts?.total ?? rows.length,
                failed: data.health?.failed ?? 0,
                strong_count: data.counts?.strong ?? rows.filter(r => r.status === 'strong').length,
            },
        };
    }

    // Fallback: strong.json (symbols only — incomplete rows)
    updateProgress?.(40, 100, 'scan.json missing — loading strong.json…');
    const strongRes = await fetch(`${STRONG_URL}?t=${Date.now()}`, {
        signal: AbortSignal.timeout(15000),
        cache: 'no-cache',
    });
    if (!strongRes.ok) {
        throw new Error(
            `No precomputed data (scan.json HTTP ${response.status}, strong.json HTTP ${strongRes.status}). Run npm run scan or wait for CI.`
        );
    }
    const strong = await strongRes.json();
    const rows = (strong.tokens || []).map(base => ({
        symbol: `${base}USDT`,
        baseAsset: base,
        status: 'strong',
        priority: 4,
        incomplete: true, // no per-TF RSI in strong.json-only fallback
        ...Object.fromEntries(
            CRYPTO_TIMEFRAMES.flatMap(tf => [
                [`rsi${tf}`, null],
                [`div${tf}`, null],
            ])
        ),
    }));
    // strong-only fallback: mark as mixed+incomplete so we don't claim full multi-TF strong without data
    for (const row of rows) {
        row.status = 'mixed';
        row.priority = 2;
        row.incomplete = true;
    }

    updateProgress?.(100, 100, `Loaded ${rows.length} strong symbols (limited data)`);
    return {
        rows,
        meta: {
            source: 'strong.json-fallback',
            last_updated: strong.last_updated || null,
            processed: strong.count ?? rows.length,
            failed: 0,
            note: 'Full scan.json not available; showing symbol list only',
        },
    };
}

export function cryptoChartUrl(item) {
    return `https://www.tradingview.com/chart/?symbol=BINANCE:${encodeURIComponent(item.symbol)}`;
}

export function cryptoPairLabel(item) {
    return item.symbol;
}

export function cryptoNameLabel(item) {
    return item.baseAsset;
}
