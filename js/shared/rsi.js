/**
 * Wilder's smoothed RSI.
 * Returns { value: number|null, series: number[] } so divergence can reuse the series.
 */

export function calculateRSI(closes, period = 14) {
    if (!closes || closes.length < period + 1) {
        return { value: null, series: [] };
    }

    const gains = [];
    const losses = [];

    for (let i = 1; i < closes.length; i++) {
        const change = closes[i] - closes[i - 1];
        gains.push(change > 0 ? change : 0);
        losses.push(change < 0 ? Math.abs(change) : 0);
    }

    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

    const series = [];
    let rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    series.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + rs));

    for (let i = period; i < gains.length; i++) {
        avgGain = (avgGain * (period - 1) + gains[i]) / period;
        avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
        rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
        series.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + rs));
    }

    return { value: series[series.length - 1], series };
}

/** Scalar-only helper (CI / simple callers). */
export function calculateRSIValue(closes, period = 14) {
    return calculateRSI(closes, period).value;
}
