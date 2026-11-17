import "../../../metrics.js";
import "../../../data.js";
import { candidates } from "./alerts.mjs";

const baseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const publicKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const { PumpMetrics, PumpData } = globalThis as unknown as {
    PumpMetrics: { analyze: (events: unknown[], now: number) => Parameters<typeof candidates>[0] };
    PumpData: { fetchAllEvents: (options: { baseUrl: string; apiKey: string; cutoff: string }) => Promise<unknown[]> };
};

function setting(name: string, fallback: number, minimum: number) {
    const value = Number(Deno.env.get(name) ?? fallback);
    if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`Invalid ${name}`);
    return value;
}

async function db(path: string, body?: Record<string, unknown>) {
    const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
        method: body ? "POST" : "GET",
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Database request failed (${response.status})`);
    return response.status === 204 ? null : await response.json();
}

async function send(message: string, config: Record<string, string>) {
    const token = config.pump_watch_telegram_token;
    const chatId = config.pump_watch_telegram_chat;
    if (!token || !chatId) throw new Error("Telegram configuration missing");
    try {
        const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: message }),
            signal: AbortSignal.timeout(10_000),
        });
        return response.ok && (await response.json()).ok === true;
    } catch {
        return false;
    }
}

Deno.serve(async request => {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const action = new URL(request.url).pathname.split("/").at(-1);
    if (action !== "check") return new Response("Unknown path", { status: 404 });
    try {
        const config = await db("rpc/pump_watch_configuration", {});
        const secret = config.pump_watch_cron_secret;
        if (!secret || request.headers.get("x-pump-key") !== secret) {
            return new Response("Unauthorized", { status: 401 });
        }
        const limits = {
            longRunMs: setting("PUMP_LONG_RUN_SECONDS", 1500, 60) * 1000,
            shortRunMs: setting("PUMP_SHORT_RUN_SECONDS", 60, 1) * 1000,
            shortCount: setting("PUMP_SHORT_COUNT", 3, 2),
            shortWindowMs: setting("PUMP_SHORT_WINDOW_SECONDS", 900, 60) * 1000,
        };
        const now = Date.now();
        const events = await PumpData.fetchAllEvents({ baseUrl, apiKey: publicKey, cutoff: new Date(now).toISOString() });
        let failed = false;
        for (const alert of candidates(PumpMetrics.analyze(events, now), limits)) {
            const args = { alert_kind: alert.kind, alert_episode: alert.episode };
            if (!await db("rpc/claim_pump_watch_alert", args)) continue;
            const delivered = await send(alert.message, config);
            await db("rpc/finish_pump_watch_alert", { ...args, delivered });
            failed ||= !delivered;
        }
        return new Response(null, { status: failed ? 502 : 204 });
    } catch {
        console.error("Pump Watch check or heartbeat failed");
        return new Response("Pump Watch request failed", { status: 500 });
    }
});
