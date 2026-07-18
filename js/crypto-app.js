import { CRYPTO_TIMEFRAMES } from './shared/config.js';
import { createScannerApp } from './shared/scanner-app.js';
import {
    cryptoChartUrl,
    cryptoNameLabel,
    cryptoPairLabel,
    loadCryptoScan,
} from './markets/crypto.js';

const app = createScannerApp({
    market: 'crypto',
    timeframeKeys: CRYPTO_TIMEFRAMES,
    starStorageKey: 'rsi-scanner-starred',
    chartUrl: cryptoChartUrl,
    pairLabel: cryptoPairLabel,
    nameLabel: cryptoNameLabel,
    loadData: loadCryptoScan,
    loadingMessage: 'Loading precomputed Binance scan…',
    // Re-fetch snapshot every 5 minutes (CI updates every ~4h)
    refreshIntervalS: 300,
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => app.init());
} else {
    app.init();
}
