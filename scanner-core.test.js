const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('./scanner-core.js');

test('RSI is null until there are period+1 closes', () => {
    const { value, series } = core.calculateRSI([1, 2, 3, 4], 14);
    assert.equal(value, null);
    assert.deepEqual(series, []);
});

test('a strictly rising series has RSI 100', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    const { value } = core.calculateRSI(closes, 14);
    assert.equal(value, 100);
});

test('35 bars and 100 bars disagree when the older trend differs', () => {
    const closes = [];
    for (let i = 0; i < 40; i++) closes.push(300 - i * 4);
    for (let i = 0; i < 60; i++) closes.push(closes.at(-1) + (i % 5 === 0 ? 0.3 : -0.1));
    const short = core.calculateRSI(closes.slice(-35), 14).value;
    const full = core.calculateRSI(closes.slice(-100), 14).value;
    assert.ok(Math.abs(short - full) > 5);
});

test('3-day, 4h, 12h, and 1d candles align to the UTC epoch', () => {
    const now = Date.UTC(2024, 0, 3, 15, 30, 0);
    assert.equal(core.candleOpen('4h', now), Date.UTC(2024, 0, 3, 12, 0, 0));
    assert.equal(core.lastClosedOpen('4h', now), Date.UTC(2024, 0, 3, 8, 0, 0));
    assert.equal(core.candleOpen('12h', now), Date.UTC(2024, 0, 3, 12, 0, 0));
    assert.equal(core.lastClosedOpen('12h', now), Date.UTC(2024, 0, 3, 0, 0, 0));
    assert.equal(core.candleOpen('1d', now), Date.UTC(2024, 0, 3));
    assert.equal(core.lastClosedOpen('1d', now), Date.UTC(2024, 0, 2));
    assert.equal(core.candleOpen('3d', now) % (3 * 86400000), 0);
    assert.equal(core.lastClosedOpen('3d', now), core.candleOpen('3d', now) - 3 * 86400000);
});

test('weekly candles open Monday 00:00 UTC and monthly candles open on the 1st', () => {
    const wed = Date.UTC(2024, 0, 3, 15, 0, 0);
    assert.equal(core.candleOpen('1w', wed), Date.UTC(2024, 0, 1));
    assert.equal(core.lastClosedOpen('1w', wed), Date.UTC(2023, 11, 25));
    const mid = Date.UTC(2024, 2, 18, 8, 0, 0);
    assert.equal(core.candleOpen('1M', mid), Date.UTC(2024, 2, 1));
    assert.equal(core.lastClosedOpen('1M', mid), Date.UTC(2024, 1, 1));
});

test('the forming candle is dropped and a just-closed candle is kept', () => {
    const now = Date.UTC(2024, 0, 3, 15, 0, 0);
    const candles = [
        { openTime: Date.UTC(2024, 0, 3, 8) },
        { openTime: Date.UTC(2024, 0, 3, 12) },
    ];
    const closed = core.analysisCandles(candles, '4h', now);
    assert.equal(closed.length, 1);
    assert.equal(closed[0].openTime, Date.UTC(2024, 0, 3, 8));

    const atClose = Date.UTC(2024, 0, 3, 16, 0, 0);
    const kept = core.analysisCandles(candles, '4h', atClose);
    assert.equal(kept.length, 2);
});

test('leverage suffix is removed only when the root is itself listed', () => {
    const listed = new Set(['BTC', '1INCH', 'JUP', 'SUPER', 'SYRUP']);
    assert.equal(core.isLeveragedToken('BTCUP', listed), true);
    assert.equal(core.isLeveragedToken('1INCHDOWN', listed), true);
    assert.equal(core.isLeveragedToken('ETHBULL', listed), false);
    assert.equal(core.isLeveragedToken('JUP', listed), false);
    assert.equal(core.isLeveragedToken('SYRUP', listed), false);
    assert.equal(core.isLeveragedToken('SUPER', listed), false);
});

test('selectPairs keeps liquid USDT markets, starred thin markets, and JUP', () => {
    const symbols = [
        { symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', status: 'TRADING' },
        { symbol: 'JUPUSDT', baseAsset: 'JUP', quoteAsset: 'USDT', status: 'TRADING' },
        { symbol: 'SUPERUSDT', baseAsset: 'SUPER', quoteAsset: 'USDT', status: 'TRADING' },
        { symbol: 'SYRUPUSDT', baseAsset: 'SYRUP', quoteAsset: 'USDT', status: 'TRADING' },
        { symbol: 'BTCUPUSDT', baseAsset: 'BTCUP', quoteAsset: 'USDT', status: 'TRADING' },
        { symbol: 'THINUSDT', baseAsset: 'THIN', quoteAsset: 'USDT', status: 'TRADING' },
        { symbol: 'BTCUSDC', baseAsset: 'BTC', quoteAsset: 'USDC', status: 'TRADING' },
        { symbol: 'OLDUSDT', baseAsset: 'OLD', quoteAsset: 'USDT', status: 'BREAK' },
    ];
    const volume = new Map([
        ['BTCUSDT', 2_000_000_000],
        ['JUPUSDT', 50_000_000],
        ['SUPERUSDT', 2_000_000],
        ['SYRUPUSDT', 500_000],
        ['BTCUPUSDT', 10_000_000],
        ['THINUSDT', 10_000],
    ]);
    const starred = new Set(['THINUSDT']);
    const picked = core.selectPairs(symbols, volume, {
        minQuoteVolume: 1_000_000,
        showAll: false,
        starred,
    }).map(p => p.symbol);
    assert.deepEqual(picked.sort(), ['BTCUSDT', 'JUPUSDT', 'SUPERUSDT', 'THINUSDT']);

    const all = core.selectPairs(symbols, volume, {
        minQuoteVolume: 1_000_000,
        showAll: true,
        starred,
    }).map(p => p.symbol);
    assert.ok(all.includes('SYRUPUSDT'));
    assert.ok(all.includes('THINUSDT'));
    assert.equal(all.includes('BTCUPUSDT'), false);
    assert.equal(all.includes('BTCUSDC'), false);
    assert.equal(all.includes('OLDUSDT'), false);
});

test('missing volume does not count as liquid', () => {
    const symbols = [
        { symbol: 'ABCUSDT', baseAsset: 'ABC', quoteAsset: 'USDT', status: 'TRADING' },
    ];
    const picked = core.selectPairs(symbols, new Map(), {
        minQuoteVolume: 1_000_000,
        showAll: false,
        starred: new Set(),
    });
    assert.deepEqual(picked, []);
});

function swingCandles(closes) {
    return closes.map(close => ({ open: close, high: close, low: close, close }));
}

test('bullish divergence is a lower price low and a higher RSI low in oversold', () => {
    const price = [5, 4, 3, 4, 5, 3, 1, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4];
    const rsiBull = [40, 35, 20, 35, 40, 30, 25, 30, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32];
    const priceHidden = [5, 4, 1, 4, 5, 3, 2, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4];
    const rsiHidden = [40, 35, 22, 35, 40, 30, 18, 30, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32];
    const config = { window: 14, buffer: 4, swingLookback: 2, minSwingDistance: 3, os: 30, ob: 70 };
    assert.equal(core.detectDivergence(swingCandles(price), rsiBull, config), 'bullish');
    assert.equal(core.detectDivergence(swingCandles(priceHidden), rsiHidden, config), null);
});

test('bearish divergence is a higher price high and a lower RSI high in overbought', () => {
    const price = [1, 2, 4, 2, 1, 3, 6, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    const rsi = [60, 65, 80, 65, 60, 70, 75, 70, 68, 68, 68, 68, 68, 68, 68, 68, 68, 68];
    const config = { window: 14, buffer: 4, swingLookback: 2, minSwingDistance: 3, os: 30, ob: 70 };
    assert.equal(core.detectDivergence(swingCandles(price), rsi, config), 'bearish');
});

test('stacked extremes require both 4h and 1d', () => {
    assert.equal(core.stackedExtreme(28, 25), 'oversold');
    assert.equal(core.stackedExtreme(28, 40), null);
    assert.equal(core.stackedExtreme(75, 80), 'overbought');
    assert.equal(core.stackedExtreme(75, 60), null);
    assert.equal(core.stackedExtreme(null, 20), null);
});
