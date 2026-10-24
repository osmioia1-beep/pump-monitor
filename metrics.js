(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.PumpMetrics = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
    'use strict';
    const TIME_ZONE = 'Europe/Lisbon';
    const HOUR = 3600000;
    const partsFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    });
    function parts(ms) {
        return Object.fromEntries(partsFormatter.formatToParts(ms).map(p => [p.type, p.value]));
    }
    function dayKey(ms) {
        const p = parts(ms);
        return `${p.year}-${p.month}-${p.day}`;
    }
    function shiftDay(key, amount) {
        const d = new Date(key + 'T12:00:00Z');
        d.setUTCDate(d.getUTCDate() + amount);
        return d.toISOString().slice(0, 10);
    }
    // Resolve local midnight using the installation's zone, never the browser's zone.
    function midnight(key) {
        const target = Date.parse(key + 'T00:00:00Z');
        let candidate = target;
        for (let i = 0; i < 4; i++) {
            const p = parts(candidate);
            const localAsUTC = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
            const difference = target - localAsUTC;
            candidate += difference;
            if (!difference) return candidate;
        }
        throw new Error('Unable to resolve Lisbon midnight');
    }
    function formatDuration(ms) {
        if (!Number.isFinite(ms) || ms < 0) return 'N/A';
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        if (days) return `${days}d ${hours % 24}h ${minutes % 60}m ${seconds % 60}s`;
        if (hours) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        if (minutes) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    }
    function reconstruct(events, now) {
        const issues = { invalid: 0, future: 0, duplicateStarts: 0, unmatchedStops: 0, ambiguous: 0 };
        const rows = events.map((raw, index) => {
            const ev = raw && typeof raw === 'object' ? raw : {};
            const ts = typeof ev.ts === 'string' && /(?:Z|[+-]\d\d:\d\d)$/i.test(ev.ts) ? Date.parse(ev.ts) : NaN;
            const valid = Number.isFinite(ts) && (ev.event === 'start' || ev.event === 'stop');
            if (!valid) issues.invalid++;
            else if (ts > now) issues.future++;
            return { ...ev, index, time: ts, valid: valid && ts <= now, duration: null,
                note: !valid ? 'Invalid event or timestamp' : ts > now ? 'Future timestamp' : '' };
        });
        const sorted = rows.filter(r => r.valid).sort((a, b) => a.time - b.time || a.index - b.index);
        const cycles = [];
        let active = null;
        for (let i = 0; i < sorted.length;) {
            let j = i + 1;
            while (j < sorted.length && sorted[j].time === sorted[i].time) j++;
            const group = sorted.slice(i, j);
            if (new Set(group.map(r => r.event)).size > 1) {
                // Database timestamps alone cannot establish an order for these transitions.
                issues.ambiguous += group.length;
                group.forEach(r => { r.note = 'Ambiguous simultaneous start/stop'; });
                if (active) active.note = 'End unknown after ambiguous events';
                active = null;
            } else {
                for (const row of group) {
                    if (row.event === 'start') {
                        if (active) { issues.duplicateStarts++; row.note = 'Repeated start; ignored'; }
                        else active = row;
                    } else if (active) {
                        row.duration = row.time - active.time;
                        cycles.push({ start: active.time, end: row.time, duration: row.duration });
                        active = null;
                    } else { issues.unmatchedStops++; row.note = 'Stop without a start'; }
                }
            }
            i = j;
        }
        if (active) active.note = 'Open cycle; running state inferred from events';
        return { rows, cycles, active, issues, firstTs: sorted.length ? sorted[0].time : null };
    }
    function overlap(start, end, from, to) {
        return Math.max(0, Math.min(end, to) - Math.max(start, from));
    }
    function summarize(data, from, to, now, includeEnd = false) {
        const available = data.firstTs !== null && (data.firstTs < to || (includeEnd && data.firstTs === to)) && to > from;
        const partial = available && data.firstTs > from;
        const completed = data.cycles.filter(c => c.end >= from && (c.end < to || (includeEnd && c.end === to)));
        let runningMs = data.cycles.reduce((sum, c) => sum + overlap(c.start, c.end, from, to), 0);
        if (data.active) runningMs += overlap(data.active.time, now, from, to);
        const durations = completed.map(c => c.duration);
        const durationSum = durations.reduce((sum, n) => sum + n, 0);
        // A partially observed day has no reliable whole-day rate.
        const hours = (to - from) / HOUR;
        return { from, to, available, partial, cycles: completed.length, runningMs,
            avgMs: durations.length ? durationSum / durations.length : null,
            minMs: durations.length ? durations.reduce((a, b) => Math.min(a, b), Infinity) : null,
            maxMs: durations.length ? durations.reduce((a, b) => Math.max(a, b), 0) : null,
            cyclesPerHour: available && !partial && hours > 0 ? completed.length / hours : null };
    }
    function analyze(events, now = Date.now()) {
        if (!Array.isArray(events) || !Number.isFinite(now)) throw new Error('Invalid metrics input');
        const data = reconstruct(events, now);
        const todayKey = dayKey(now);
        const todayStart = midnight(todayKey);
        const yesterdayStart = midnight(shiftDay(todayKey, -1));
        const globalStart = data.firstTs === null ? now : data.firstTs;
        const global = summarize(data, globalStart, now, now, true);
        const days = data.firstTs === null ? 0 :
            Math.round((Date.parse(todayKey) - Date.parse(dayKey(data.firstTs))) / 86400000) + 1;
        global.cyclesPerDay = global.available && days > 0 ? global.cycles / days : null;
        return { ...data, now, global,
            today: summarize(data, todayStart, now, now, true),
            yesterday: summarize(data, yesterdayStart, todayStart, now) };
    }
    return { TIME_ZONE, dayKey, shiftDay, midnight, formatDuration, analyze };
});
