import { DEFAULT_CONFIG } from './config.js';

export function findSwingLows(values, lookback = DEFAULT_CONFIG.SWING_LOOKBACK) {
    const swings = [];
    for (let i = lookback; i < values.length - lookback; i++) {
        let isSwingLow = true;
        for (let j = 1; j <= lookback; j++) {
            if (values[i] >= values[i - j] || values[i] >= values[i + j]) {
                isSwingLow = false;
                break;
            }
        }
        if (isSwingLow) swings.push({ index: i, value: values[i] });
    }
    return swings;
}

export function findSwingHighs(values, lookback = DEFAULT_CONFIG.SWING_LOOKBACK) {
    const swings = [];
    for (let i = lookback; i < values.length - lookback; i++) {
        let isSwingHigh = true;
        for (let j = 1; j <= lookback; j++) {
            if (values[i] <= values[i - j] || values[i] <= values[i + j]) {
                isSwingHigh = false;
                break;
            }
        }
        if (isSwingHigh) swings.push({ index: i, value: values[i] });
    }
    return swings;
}

/**
 * Detect RSI–price divergence in a recent window.
 * - Bullish: price higher low + RSI lower low, second RSI low in oversold zone
 * - Bearish: price higher high + RSI lower high, second RSI high in overbought zone
 * Returns 'bullish' | 'bearish' | null
 */
export function detectDivergence(candles, rsiSeries, config = DEFAULT_CONFIG) {
    if (!candles || !rsiSeries || rsiSeries.length < config.DIVERGENCE_WINDOW) return null;

    const lookback = config.DIVERGENCE_WINDOW + config.DIVERGENCE_BUFFER;
    const recentCandles = candles.slice(-lookback);
    const recentRSI = rsiSeries.slice(-lookback);

    if (recentCandles.length < 10 || recentRSI.length < 10) return null;

    const priceCloses = recentCandles.map(c => c.close);
    const priceSwingLows = findSwingLows(priceCloses, config.SWING_LOOKBACK);
    const priceSwingHighs = findSwingHighs(priceCloses, config.SWING_LOOKBACK);
    const rsiSwingLows = findSwingLows(recentRSI, config.SWING_LOOKBACK);
    const rsiSwingHighs = findSwingHighs(recentRSI, config.SWING_LOOKBACK);

    if (priceSwingLows.length >= 2 && rsiSwingLows.length >= 2) {
        const [priceLow1, priceLow2] = priceSwingLows.slice(-2);
        const [rsiLow1, rsiLow2] = rsiSwingLows.slice(-2);
        const priceDistance = priceLow2.index - priceLow1.index;
        const rsiDistance = rsiLow2.index - rsiLow1.index;

        if (
            priceDistance <= config.DIVERGENCE_WINDOW &&
            priceDistance >= config.MIN_SWING_DISTANCE &&
            rsiDistance <= config.DIVERGENCE_WINDOW &&
            rsiDistance >= config.MIN_SWING_DISTANCE
        ) {
            if (
                priceLow2.value > priceLow1.value &&
                rsiLow2.value < rsiLow1.value &&
                rsiLow2.value < config.OS_THRESHOLD
            ) {
                return 'bullish';
            }
        }
    }

    if (priceSwingHighs.length >= 2 && rsiSwingHighs.length >= 2) {
        const [priceHigh1, priceHigh2] = priceSwingHighs.slice(-2);
        const [rsiHigh1, rsiHigh2] = rsiSwingHighs.slice(-2);
        const priceDistance = priceHigh2.index - priceHigh1.index;
        const rsiDistance = rsiHigh2.index - rsiHigh1.index;

        if (
            priceDistance <= config.DIVERGENCE_WINDOW &&
            priceDistance >= config.MIN_SWING_DISTANCE &&
            rsiDistance <= config.DIVERGENCE_WINDOW &&
            rsiDistance >= config.MIN_SWING_DISTANCE
        ) {
            if (
                priceHigh2.value > priceHigh1.value &&
                rsiHigh2.value < rsiHigh1.value &&
                rsiHigh2.value > config.OB_THRESHOLD
            ) {
                return 'bearish';
            }
        }
    }

    return null;
}
