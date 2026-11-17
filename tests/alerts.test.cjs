const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyze } = require('../metrics.js');
const checker = import('../supabase/functions/pump-watch/alerts.mjs');

const now = Date.parse('2026-11-17T12:00:00Z');
const limits = { longRunMs: 1500000, shortRunMs: 60000, shortCount: 3, shortWindowMs: 900000 };
const transition = (event, secondsAgo) => ({ event, ts: new Date(now - secondsAgo * 1000).toISOString() });

test('an open cycle raises a long-run alert even after no new events arrive', async () => {
    const { candidates } = await checker;
    const model = analyze([transition('start', 1500), transition('start', 200)], now);
    assert.deepEqual(candidates(model, limits).map(alert => alert.kind), ['long_run']);
    const stopped = analyze([transition('start', 1500), transition('stop', 1)], now);
    assert.deepEqual(candidates(stopped, limits), []);
});

test('short cycling requires consecutive short runs in the same recent window', async () => {
    const { candidates } = await checker;
    const events = [
        transition('start', 400), transition('stop', 370),
        transition('start', 300), transition('stop', 270),
        transition('start', 200), transition('stop', 170)
    ];
    assert.deepEqual(candidates(analyze(events, now), limits).map(alert => alert.kind), ['short_cycling']);
    assert.deepEqual(candidates(analyze(events, now + limits.shortWindowMs), limits), []);
    events[3] = transition('stop', 240);
    assert.deepEqual(candidates(analyze(events, now), limits), []);
});

