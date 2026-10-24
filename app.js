'use strict';
const SUPABASE_URL = 'https://lfatskduuzwdqoomtphh.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_glIqqTFNY8hDXl_3qaEOFQ_BWX8QU8T';
const $ = id => document.getElementById(id);
const M = PumpMetrics;
const dateFormatter = new Intl.DateTimeFormat(undefined, {
    timeZone: M.TIME_ZONE, year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});
const formatDate = ms => Number.isFinite(ms) ? dateFormatter.format(ms) : 'Invalid timestamp';
let snapshot = null;
function tableLimit() {
    const n = Number($('limitInput').value);
    const limit = Number.isFinite(n) ? Math.max(1, Math.min(500, Math.trunc(n))) : 50;
    $('limitInput').value = String(limit);
    return limit;
}
function clearStats() {
    document.querySelectorAll('.stat-value').forEach(el => { el.textContent = '-'; });
    $('eventsBody').replaceChildren();
    $('eventsTable').hidden = true;
    $('emptyMsg').hidden = true;
    $('coverage').textContent = '';
    $('quality').textContent = '';
    $('pumpState').textContent = '';
}
function renderStats(horizon, suffix) {
    const set = (name, value) => { $(name + suffix).textContent = value; };
    const duration = value => horizon.available ? M.formatDuration(value) : 'N/A';
    set('cycles', horizon.available ? horizon.cycles : 'N/A');
    set('runningTime', duration(horizon.runningMs));
    set('avgRunning', duration(horizon.avgMs));
    set('maxRunning', duration(horizon.maxMs));
    set('minRunning', duration(horizon.minMs));
    set('avgCyclesPerHour', horizon.cyclesPerHour === null ? 'N/A' : horizon.cyclesPerHour.toFixed(2));
    $(suffix.toLowerCase() + 'Coverage').textContent = !horizon.available ? 'No observation coverage for this period.' :
        `${formatDate(horizon.from)} → ${formatDate(horizon.to)}${horizon.partial ? ' · Partial history; hourly rate unavailable.' : ''}`;
}
function renderTable(model) {
    const rows = [...model.rows].sort((a, b) => {
        if (a.valid !== b.valid) return Number(b.valid) - Number(a.valid);
        return (Number.isFinite(b.time) ? b.time : -Infinity) - (Number.isFinite(a.time) ? a.time : -Infinity) || b.index - a.index;
    }).slice(0, tableLimit());
    const fragment = document.createDocumentFragment();
    for (const row of rows) {
        const tr = document.createElement('tr');
        const values = [String(row.event ?? 'unknown').toUpperCase(), formatDate(row.time),
            row.duration === null ? (row.note || '-') : M.formatDuration(row.duration), row.source_ip || 'unknown'];
        values.forEach((value, index) => {
            const td = document.createElement('td');
            td.textContent = value;
            if (index === 0) td.className = row.event === 'start' ? 'event-start' : row.event === 'stop' ? 'event-stop' : '';
            if (index === 2) td.className = 'duration';
            tr.appendChild(td);
        });
        fragment.appendChild(tr);
    }
    $('eventsBody').replaceChildren(fragment);
    $('eventsTable').hidden = !rows.length;
    $('emptyMsg').hidden = !!rows.length;
}
function renderSnapshot() {
    if (!snapshot) return;
    const model = snapshot;
    for (const suffix of ['Global', 'Today', 'Yesterday']) renderStats(model[suffix.toLowerCase()], suffix);
    $('avgCyclesPerDayGlobal').textContent = model.global.cyclesPerDay === null ? 'N/A' : model.global.cyclesPerDay.toFixed(2);
    const last = model.rows.filter(r => r.valid).reduce((result, row) => !result || row.time > result.time ? row : result, null);
    $('lastEvent').textContent = last ? `${last.event.toUpperCase()} · ${formatDate(last.time)}` : 'N/A';
    $('coverage').textContent = `${model.rows.length} accessible historical events loaded · Snapshot: ${formatDate(model.now)} · Time zone: ${M.TIME_ZONE}. Table limit does not affect statistics.`;
    $('pumpState').textContent = model.active ?
        `Open cycle since ${formatDate(model.active.time)} (${M.formatDuration(model.now - model.active.time)} at snapshot). Running state inferred from events.` :
        'No open cycle in the reconstructed history.';
    const descriptions = { invalid: 'invalid events', future: 'future events', duplicateStarts: 'repeated starts ignored', unmatchedStops: 'stops without a start', ambiguous: 'events with ambiguous simultaneous transitions' };
    const warnings = Object.entries(model.issues).filter(([, count]) => count).map(([key, count]) => `${count} ${descriptions[key]}`);
    $('quality').textContent = warnings.length ? `Incomplete or inconsistent event history: ${warnings.join('; ')}. Metrics reflect reconstructable intervals only; actual totals may differ.` : '';
    renderTable(model);
}
async function refresh() {
    $('refreshBtn').disabled = true;
    $('limitInput').disabled = true;
    $('loading').hidden = false;
    $('error').hidden = true;
    snapshot = null;
    clearStats();
    const now = Date.now();
    try {
        const events = await PumpData.fetchAllEvents({ baseUrl: SUPABASE_URL, apiKey: SUPABASE_PUBLISHABLE_KEY,
            cutoff: new Date(now).toISOString(), onProgress: (loaded, total) => {
                $('loading').textContent = `Loading history: ${loaded} / ${total} events…`;
            } });
        snapshot = M.analyze(events, now);
        renderSnapshot();
    } catch (err) {
        $('error').textContent = 'Statistics unavailable: ' + err.message;
        $('error').hidden = false;
    } finally {
        $('loading').hidden = true;
        $('refreshBtn').disabled = false;
        $('limitInput').disabled = false;
    }
}
$('refreshBtn').addEventListener('click', refresh);
$('limitInput').addEventListener('change', renderSnapshot);
refresh();
