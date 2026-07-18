import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectDivergence, findSwingLows, findSwingHighs } from '../js/shared/divergence.js';
import { DEFAULT_CONFIG } from '../js/shared/config.js';

describe('swing detection', () => {
    it('finds swing lows', () => {
        // index 3 is a clear local min with lookback 2
        const values = [10, 9, 8, 5, 8, 9, 10, 7, 9, 11];
        const swings = findSwingLows(values, 2);
        assert.ok(swings.some(s => s.index === 3 && s.value === 5));
    });

    it('finds swing highs', () => {
        const values = [1, 2, 3, 8, 3, 2, 1, 4, 2, 0];
        const swings = findSwingHighs(values, 2);
        assert.ok(swings.some(s => s.index === 3 && s.value === 8));
    });
});

describe('detectDivergence', () => {
    it('returns null for insufficient data', () => {
        assert.equal(detectDivergence([], [], DEFAULT_CONFIG), null);
        assert.equal(
            detectDivergence(
                Array.from({ length: 5 }, (_, i) => ({ close: i })),
                [1, 2, 3],
                DEFAULT_CONFIG
            ),
            null
        );
    });

    it('returns null on a flat series without swings', () => {
        const candles = Array.from({ length: 30 }, () => ({
            open: 100,
            high: 100,
            low: 100,
            close: 100,
        }));
        const rsi = Array.from({ length: 30 }, () => 50);
        assert.equal(detectDivergence(candles, rsi, DEFAULT_CONFIG), null);
    });
});
