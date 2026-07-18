import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateRSI, calculateRSIValue } from '../js/shared/rsi.js';

describe('calculateRSI', () => {
    it('returns null for series shorter than period+1', () => {
        const closes = Array.from({ length: 14 }, (_, i) => 100 + i);
        const r = calculateRSI(closes, 14);
        assert.equal(r.value, null);
        assert.deepEqual(r.series, []);
    });

    it('returns 100 when price only rises (no losses)', () => {
        const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
        const r = calculateRSI(closes, 14);
        assert.equal(r.value, 100);
        assert.ok(r.series.length > 0);
        assert.ok(r.series.every(v => v === 100));
    });

    it('returns 0 when price only falls (no gains)', () => {
        const closes = Array.from({ length: 30 }, (_, i) => 200 - i);
        const r = calculateRSI(closes, 14);
        assert.equal(r.value, 0);
    });

    it('returns mid-range RSI for oscillating prices', () => {
        // Alternating up/down around a flat trend
        const closes = [];
        for (let i = 0; i < 40; i++) {
            closes.push(100 + (i % 2 === 0 ? 1 : -1));
        }
        const r = calculateRSI(closes, 14);
        assert.ok(r.value !== null);
        assert.ok(r.value > 20 && r.value < 80);
    });

    it('calculateRSIValue matches calculateRSI().value', () => {
        const closes = [44, 44.34, 44.09, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64];
        assert.equal(calculateRSIValue(closes, 14), calculateRSI(closes, 14).value);
    });
});
