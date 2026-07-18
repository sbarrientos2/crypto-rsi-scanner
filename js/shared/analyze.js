import { DEFAULT_CONFIG } from './config.js';
import { calculateRSI } from './rsi.js';
import { detectDivergence } from './divergence.js';
import { getStatus } from './status.js';

/**
 * Given OHLC candles keyed by timeframe, compute RSI, divergences, and status.
 *
 * @param {Record<string, Array<{open:number,high:number,low:number,close:number}>|null|undefined>} candlesByTf
 * @param {string[]} timeframeKeys
 * @param {Partial<typeof DEFAULT_CONFIG>} [config]
 * @returns {{
 *   rsi: Record<string, number|null>,
 *   divergences: Record<string, 'bullish'|'bearish'|null>,
 *   status: string,
 *   priority: number,
 *   incomplete: boolean
 * }}
 */
export function analyzeTimeframes(candlesByTf, timeframeKeys, config = DEFAULT_CONFIG) {
    const rsi = {};
    const divergences = {};

    for (const tf of timeframeKeys) {
        const candles = candlesByTf[tf];
        if (candles && candles.length > 0) {
            const closes = candles.map(c => c.close);
            const result = calculateRSI(closes, config.RSI_PERIOD);
            rsi[tf] = result.value;
            divergences[tf] = detectDivergence(candles, result.series, config);
        } else {
            rsi[tf] = null;
            divergences[tf] = null;
        }
    }

    const values = timeframeKeys.map(tf => rsi[tf]);
    const { status, priority, incomplete } = getStatus(values, {
        expectedCount: timeframeKeys.length,
        strongThreshold: config.STRONG_THRESHOLD,
        bullishThreshold: config.BULLISH_THRESHOLD,
    });

    return { rsi, divergences, status, priority, incomplete };
}

/**
 * Flatten analyze result into row fields used by the table UI.
 * e.g. rsi['4h'] → rsi4h, divergences['1M'] → div1M
 */
export function flattenAnalysis(analysis, timeframeKeys) {
    const row = {
        status: analysis.status,
        priority: analysis.priority,
        incomplete: analysis.incomplete,
    };
    for (const tf of timeframeKeys) {
        const prop = tfKeyToProp(tf);
        row[`rsi${prop}`] = analysis.rsi[tf];
        row[`div${prop}`] = analysis.divergences[tf];
    }
    return row;
}

/** Map interval key to camel property suffix: '4h'→'4h', '1M'→'1M', '12h'→'12h' */
export function tfKeyToProp(tf) {
    return tf;
}

/** RSI field name on row objects: rsi4h, rsi1d, rsi1M */
export function rsiField(tf) {
    return `rsi${tf}`;
}

export function divField(tf) {
    return `div${tf}`;
}
