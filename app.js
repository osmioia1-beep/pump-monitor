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
let selectedDay = null;
let refreshing = false;
const REFRESH_INTERVAL = 60_000;
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
    $('activityPanel').hidden = true;
    $('cyclesBody').replaceChildren();
    $('cyclesTable').hidden = true;
    $('historyFilter').hidden = true;
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
    const window = selectedDay && [M.midnight(selectedDay), M.midnight(M.shiftDay(selectedDay, 1))];
    const inDay = time => !window || (time >= window[0] && time < window[1]);
    const limit = tableLimit();
    const showCycles = $('historyView').value === 'cycles';
    $('historyFilter').hidden = !selectedDay;
    $('historyDay').textContent = selectedDay ? `Events or cycle stops on ${selectedDay} · Lisbon` : '';
    if (showCycles) {
        const cycles = model.cycles.map((cycle, index) => ({
            ...cycle, idle: index ? cycle.start - model.cycles[index - 1].end : null
        })).filter(cycle => inDay(cycle.end)).slice(-limit).reverse();
        const fragment = document.createDocumentFragment();
        for (const cycle of cycles) {
            const row = document.createElement('tr');
            for (const value of [formatDate(cycle.start), formatDate(cycle.end), M.formatDuration(cycle.duration), M.formatDuration(cycle.idle)]) {
                const cell = document.createElement('td');
                cell.textContent = value;
                row.appendChild(cell);
            }
            fragment.appendChild(row);
        }
        $('cyclesBody').replaceChildren(fragment);
        $('cyclesTable').hidden = !cycles.length;
        $('eventsTable').hidden = true;
        $('emptyMsg').textContent = 'No completed cycles found';
        $('emptyMsg').hidden = !!cycles.length;
        return;
    }
    const rows = model.rows.filter(row => inDay(row.time)).sort((a, b) => {
        if (a.valid !== b.valid) return Number(b.valid) - Number(a.valid);
        return (Number.isFinite(b.time) ? b.time : -Infinity) - (Number.isFinite(a.time) ? a.time : -Infinity) || b.index - a.index;
    }).slice(0, limit);
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
    $('cyclesTable').hidden = true;
    $('emptyMsg').textContent = 'No events found';
    $('emptyMsg').hidden = !!rows.length;
}
function renderActivity(model) {
    const chart = $('activityChart');
    const focusedDay = document.activeElement?.dataset?.day;
    const days = M.dailyActivity(model, $('chartRange').value === '30' ? 30 : 7);
    const maxCycles = Math.max(1, ...days.map(day => day.cycles));
    const maxRuntime = Math.max(1, ...days.map(day => day.runningMs));
    const fragment = document.createDocumentFragment();
    let detail = '';
    if (!days.some(day => day.key === selectedDay)) selectedDay = null;
    for (const [index, day] of days.entries()) {
        const label = day.available
            ? `${day.key} · ${day.cycles} completed cycles · ${M.formatDuration(day.runningMs)} running${day.partial ? ' · Partial history' : ''}`
            : `${day.key} · No observation coverage`;
        const button = document.createElement('button');
        button.className = 'chart-day';
        button.type = 'button';
        button.setAttribute('data-day', day.key);
        button.disabled = !day.available;
        button.title = label;
        button.setAttribute('aria-label', label);
        button.setAttribute('aria-pressed', String(day.key === selectedDay));
        if (day.key === selectedDay) detail = label;
        button.addEventListener('click', () => {
            selectedDay = selectedDay === day.key ? null : day.key;
            renderActivity(model);
            renderTable(model);
            chart.children[index].focus();
        });
        const bars = document.createElement('span');
        bars.className = 'chart-bars';
        for (const [className, proportion] of [['cycles-bar', day.cycles / maxCycles], ['runtime-bar', day.runningMs / maxRuntime]]) {
            const bar = document.createElement('span');
            bar.className = 'chart-bar ' + className;
            bar.style.height = `${proportion * 100}%`;
            bars.appendChild(bar);
        }
        const date = document.createElement('span');
        date.className = 'chart-date';
        date.textContent = day.available ? day.key.slice(5) : '— ' + day.key.slice(5);
        button.appendChild(bars);
        button.appendChild(date);
        fragment.appendChild(button);
    }
    chart.replaceChildren(fragment);
    const focusIndex = focusedDay ? days.findIndex(day => day.key === focusedDay) : -1;
    if (focusIndex >= 0) chart.children[focusIndex].focus();
    $('dayDetail').textContent = detail;
    $('activityPanel').hidden = false;
}
function renderSnapshot() {
    if (!snapshot) return;
    const model = snapshot;
    for (const suffix of ['Global', 'Today', 'Yesterday']) renderStats(model[suffix.toLowerCase()], suffix);
    $('avgCyclesPerDayGlobal').textContent = model.global.cyclesPerDay === null ? 'N/A' : model.global.cyclesPerDay.toFixed(2);
    const last = model.rows.filter(r => r.valid).reduce((result, row) => !result || row.time > result.time ? row : result, null);
    $('lastEvent').textContent = last ? `${last.event.toUpperCase()} · ${formatDate(last.time)}` : 'N/A';
    $('coverage').textContent = `Last successful refresh: ${formatDate(Date.now())} · ${model.rows.length} accessible historical events · ${M.TIME_ZONE}`;
    $('pumpState').textContent = model.active ?
        `Running since ${formatDate(model.active.time)} · ${M.formatDuration(model.now - model.active.time)} at snapshot (inferred)` :
        last?.event === 'stop' && last.note !== 'Ambiguous simultaneous start/stop' ?
            `Last stopped at ${formatDate(last.time)} (inferred)` : 'Pump state unknown';
    const descriptions = { invalid: 'invalid events', future: 'future events', duplicateStarts: 'repeated starts ignored', unmatchedStops: 'stops without a start', ambiguous: 'events with ambiguous simultaneous transitions' };
    const warnings = Object.entries(model.issues).filter(([, count]) => count).map(([key, count]) => `${count} ${descriptions[key]}`);
    $('quality').textContent = warnings.length ? `Incomplete or inconsistent event history: ${warnings.join('; ')}. Metrics reflect reconstructable intervals only; actual totals may differ.` : '';
    renderActivity(model);
    renderTable(model);
}
async function refresh({ background = false } = {}) {
    if (refreshing) return;
    refreshing = true;
    $('refreshBtn').disabled = true;
    const keepSnapshot = background && !!snapshot;
    if (!keepSnapshot) {
        $('limitInput').disabled = true;
        $('loading').hidden = false;
        $('error').hidden = true;
        snapshot = null;
        clearStats();
    }
    const now = Date.now();
    try {
        const events = await PumpData.fetchAllEvents({ baseUrl: SUPABASE_URL, apiKey: SUPABASE_PUBLISHABLE_KEY,
            cutoff: new Date(now).toISOString(), onProgress: (loaded, total) => {
                $('loading').textContent = `Loading history: ${loaded} / ${total} events…`;
            } });
        snapshot = M.analyze(events, now);
        renderSnapshot();
        $('error').hidden = true;
    } catch (err) {
        $('error').textContent = (keepSnapshot ? 'Automatic refresh failed. Showing the last successful snapshot: ' :
            'Statistics unavailable: ') + err.message;
        $('error').hidden = false;
    } finally {
        refreshing = false;
        $('loading').hidden = true;
        $('refreshBtn').disabled = false;
        $('limitInput').disabled = false;
    }
}
$('refreshBtn').addEventListener('click', refresh);
$('limitInput').addEventListener('change', () => { if (snapshot) renderTable(snapshot); });
$('historyView').addEventListener('change', () => { if (snapshot) renderTable(snapshot); });
$('chartRange').addEventListener('change', () => {
    if (!snapshot) return;
    renderActivity(snapshot);
    renderTable(snapshot);
});
$('clearDay').addEventListener('click', () => {
    selectedDay = null;
    if (!snapshot) return;
    renderActivity(snapshot);
    renderTable(snapshot);
    $('historyView').focus();
});
if (typeof setInterval === 'function') {
    setInterval(() => { if (!document.hidden) refresh({ background: true }); }, REFRESH_INTERVAL);
}
refresh();
