/**
 * Shared scanner UI controller used by crypto (precomputed) and stocks (live).
 */

import { DEFAULT_CONFIG } from './config.js';
import {
    debounce,
    escapeHtml,
    formatRSI,
    getDivergenceIndicator,
    getRSIClass,
    getRSIIndicator,
    getStatusBadge,
    hasAnyDivergence,
} from './util.js';

/**
 * @typedef {object} ScannerOptions
 * @property {'crypto'|'stocks'} market
 * @property {string[]} timeframeKeys e.g. ['4h','12h',...]
 * @property {string} starStorageKey localStorage key for watchlist
 * @property {(item: object) => string} chartUrl
 * @property {(item: object) => string} pairLabel
 * @property {(item: object) => string} nameLabel
 * @property {() => Promise<{ rows: object[], meta?: object }>} loadData
 * @property {Partial<typeof DEFAULT_CONFIG>} [config]
 * @property {string} [loadingMessage]
 * @property {number} [refreshIntervalS]
 */

export function createScannerApp(options) {
    const config = { ...DEFAULT_CONFIG, ...options.config };
    const timeframeKeys = options.timeframeKeys;
    const refreshIntervalS = options.refreshIntervalS ?? config.REFRESH_INTERVAL_S;

    let allData = [];
    let filteredData = [];
    let currentFilter = 'all';
    let currentSort = { column: 'status', direction: 'desc' };
    let countdownInterval = null;
    let scanning = false;
    let secondsUntilRefresh = refreshIntervalS;
    let jsonStatusFilter = null;
    let lastMeta = {};

    const THEME_KEY = 'rsi-scanner-theme';
    const starredTokens = new Set(
        JSON.parse(localStorage.getItem(options.starStorageKey) || '[]')
    );

    function initTheme() {
        const savedTheme = localStorage.getItem(THEME_KEY);
        if (savedTheme) {
            document.documentElement.setAttribute('data-theme', savedTheme);
        }
    }

    function toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        if (newTheme === 'dark') {
            document.documentElement.removeAttribute('data-theme');
        } else {
            document.documentElement.setAttribute('data-theme', newTheme);
        }
        localStorage.setItem(THEME_KEY, newTheme);
    }

    function saveStarred() {
        localStorage.setItem(options.starStorageKey, JSON.stringify([...starredTokens]));
    }

    function toggleStar(symbol, event) {
        if (event) event.stopPropagation();
        if (starredTokens.has(symbol)) starredTokens.delete(symbol);
        else starredTokens.add(symbol);
        saveStarred();
        applyFilterAndSort();
    }

    function setScanState(state) {
        document.body.setAttribute('data-scan-state', state);
    }

    function updateProgress(current, total, message) {
        const percent = total > 0 ? Math.round((current / total) * 100) : 0;
        const progressEl = document.getElementById('loadingProgress');
        const fillEl = document.getElementById('progressFill');
        if (progressEl) progressEl.textContent = message;
        if (fillEl) fillEl.style.width = `${percent}%`;
        document.body.setAttribute('data-scan-progress', `${current}/${total}`);
        document.body.setAttribute('data-scan-progress-message', message);
        if (document.body.getAttribute('data-view') === 'json') {
            const status = document.getElementById('json-view-status');
            if (status) status.textContent = `state=loading • ${percent}% • ${message}`;
        }
    }

    function updateScanHealth(meta = {}) {
        lastMeta = meta;
        const el = document.getElementById('scanHealth');
        if (!el) return;
        const parts = [];
        if (meta.source) parts.push(meta.source);
        if (typeof meta.processed === 'number') {
            parts.push(`${meta.processed} scanned`);
        }
        if (typeof meta.failed === 'number' && meta.failed > 0) {
            parts.push(`${meta.failed} failed`);
        }
        if (typeof meta.incomplete === 'number' && meta.incomplete > 0) {
            parts.push(`${meta.incomplete} incomplete`);
        }
        el.textContent = parts.length ? parts.join(' · ') : '—';
        el.title = meta.last_updated
            ? `Source data last_updated: ${meta.last_updated}`
            : '';
    }

    function updateStats() {
        const stats = {
            total: allData.length,
            strong: allData.filter(d => d.status === 'strong').length,
            bullish: allData.filter(d => d.status === 'bullish').length,
            mixed: allData.filter(d => d.status === 'mixed').length,
            bearish: allData.filter(d => d.status === 'bearish').length,
        };
        const set = (id, v) => {
            const el = document.getElementById(id);
            if (el) el.textContent = v;
        };
        set('statTotal', stats.total);
        set('statStrong', stats.strong);
        set('statBullish', stats.bullish);
        set('statMixed', stats.mixed);
        set('statBearish', stats.bearish);
        return stats;
    }

    function buildScannerPayload(state, errorMessage) {
        const ts = lastMeta.last_updated || new Date().toISOString();
        const sourceData = jsonStatusFilter
            ? allData.filter(d => jsonStatusFilter.has(d.status))
            : allData;

        const tokens = sourceData.map(d => {
            const rsi = {};
            const divergences = {};
            for (const tf of timeframeKeys) {
                rsi[tf] = d[`rsi${tf}`] ?? null;
                divergences[tf] = d[`div${tf}`] ?? null;
            }
            return {
                symbol: d.symbol,
                base_asset: d.baseAsset,
                pair: options.pairLabel(d),
                status: d.status,
                incomplete: !!d.incomplete,
                rsi,
                divergences,
            };
        });

        const byStatus = s =>
            allData
                .filter(d => d.status === s)
                .map(d => ({ symbol: d.baseAsset, pair: options.pairLabel(d) }));

        return {
            version: 1,
            market: options.market,
            state,
            last_updated: state === 'ready' || state === 'empty' ? ts : null,
            error: errorMessage || null,
            filter: jsonStatusFilter ? Array.from(jsonStatusFilter).sort() : 'all',
            source: lastMeta.source || null,
            health: {
                processed: lastMeta.processed ?? allData.length,
                failed: lastMeta.failed ?? 0,
                incomplete: allData.filter(d => d.incomplete).length,
            },
            counts: {
                total: allData.length,
                strong: allData.filter(d => d.status === 'strong').length,
                bullish: allData.filter(d => d.status === 'bullish').length,
                mixed: allData.filter(d => d.status === 'mixed').length,
                bearish: allData.filter(d => d.status === 'bearish').length,
            },
            categories: {
                strong: byStatus('strong'),
                bullish: byStatus('bullish'),
                mixed: byStatus('mixed'),
                bearish: byStatus('bearish'),
            },
            tokens,
        };
    }

    function publishScannerData(state, errorMessage) {
        const payload = buildScannerPayload(state, errorMessage);
        const json = JSON.stringify(payload);
        const blob = document.getElementById('scanner-data');
        if (blob) blob.textContent = json;
        setScanState(state);
        if (payload.last_updated) {
            document.body.setAttribute('data-last-updated', payload.last_updated);
            const d = new Date(payload.last_updated);
            const lu = document.getElementById('last-updated');
            if (lu) {
                lu.textContent = d.toLocaleTimeString([], { hour12: false });
                lu.setAttribute('title', payload.last_updated);
            }
            const headerLu = document.getElementById('lastUpdated');
            if (headerLu) {
                headerLu.textContent = d.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                });
            }
        }
        if (document.body.getAttribute('data-view') === 'json') {
            const out = document.getElementById('json-view');
            if (out) out.textContent = JSON.stringify(payload, null, 2);
            const status = document.getElementById('json-view-status');
            if (status) {
                status.textContent = `state=${state} • last_updated=${payload.last_updated || '—'} • total=${payload.counts.total}`;
            }
        }
    }

    async function copyScannerJSON() {
        const blob = document.getElementById('scanner-data');
        const btn = document.getElementById('copyJsonBtn');
        if (!blob || !btn) return;
        try {
            await navigator.clipboard.writeText(blob.textContent);
            const orig = btn.textContent;
            btn.classList.add('copied');
            btn.textContent = '✓ Copied';
            setTimeout(() => {
                btn.classList.remove('copied');
                btn.textContent = orig;
            }, 1200);
        } catch (e) {
            console.error('Copy failed:', e);
        }
    }

    function applyFilterAndSort() {
        const searchInput = document.getElementById('searchInput');
        const searchTerm = (searchInput?.value || '').toLowerCase();

        filteredData = allData.filter(item => {
            const matchesSearch =
                item.symbol.toLowerCase().includes(searchTerm) ||
                (item.baseAsset || '').toLowerCase().includes(searchTerm);
            let matchesFilter;
            if (currentFilter === 'all') matchesFilter = true;
            else if (currentFilter === 'starred') matchesFilter = starredTokens.has(item.symbol);
            else if (currentFilter === 'divergence') {
                matchesFilter = hasAnyDivergence(item, timeframeKeys);
            } else if (currentFilter === 'incomplete') {
                matchesFilter = !!item.incomplete;
            } else {
                matchesFilter = item.status === currentFilter;
            }
            return matchesSearch && matchesFilter;
        });

        filteredData.sort((a, b) => {
            const aStarred = starredTokens.has(a.symbol) ? 1 : 0;
            const bStarred = starredTokens.has(b.symbol) ? 1 : 0;
            if (aStarred !== bStarred) return bStarred - aStarred;

            let aVal;
            let bVal;
            const col = currentSort.column;

            if (col === 'symbol') {
                aVal = a.symbol;
                bVal = b.symbol;
            } else if (col === 'status') {
                aVal = a.priority;
                bVal = b.priority;
            } else if (col.startsWith('rsi')) {
                const field = col; // rsi4h etc.
                aVal = a[field] ?? -1;
                bVal = b[field] ?? -1;
            } else {
                return 0;
            }

            if (typeof aVal === 'string') {
                return currentSort.direction === 'asc'
                    ? aVal.localeCompare(bVal)
                    : bVal.localeCompare(aVal);
            }
            return currentSort.direction === 'asc' ? aVal - bVal : bVal - aVal;
        });

        renderTable();
    }

    function renderRsiCell(value, div) {
        const width = value !== null && value !== undefined ? value : 0;
        return `<div class="rsi-cell">
            <span class="rsi-value">${formatRSI(value)}${getRSIIndicator(value, config)}${getDivergenceIndicator(div)}</span>
            <div class="rsi-bar">
                <div class="rsi-bar-fill ${getRSIClass(value, config)}" style="width: ${width}%"></div>
            </div>
        </div>`;
    }

    function renderTable() {
        const tbody = document.getElementById('tableBody');
        const dataTable = document.getElementById('dataTable');
        const emptyState = document.getElementById('emptyState');
        if (!tbody || !dataTable || !emptyState) return;

        if (filteredData.length === 0) {
            dataTable.classList.remove('active');
            emptyState.classList.add('active');
            return;
        }

        emptyState.classList.remove('active');
        dataTable.classList.add('active');

        tbody.innerHTML = filteredData
            .map(item => {
                const symbol = escapeHtml(item.symbol);
                const base = escapeHtml(item.baseAsset);
                const pair = escapeHtml(options.pairLabel(item));
                const name = escapeHtml(options.nameLabel(item));
                const chart = escapeHtml(options.chartUrl(item));
                const starred = starredTokens.has(item.symbol);

                const dataAttrs = [
                    `data-status="${escapeHtml(item.status)}"`,
                    `data-symbol="${symbol}"`,
                    `data-base-asset="${base}"`,
                    `data-incomplete="${item.incomplete ? '1' : '0'}"`,
                ];
                for (const tf of timeframeKeys) {
                    const rsi = item[`rsi${tf}`];
                    const div = item[`div${tf}`];
                    dataAttrs.push(
                        `data-rsi-${tf.toLowerCase()}="${rsi ?? ''}"`,
                        `data-div-${tf.toLowerCase()}="${div ?? ''}"`
                    );
                }

                const rsiCells = timeframeKeys
                    .map(tf => {
                        const td = renderRsiCell(item[`rsi${tf}`], item[`div${tf}`]);
                        return `<td>${td}</td>`;
                    })
                    .join('');

                return `<tr ${dataAttrs.join(' ')}>
                    <td>
                        <button class="star-btn ${starred ? 'starred' : ''}"
                                data-symbol="${symbol}"
                                title="${starred ? 'Remove from watchlist' : 'Add to watchlist'}">
                            ⭐
                        </button>
                    </td>
                    <td>
                        <div class="token-cell">
                            <div>
                                <a href="${chart}" target="_blank" rel="noopener noreferrer"
                                   class="token-link" title="Open ${name} chart on TradingView">
                                    <span class="token-name">${name}</span>
                                    <span class="chart-icon">📈</span>
                                </a>
                                <div class="token-pair">${pair}</div>
                            </div>
                        </div>
                    </td>
                    ${rsiCells}
                    <td>${getStatusBadge(item.status, item.incomplete)}</td>
                </tr>`;
            })
            .join('');

        document.querySelectorAll('.data-table th').forEach(th => {
            th.classList.remove('sorted');
            const icon = th.querySelector('.sort-icon');
            if (!icon) return;
            if (th.dataset.sort === currentSort.column) {
                th.classList.add('sorted');
                icon.textContent = currentSort.direction === 'asc' ? '↑' : '↓';
            } else {
                icon.textContent = '↕';
            }
        });
    }

    function sortTable(column) {
        if (currentSort.column === column) {
            currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
        } else {
            currentSort.column = column;
            currentSort.direction = 'desc';
        }
        applyFilterAndSort();
    }

    function setFilter(filter) {
        currentFilter = filter;
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === filter);
        });
        applyFilterAndSort();
    }

    const filterTable = debounce(() => applyFilterAndSort(), config.SEARCH_DEBOUNCE_MS);

    function updateCountdown() {
        const el = document.getElementById('countdown');
        if (!el) return;
        const minutes = Math.floor(secondsUntilRefresh / 60);
        const seconds = secondsUntilRefresh % 60;
        el.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    function startCountdown() {
        if (countdownInterval) clearInterval(countdownInterval);
        countdownInterval = setInterval(() => {
            secondsUntilRefresh--;
            updateCountdown();
            if (secondsUntilRefresh <= 0) startScan();
        }, 1000);
    }

    function toggleHelp() {
        document.getElementById('helpModal')?.classList.toggle('active');
    }

    function closeHelp(event) {
        if (event.target.id === 'helpModal') {
            document.getElementById('helpModal')?.classList.remove('active');
        }
    }

    async function startScan() {
        if (scanning) return;
        scanning = true;

        const refreshBtn = document.getElementById('refreshBtn');
        const loadingOverlay = document.getElementById('loadingOverlay');
        const dataTable = document.getElementById('dataTable');
        const emptyState = document.getElementById('emptyState');

        if (refreshBtn) refreshBtn.disabled = true;
        loadingOverlay?.classList.add('active');
        dataTable?.classList.remove('active');
        emptyState?.classList.remove('active');
        setScanState('loading');

        if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }
        const countdownEl = document.getElementById('countdown');
        if (countdownEl) countdownEl.textContent = '—:——';

        try {
            updateProgress(0, 100, options.loadingMessage || 'Loading scan data...');

            const result = await options.loadData({
                updateProgress,
                config,
            });

            allData = result.rows || [];
            const incompleteCount = allData.filter(r => r.incomplete).length;
            updateScanHealth({
                ...result.meta,
                incomplete: incompleteCount,
            });

            updateStats();
            applyFilterAndSort();
            publishScannerData(allData.length > 0 ? 'ready' : 'empty');

            loadingOverlay?.classList.remove('active');
            if (filteredData.length > 0) dataTable?.classList.add('active');
            else {
                if (emptyState) {
                    emptyState.textContent =
                        allData.length === 0
                            ? 'No scan data available.'
                            : 'No tokens match your filters.';
                }
                emptyState?.classList.add('active');
            }
        } catch (error) {
            console.error('Scan failed:', error);
            loadingOverlay?.classList.remove('active');
            if (allData.length > 0) {
                updateStats();
                applyFilterAndSort();
                publishScannerData('ready', error.message);
                dataTable?.classList.add('active');
            } else {
                if (emptyState) {
                    emptyState.textContent = `Scan failed: ${error.message}`;
                    emptyState.classList.add('active');
                }
                publishScannerData('error', error.message);
            }
        } finally {
            scanning = false;
            secondsUntilRefresh = refreshIntervalS;
            updateCountdown();
            startCountdown();
            if (refreshBtn) refreshBtn.disabled = false;
        }
    }

    function bindDom() {
        document.getElementById('refreshBtn')?.addEventListener('click', () => startScan());
        document.getElementById('themeToggle')?.addEventListener('click', () => toggleTheme());
        document.getElementById('copyJsonBtn')?.addEventListener('click', () => copyScannerJSON());
        document.getElementById('searchInput')?.addEventListener('input', () => filterTable());
        document.getElementById('helpModal')?.addEventListener('click', closeHelp);
        document.getElementById('helpClose')?.addEventListener('click', () => toggleHelp());

        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => setFilter(btn.dataset.filter));
        });

        document.querySelectorAll('.data-table th[data-sort]').forEach(th => {
            th.addEventListener('click', () => sortTable(th.dataset.sort));
        });

        document.getElementById('tableBody')?.addEventListener('click', e => {
            const btn = e.target.closest('.star-btn');
            if (!btn) return;
            toggleStar(btn.dataset.symbol, e);
        });

        document.addEventListener('keydown', e => {
            const searchInput = document.getElementById('searchInput');
            const helpModal = document.getElementById('helpModal');
            const isTyping = document.activeElement === searchInput;
            const isHelpOpen = helpModal?.classList.contains('active');

            if (e.key === 'Escape') {
                if (isHelpOpen) helpModal.classList.remove('active');
                else if (searchInput) {
                    searchInput.value = '';
                    searchInput.blur();
                    setFilter('all');
                }
                return;
            }
            if (e.key === '?' && !isTyping) {
                toggleHelp();
                return;
            }
            if (isTyping || isHelpOpen) return;

            switch (e.key.toLowerCase()) {
                case 'r':
                    e.preventDefault();
                    startScan();
                    break;
                case '/':
                    e.preventDefault();
                    searchInput?.focus();
                    break;
                case 't':
                    toggleTheme();
                    break;
                case 'a':
                    setFilter('all');
                    break;
                case 's':
                    setFilter('starred');
                    break;
                case 'd':
                    setFilter('divergence');
                    break;
                case 'f':
                    setFilter('strong');
                    break;
                case 'b':
                    setFilter('bullish');
                    break;
                case 'm':
                    setFilter('mixed');
                    break;
                case 'x':
                    setFilter('bearish');
                    break;
                case 'i':
                    setFilter('incomplete');
                    break;
            }
        });
    }

    function init() {
        initTheme();
        bindDom();

        const params = new URLSearchParams(window.location.search);
        const isJsonView = params.get('view') === 'json';
        if (isJsonView) {
            document.body.setAttribute('data-view', 'json');
            const status = document.getElementById('json-view-status');
            if (status) status.textContent = 'state=loading • loading…';
            const out = document.getElementById('json-view');
            if (out) out.textContent = '';
        }

        const filterParam = params.get('filter');
        const VALID_STATUSES = ['strong', 'bullish', 'mixed', 'bearish'];
        if (filterParam) {
            if (filterParam.toLowerCase() === 'all') jsonStatusFilter = null;
            else {
                const requested = filterParam
                    .split(',')
                    .map(s => s.trim().toLowerCase())
                    .filter(s => VALID_STATUSES.includes(s));
                jsonStatusFilter = requested.length > 0 ? new Set(requested) : null;
            }
        } else if (isJsonView) {
            jsonStatusFilter = new Set(['strong', 'bullish']);
        }

        startScan();
    }

    // Public surface for debugging / optional inline hooks
    return {
        init,
        startScan,
        toggleTheme,
        setFilter,
        sortTable,
        toggleHelp,
        copyScannerJSON,
    };
}
