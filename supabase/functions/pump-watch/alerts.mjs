export function candidates(model, limits) {
    const alerts = [];
    if (model.active && model.now - model.active.time >= limits.longRunMs) {
        const started = new Date(model.active.time).toISOString();
        alerts.push({ kind: 'long_run', episode: started,
            message: `Pump has been running for at least ${limits.longRunMs / 60000} minutes. Started ${started}. State inferred from pump events.` });
    }
    const recent = model.cycles.slice(-limits.shortCount);
    if (recent.length === limits.shortCount && recent[0].start >= model.now - limits.shortWindowMs &&
        recent.every(cycle => cycle.duration < limits.shortRunMs)) {
        const stopped = new Date(recent.at(-1).end).toISOString();
        alerts.push({ kind: 'short_cycling', episode: stopped,
            message: `Pump short cycling: ${limits.shortCount} consecutive runs under ${limits.shortRunMs / 1000} seconds within ${limits.shortWindowMs / 60000} minutes.` });
    }
    return alerts;
}
