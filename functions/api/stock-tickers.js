// Cloudflare Pages Function: GET /api/stock-tickers
// Discovers which US stocks are tradable on Backpack Exchange (rwaMarketType
// "STOCK") and maps them to Yahoo Finance tickers (SPCX.US -> SPCX), so the
// stocks scanner auto-picks-up new listings. Falls back to a static list if
// Backpack is unreachable. Cached at the edge for an hour.

const BACKPACK_MARKETS_URL = 'https://api.backpack.exchange/api/v1/markets';
const CACHE_TTL_S = 3600;
const FETCH_TIMEOUT_MS = 10000;

// Known Backpack stock listings as of 2026-07 — used only if the live lookup fails
const FALLBACK_TICKERS = [
    { ticker: 'SPCX', backpackSymbol: 'SPCX.US_USDC' },
    { ticker: 'MU',   backpackSymbol: 'MU.US_USDC' },
    { ticker: 'SNDK', backpackSymbol: 'SNDK.US_USDC' },
];

export async function onRequestGet() {
    const cache = caches.default;
    const cacheKey = new Request('https://edge-cache.internal/api/stock-tickers');

    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    let tickers = FALLBACK_TICKERS;
    let source = 'fallback';

    try {
        const r = await fetch(BACKPACK_MARKETS_URL, {
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (r.ok) {
            const markets = await r.json();
            const stocks = markets.filter(m =>
                m.rwaMarketType === 'STOCK' &&
                m.orderBookState === 'Open' &&
                m.visible !== false
            );
            if (stocks.length > 0) {
                tickers = stocks.map(m => ({
                    // Backpack base symbols look like "SPCX.US"; Yahoo wants "SPCX"
                    ticker: m.baseSymbol.replace(/\.US$/, ''),
                    backpackSymbol: m.symbol,
                }));
                source = 'backpack';
            }
        }
    } catch (e) {
        // fall through to fallback list
    }

    const response = new Response(JSON.stringify({ source, tickers }), {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `public, s-maxage=${CACHE_TTL_S}, stale-while-revalidate=${CACHE_TTL_S * 2}`,
        },
    });

    if (source === 'backpack') {
        await cache.put(cacheKey, response.clone());
    }
    return response;
}
