// Cloudflare Pages Function: GET /api/stock-klines?symbol=MU&interval=1d
// Proxy for Yahoo Finance chart data. The browser can't call Yahoo directly
// (no CORS headers), so this fetches server-side, normalizes the response to
// the scanner's candle shape, and caches at the edge to stay clear of Yahoo
// rate limits.

const INTERVALS = {
    '1h': { yahoo: '60m', range: '1mo',  ttl: 120 },
    '1d': { yahoo: '1d',  range: '6mo',  ttl: 300 },
    '1w': { yahoo: '1wk', range: '2y',   ttl: 3600 },
    '1M': { yahoo: '1mo', range: '10y',  ttl: 3600 },
};

const FETCH_TIMEOUT_MS = 10000;

export async function onRequestGet({ request }) {
    const url = new URL(request.url);
    const symbol = (url.searchParams.get('symbol') || '').toUpperCase();
    const interval = url.searchParams.get('interval') || '';

    if (!/^[A-Z0-9.\-]{1,12}$/.test(symbol) || !INTERVALS[interval]) {
        return json({ error: 'invalid symbol or interval' }, 400);
    }

    const cfg = INTERVALS[interval];
    const cache = caches.default;
    const cacheKey = new Request(
        `https://edge-cache.internal/api/stock-klines?symbol=${symbol}&interval=${interval}`
    );

    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    let data;
    try {
        const yahooUrl =
            `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
            `?interval=${cfg.yahoo}&range=${cfg.range}`;
        const r = await fetch(yahooUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0' },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!r.ok) return json({ error: `upstream ${r.status}` }, 502);
        data = await r.json();
    } catch (e) {
        return json({ error: 'upstream fetch failed' }, 502);
    }

    const result = data?.chart?.result?.[0];
    if (!result) {
        return json({ error: data?.chart?.error?.description || 'no data' }, 502);
    }

    // Yahoo occasionally emits null slots in the OHLC arrays — skip those
    const ts = result.timestamp || [];
    const q = result.indicators?.quote?.[0] || {};
    const candles = [];
    for (let i = 0; i < ts.length; i++) {
        const open = q.open?.[i];
        const high = q.high?.[i];
        const low = q.low?.[i];
        const close = q.close?.[i];
        if (open == null || high == null || low == null || close == null) continue;
        candles.push({ time: ts[i], open, high, low, close });
    }

    const response = json({ symbol, interval, candles }, 200, cfg.ttl);
    await cache.put(cacheKey, response.clone());
    return response;
}

function json(body, status = 200, ttl = 0) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': ttl
                ? `public, s-maxage=${ttl}, stale-while-revalidate=${ttl * 2}`
                : 'no-store',
        },
    });
}
