/** Shared tunable constants for RSI scanning (UI + CI). */

export const DEFAULT_CONFIG = {
    RSI_PERIOD: 14,
    KLINES_LIMIT: 35,
    BATCH_SIZE: 10,
    MAX_CONCURRENT_BATCHES: 3,
    BATCH_DELAY_MS: 100,
    FETCH_TIMEOUT_MS: 15000,
    /** Client re-fetch interval for precomputed crypto snapshot or live stocks scan */
    REFRESH_INTERVAL_S: 300,
    CACHE_TTL_MS: 10 * 60 * 1000,
    MAX_CACHE_ENTRIES: 2500,
    SEARCH_DEBOUNCE_MS: 200,
    OB_THRESHOLD: 70,
    OS_THRESHOLD: 30,
    STRONG_THRESHOLD: 60,
    BULLISH_THRESHOLD: 50,
    DIVERGENCE_WINDOW: 14,
    DIVERGENCE_BUFFER: 4,
    SWING_LOOKBACK: 2,
    MIN_SWING_DISTANCE: 3,
};

/** Crypto multi-timeframe set (Binance intervals). */
export const CRYPTO_TIMEFRAMES = ['4h', '12h', '1d', '3d', '1w', '1M'];

/** Stocks multi-timeframe set (app → Yahoo via proxy). */
export const STOCK_TIMEFRAMES = ['1h', '1d', '1w', '1M'];

/** Geo-safe Binance market-data host (used by CI; preferred for server-side). */
export const BINANCE_VISION_BASE = 'https://data-api.binance.vision/api/v3';

/** Public Binance API (browser CORS-friendly). */
export const BINANCE_API_BASE = 'https://api.binance.com/api/v3';
