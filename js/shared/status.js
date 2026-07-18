import { DEFAULT_CONFIG } from './config.js';

/**
 * Classify multi-timeframe RSI into strong / bullish / mixed / bearish / unknown.
 *
 * Strong / bullish / bearish require ALL expected timeframes to be present.
 * Incomplete rows never get strong/bullish/bearish (capped at mixed) and set incomplete=true.
 *
 * @param {Array<number|null|undefined>} values RSI values for each configured TF
 * @param {object} [options]
 * @param {number} [options.expectedCount] Required TF count (defaults to values.length)
 * @param {number} [options.strongThreshold]
 * @param {number} [options.bullishThreshold]
 * @returns {{ status: string, priority: number, incomplete: boolean }}
 */
export function getStatus(values, options = {}) {
    const strongThreshold = options.strongThreshold ?? DEFAULT_CONFIG.STRONG_THRESHOLD;
    const bullishThreshold = options.bullishThreshold ?? DEFAULT_CONFIG.BULLISH_THRESHOLD;
    const expectedCount = options.expectedCount ?? values.length;

    const present = values.filter(v => v !== null && v !== undefined);
    const incomplete = present.length < expectedCount;

    if (present.length === 0) {
        return { status: 'unknown', priority: 0, incomplete: true };
    }

    // Incomplete data: never promote to strong/bullish/bearish
    if (incomplete) {
        return { status: 'mixed', priority: 2, incomplete: true };
    }

    const allAboveStrong = present.every(v => v > strongThreshold);
    const allAboveBullish = present.every(v => v > bullishThreshold);
    const allBelowBullish = present.every(v => v < bullishThreshold);

    if (allAboveStrong) return { status: 'strong', priority: 4, incomplete: false };
    if (allAboveBullish) return { status: 'bullish', priority: 3, incomplete: false };
    if (allBelowBullish) return { status: 'bearish', priority: 1, incomplete: false };
    return { status: 'mixed', priority: 2, incomplete: false };
}
