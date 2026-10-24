(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.PumpData = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
    'use strict';
    async function fetchAllEvents({ baseUrl, apiKey, cutoff, fetchImpl = fetch, onProgress = () => {}, pageSize = 1000 }) {
        if (!Number.isFinite(Date.parse(cutoff))) throw new Error('Invalid history cutoff');
        const all = [];
        let expected = null;
        // Stop explicitly rather than silently presenting an incomplete large history.
        const maxEvents = 250000;
        do {
            const url = new URL('/rest/v1/pump_events', baseUrl);
            url.searchParams.set('select', 'event,ts,source_ip');
            // Rows identical in these three columns are interchangeable for reconstruction.
            url.searchParams.set('order', 'ts.asc.nullslast,event.asc,source_ip.asc');
            url.searchParams.set('or', `(ts.lte.${cutoff},ts.is.null)`);
            url.searchParams.set('offset', String(all.length));
            url.searchParams.set('limit', String(pageSize));
            const response = await fetchImpl(url.toString(), {
                method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(30000),
                headers: { apikey: apiKey, Prefer: 'count=exact' }
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            const page = await response.json();
            const range = /^(?:(\d+)-(\d+)|\*)\/(\d+)$/.exec(response.headers.get('content-range') || '');
            if (!Array.isArray(page) || !range) throw new Error('Cannot verify history coverage (Content-Range missing or invalid)');
            const total = Number(range[3]);
            if (!Number.isSafeInteger(total) || total > maxEvents) throw new Error('History is too large for browser statistics; server aggregation is required');
            if (expected !== null && expected !== total) throw new Error('History changed while loading; refresh to retry');
            expected = total;
            if (page.length && (Number(range[1]) !== all.length || Number(range[2]) - Number(range[1]) + 1 !== page.length)) {
                throw new Error('Unexpected history page; statistics were not updated');
            }
            if ((!page.length && all.length < expected) || all.length + page.length > expected) {
                throw new Error('Incomplete history; statistics were not updated');
            }
            // A server page cap may be smaller than requested. Advance by actual rows, not pageSize.
            for (const row of page) all.push(row);
            onProgress(all.length, expected);
        } while (all.length < expected);
        return all;
    }
    return { fetchAllEvents };
});
