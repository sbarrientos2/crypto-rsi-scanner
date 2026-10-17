(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.ScannerCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const INTERVAL_MS = {
        '4h': 4 * 3600000,
        '12h': 12 * 3600000,
        '1d': 24 * 3600000,
        '3d': 3 * 24 * 3600000,
    };

    const DAY_MS = 24 * 3600000;
    const WEEK_MS = 7 * DAY_MS;
    const LEVERAGE_SUFFIXES = ['UP', 'DOWN', 'BULL', 'BEAR'];

    function calculateRSI(closes, period = 14) {
        if (closes.length < period + 1) return { value: null, series: [] };

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
        let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        series.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + rs)));

        for (let i = period; i < gains.length; i++) {
            avgGain = (avgGain * (period - 1) + gains[i]) / period;
            avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
            rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
            series.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + rs)));
        }

        return { value: series[series.length - 1], series };
    }

    function findSwingLows(values, lookback) {
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

    function findSwingHighs(values, lookback) {
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

    function detectDivergence(candles, rsiSeries, config) {
        if (!candles || !rsiSeries || rsiSeries.length < config.window) return null;

        const lookback = config.window + config.buffer;
        const recentCandles = candles.slice(-lookback);
        const recentRSI = rsiSeries.slice(-lookback);

        if (recentCandles.length < 10 || recentRSI.length < 10) return null;

        const priceCloses = recentCandles.map(c => c.close);
        const priceSwingLows = findSwingLows(priceCloses, config.swingLookback);
        const priceSwingHighs = findSwingHighs(priceCloses, config.swingLookback);
        const rsiSwingLows = findSwingLows(recentRSI, config.swingLookback);
        const rsiSwingHighs = findSwingHighs(recentRSI, config.swingLookback);

        if (priceSwingLows.length >= 2 && rsiSwingLows.length >= 2) {
            const [priceLow1, priceLow2] = priceSwingLows.slice(-2);
            const [rsiLow1, rsiLow2] = rsiSwingLows.slice(-2);
            const priceDistance = priceLow2.index - priceLow1.index;
            const rsiDistance = rsiLow2.index - rsiLow1.index;

            if (priceDistance <= config.window && priceDistance >= config.minSwingDistance &&
                rsiDistance <= config.window && rsiDistance >= config.minSwingDistance) {
                if (priceLow2.value < priceLow1.value && rsiLow2.value > rsiLow1.value &&
                    rsiLow2.value < config.os) {
                    return 'bullish';
                }
            }
        }

        if (priceSwingHighs.length >= 2 && rsiSwingHighs.length >= 2) {
            const [priceHigh1, priceHigh2] = priceSwingHighs.slice(-2);
            const [rsiHigh1, rsiHigh2] = rsiSwingHighs.slice(-2);
            const priceDistance = priceHigh2.index - priceHigh1.index;
            const rsiDistance = rsiHigh2.index - rsiHigh1.index;

            if (priceDistance <= config.window && priceDistance >= config.minSwingDistance &&
                rsiDistance <= config.window && rsiDistance >= config.minSwingDistance) {
                if (priceHigh2.value > priceHigh1.value && rsiHigh2.value < rsiHigh1.value &&
                    rsiHigh2.value > config.ob) {
                    return 'bearish';
                }
            }
        }

        return null;
    }

    function candleOpen(interval, nowMs) {
        if (interval === '1M') {
            const d = new Date(nowMs);
            return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
        }
        if (interval === '1w') {
            const d = new Date(nowMs);
            const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
            const daysSinceMonday = (d.getUTCDay() + 6) % 7;
            return dayStart - daysSinceMonday * DAY_MS;
        }
        const ms = INTERVAL_MS[interval];
        if (!ms) throw new Error(`Unknown interval: ${interval}`);
        return Math.floor(nowMs / ms) * ms;
    }

    function lastClosedOpen(interval, nowMs) {
        const open = candleOpen(interval, nowMs);
        if (interval === '1M') {
            const d = new Date(open);
            return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1);
        }
        if (interval === '1w') return open - WEEK_MS;
        return open - INTERVAL_MS[interval];
    }

    function analysisCandles(candles, interval, nowMs) {
        if (!candles || candles.length === 0) return candles;
        const forming = candleOpen(interval, nowMs);
        if (candles[candles.length - 1].openTime === forming) return candles.slice(0, -1);
        return candles;
    }

    function isLeveragedToken(baseAsset, listedBases) {
        for (const suffix of LEVERAGE_SUFFIXES) {
            if (!baseAsset.endsWith(suffix) || baseAsset.length === suffix.length) continue;
            const root = baseAsset.slice(0, -suffix.length);
            if (listedBases.has(root)) return true;
        }
        return false;
    }

    function selectPairs(symbols, volumeBySymbol, options) {
        const trading = symbols.filter(s => s.quoteAsset === 'USDT' && s.status === 'TRADING');
        const listedBases = new Set(trading.map(s => s.baseAsset));
        const pairs = [];
        for (const s of trading) {
            if (isLeveragedToken(s.baseAsset, listedBases)) continue;
            const starred = options.starred && options.starred.has(s.symbol);
            const volume = volumeBySymbol.get(s.symbol) ?? 0;
            if (!options.showAll && !starred && volume < options.minQuoteVolume) continue;
            pairs.push({ symbol: s.symbol, baseAsset: s.baseAsset });
        }
        return pairs;
    }

    function stackedExtreme(rsi4h, rsi1d, os = 30, ob = 70) {
        if (typeof rsi4h !== 'number' || typeof rsi1d !== 'number') return null;
        if (rsi4h <= os && rsi1d <= os) return 'oversold';
        if (rsi4h >= ob && rsi1d >= ob) return 'overbought';
        return null;
    }

    return {
        INTERVAL_MS,
        calculateRSI,
        detectDivergence,
        isLeveragedToken,
        selectPairs,
        candleOpen,
        lastClosedOpen,
        analysisCandles,
        stackedExtreme,
    };
});
