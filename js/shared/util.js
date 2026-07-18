import { DEFAULT_CONFIG } from './config.js';

export function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function debounce(fn, delay) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

export function formatRSI(value) {
    return value !== null && value !== undefined ? Number(value).toFixed(1) : '—';
}

export function getRSIClass(value, config = DEFAULT_CONFIG) {
    if (value === null || value === undefined) return 'neutral';
    if (value > config.STRONG_THRESHOLD) return 'strong';
    if (value > config.BULLISH_THRESHOLD) return 'bullish';
    if (value < config.BULLISH_THRESHOLD - 10) return 'bearish';
    return 'neutral';
}

export function getRSIIndicator(value, config = DEFAULT_CONFIG) {
    if (value === null || value === undefined) return '';
    if (value >= config.OB_THRESHOLD) {
        return '<span class="rsi-indicator overbought">OB</span>';
    }
    if (value <= config.OS_THRESHOLD) {
        return '<span class="rsi-indicator oversold">OS</span>';
    }
    return '';
}

export function getDivergenceIndicator(divergence) {
    if (!divergence) return '';
    if (divergence === 'bullish') {
        return '<span class="rsi-indicator div-bullish" title="Bullish Divergence: Price higher low + RSI lower low (OS zone)">DIV↑</span>';
    }
    if (divergence === 'bearish') {
        return '<span class="rsi-indicator div-bearish" title="Bearish Divergence: Price higher high + RSI lower high (OB zone)">DIV↓</span>';
    }
    return '';
}

export function getStatusBadge(status, incomplete = false) {
    const badges = {
        strong: '<span class="status-badge strong"><span class="status-icon">🔥</span> Strong</span>',
        bullish: '<span class="status-badge bullish"><span class="status-icon">✅</span> Bullish</span>',
        mixed: '<span class="status-badge mixed"><span class="status-icon">⚠️</span> Mixed</span>',
        bearish: '<span class="status-badge bearish"><span class="status-icon">❌</span> Bearish</span>',
        unknown: '<span class="status-badge mixed"><span class="status-icon">?</span> Unknown</span>',
    };
    let html = badges[status] || badges.unknown;
    if (incomplete) {
        html += ' <span class="rsi-indicator incomplete" title="One or more timeframes missing — excluded from Strong/Bullish/Bearish">INC</span>';
    }
    return html;
}

export function hasAnyDivergence(item, timeframeKeys) {
    return timeframeKeys.some(tf => item[`div${tf}`]);
}

export function roundRsi(value) {
    if (value === null || value === undefined) return null;
    return Math.round(value * 10) / 10;
}
