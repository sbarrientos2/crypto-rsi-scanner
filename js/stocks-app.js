import { STOCK_TIMEFRAMES } from './shared/config.js';
import { createScannerApp } from './shared/scanner-app.js';
import {
    loadStocksScan,
    stockChartUrl,
    stockNameLabel,
    stockPairLabel,
} from './markets/stocks.js';

const app = createScannerApp({
    market: 'stocks',
    timeframeKeys: STOCK_TIMEFRAMES,
    starStorageKey: 'stock-rsi-scanner-starred',
    chartUrl: stockChartUrl,
    pairLabel: stockPairLabel,
    nameLabel: stockNameLabel,
    loadData: loadStocksScan,
    loadingMessage: 'Scanning stock markets…',
    refreshIntervalS: 300,
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => app.init());
} else {
    app.init();
}
