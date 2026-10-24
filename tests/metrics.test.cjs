const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../metrics.js');
const ts = (day, time = '12:00:00') => `2026-10-${day}T${time}+01:00`;
const e = (event, date) => ({ event, ts: date, source_ip: 'test' });
const now = Date.parse(ts(24));
const baseline = [e('start', ts(20, '08:00:00')), e('stop', ts(20, '08:01:00'))];
const analyze = rows => M.analyze([...baseline, ...rows], now);

test('normal completed cycles share total, mean and extrema across horizons', () => {
    const m = M.analyze([e('start',ts(24,'08:00:00')),e('stop',ts(24,'08:10:00')),e('start',ts(24,'09:00:00')),e('stop',ts(24,'09:20:00'))],now);
    for (const h of [m.global,m.today]) {
        assert.equal(h.cycles,2); assert.equal(h.runningMs,30*60000);
        assert.equal(h.avgMs,15*60000); assert.equal(h.minMs,10*60000); assert.equal(h.maxMs,20*60000);
    }
});
test('cross-midnight cycle splits running time and counts the completion once', () => {
    const m=analyze([e('start',ts(23,'23:50:00')),e('stop',ts(24,'00:10:00'))]);
    assert.equal(m.today.runningMs,600000); assert.equal(m.yesterday.runningMs,600000);
    assert.equal(m.today.cycles,1); assert.equal(m.yesterday.cycles,0);
    assert.equal(m.today.avgMs,1200000); assert.equal(m.yesterday.avgMs,null);
});
test('one-minute cycle yesterday uses the whole day, including idle hours', () => {
    const m=analyze([e('start',ts(23)),e('stop',ts(23,'12:01:00'))]);
    assert.equal(m.yesterday.cyclesPerHour,1/24);
    assert.equal(m.today.cyclesPerHour,0); assert.equal(m.today.runningMs,0);
    assert.equal(m.today.avgMs,null);
});
test('global observation window includes idle time through snapshot', () => {
    const m=M.analyze([e('start',ts(23)),e('stop',ts(23,'12:01:00'))],now);
    assert.equal(m.global.cyclesPerHour,1/24);
});
test('duplicate stop has no second table duration and no extra cycle', () => {
    const m=analyze([e('start',ts(24,'08:00:00')),e('stop',ts(24,'08:10:00')),e('stop',ts(24,'08:20:00'))]);
    assert.equal(m.today.cycles,1); assert.equal(m.today.runningMs,600000);
    assert.equal(m.rows.at(-1).duration,null); assert.equal(m.issues.unmatchedStops,1);
    assert.equal(m.rows.at(-2).duration,600000);
});
test('duplicate start keeps earliest start and reports the duplicate', () => {
    const m=analyze([e('start',ts(24,'08:00:00')),e('start',ts(24,'08:05:00')),e('stop',ts(24,'08:10:00'))]);
    assert.equal(m.today.runningMs,600000); assert.equal(m.issues.duplicateStarts,1);
});
test('calendar average includes idle dates', () => {
    const m=M.analyze([e('start',ts(22,'08:00:00')),e('stop',ts(22,'08:10:00')),e('start',ts(24,'08:00:00')),e('stop',ts(24,'08:10:00'))],now);
    assert.equal(m.global.cyclesPerDay,2/3);
});
test('a local cycle crossing UTC midnight remains one Lisbon calendar date', () => {
    const m=M.analyze([e('start',ts(24,'00:50:00')),e('stop',ts(24,'01:10:00'))],now);
    assert.equal(m.global.cyclesPerDay,1); assert.equal(m.today.cycles,1);
});
test('open interval contributes running time without contaminating duration extrema', () => {
    const m=analyze([e('start',ts(23,'23:50:00'))]);
    assert.equal(m.yesterday.runningMs,600000); assert.equal(m.today.runningMs,12*3600000);
    assert.equal(m.today.cycles,0); assert.equal(m.today.avgMs,null);
    assert.equal(m.active.time,Date.parse(ts(23,'23:50:00')));
});
test('partial and absent history are distinguished from a fully observed idle day', () => {
    const m=M.analyze([e('start',ts(24,'08:00:00')),e('stop',ts(24,'08:10:00'))],now);
    assert.equal(m.today.partial,true); assert.equal(m.today.cyclesPerHour,null);
    assert.equal(m.yesterday.available,false); assert.equal(m.yesterday.cyclesPerHour,null);
    const full=analyze([]); assert.equal(full.yesterday.available,true); assert.equal(full.yesterday.cycles,0);
});
test('empty or invalid history does not crash or fabricate zero activity', () => {
    const m=M.analyze([null,e('start','invalid'),e('unknown',ts(24)),e('start','2026-10-24T08:00:00')],now);
    assert.equal(m.issues.invalid,4); assert.equal(m.global.available,false);
    assert.equal(M.analyze([],now).today.available,false);
});
test('future events are excluded', () => {
    const m=M.analyze([e('start',ts(24,'13:00:00'))],now);
    assert.equal(m.issues.future,1); assert.equal(m.active,null);
});
test('simultaneous opposing events are ambiguous regardless of input order', () => {
    for (const rows of [[e('start',ts(24)),e('stop',ts(24))],[e('stop',ts(24)),e('start',ts(24))]]) {
        const m=analyze(rows); assert.equal(m.today.cycles,0); assert.equal(m.issues.ambiguous,2); assert.equal(m.active,null);
    }
});
test('stop at midnight belongs only to the new day', () => {
    const m=analyze([e('start',ts(23,'23:50:00')),e('stop',ts(24,'00:00:00'))]);
    assert.equal(m.yesterday.cycles,0); assert.equal(m.today.cycles,1);
    assert.equal(m.yesterday.runningMs,600000); assert.equal(m.today.runningMs,0);
});
test('exact-midnight snapshot does not include the new-day stop in yesterday', () => {
    const m=M.analyze([...baseline,e('start',ts(23,'23:50:00')),e('stop',ts(24,'00:00:00'))],Date.parse(ts(24,'00:00:00')));
    assert.equal(m.yesterday.cycles,0); assert.equal(m.global.cycles,2);
    assert.equal(m.today.cyclesPerHour,null);
});
test('DST days use 23 and 25 hours', () => {
    for (const [day,previous,hours] of [['2026-03-30','2026-03-29',23],['2026-10-26','2026-10-25',25]]) {
        const date=Date.parse(day+'T12:00:00Z');
        const m=M.analyze([e('start','2026-03-01T00:00:00Z'),e('stop','2026-03-01T00:01:00Z'),e('start',previous+'T12:00:00Z'),e('stop',previous+'T12:01:00Z')],date);
        assert.equal((m.yesterday.to-m.yesterday.from)/3600000,hours);
        assert.equal(m.yesterday.cyclesPerHour,1/hours);
    }
});
test('installation days are independent of viewer time zone', () => {
    const original=process.env.TZ;
    try {
        for (const zone of ['UTC','America/New_York','Asia/Tokyo']) {
            process.env.TZ=zone; assert.equal(M.dayKey(Date.parse(ts(24,'00:30:00'))),'2026-10-24');
            assert.equal(M.midnight('2026-10-24'),Date.parse(ts(24,'00:00:00')));
        }
    } finally { if(original===undefined) delete process.env.TZ; else process.env.TZ=original; }
});
test('unordered input is reconstructed chronologically', () => {
    const m=analyze([e('stop',ts(24,'08:10:00')),e('start',ts(24,'08:00:00'))]);
    assert.equal(m.today.runningMs,600000);
});
test('zero-length observation and invalid durations never produce Infinity', () => {
    const m=M.analyze([e('start',ts(24))],now);
    assert.equal(m.global.cyclesPerHour,null);
    for(const n of [null,undefined,NaN,Infinity,-1]) assert.equal(M.formatDuration(n),'N/A');
    assert.equal(M.formatDuration(86401000),'1d 0h 0m 1s');
});
