import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getStatus } from '../js/shared/status.js';

describe('getStatus', () => {
    it('classifies strong only when ALL expected TFs > 60', () => {
        const r = getStatus([61, 70, 65, 80, 72, 66], { expectedCount: 6 });
        assert.equal(r.status, 'strong');
        assert.equal(r.priority, 4);
        assert.equal(r.incomplete, false);
    });

    it('does NOT classify strong when a TF is missing (incomplete)', () => {
        const r = getStatus([70, 75, 80, null, 72, 66], { expectedCount: 6 });
        assert.equal(r.status, 'mixed');
        assert.equal(r.incomplete, true);
        assert.equal(r.priority, 2);
    });

    it('classifies bullish when all complete TFs > 50 but not all > 60', () => {
        const r = getStatus([55, 58, 51, 52, 59, 53], { expectedCount: 6 });
        assert.equal(r.status, 'bullish');
        assert.equal(r.incomplete, false);
    });

    it('classifies bearish when all complete TFs < 50', () => {
        const r = getStatus([40, 30, 20, 10, 45, 49], { expectedCount: 6 });
        assert.equal(r.status, 'bearish');
        assert.equal(r.incomplete, false);
    });

    it('classifies mixed when values straddle 50', () => {
        const r = getStatus([60, 40, 55, 45, 70, 30], { expectedCount: 6 });
        assert.equal(r.status, 'mixed');
        assert.equal(r.incomplete, false);
    });

    it('returns unknown when all values are null', () => {
        const r = getStatus([null, null, null], { expectedCount: 3 });
        assert.equal(r.status, 'unknown');
        assert.equal(r.incomplete, true);
        assert.equal(r.priority, 0);
    });

    it('boundary: value exactly 60 is not strong (requires > 60)', () => {
        const r = getStatus([60, 60, 60, 60], { expectedCount: 4 });
        assert.equal(r.status, 'bullish'); // all > 50, not all > 60
    });

    it('boundary: value exactly 50 is mixed (not bullish, not bearish)', () => {
        const r = getStatus([50, 50, 50, 50], { expectedCount: 4 });
        // 50 is not > 50 and not < 50 → mixed
        assert.equal(r.status, 'mixed');
    });
});
