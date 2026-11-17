begin;

create table if not exists public.pump_monitor_heartbeat (
    id integer primary key check (id = 1),
    last_seen timestamptz,
    stale_after_seconds integer not null default 900 check (stale_after_seconds >= 60)
);
alter table public.pump_monitor_heartbeat enable row level security;
revoke all on public.pump_monitor_heartbeat from public, anon, authenticated;
grant select on public.pump_monitor_heartbeat to anon, authenticated, service_role;
drop policy if exists "view monitor heartbeat" on public.pump_monitor_heartbeat;
create policy "view monitor heartbeat" on public.pump_monitor_heartbeat
    for select to anon, authenticated using (id = 1);
insert into public.pump_monitor_heartbeat (id) values (1) on conflict do nothing;

create schema if not exists pump_watch;
create table if not exists pump_watch.alert_state (
    kind text primary key check (kind in ('long_run', 'short_cycling', 'heartbeat')),
    episode timestamptz not null,
    lease_until timestamptz not null,
    sent_at timestamptz
);

create or replace function public.record_pump_monitor_heartbeat()
returns void language sql security definer set search_path = ''
as $$
    update public.pump_monitor_heartbeat set last_seen = statement_timestamp() where id = 1;
$$;

create or replace function public.claim_pump_watch_alert(alert_kind text, alert_episode timestamptz)
returns boolean language sql security definer set search_path = ''
as $$
    with claim as (
        insert into pump_watch.alert_state as state (kind, episode, lease_until)
        values (alert_kind, alert_episode, statement_timestamp() + interval '90 seconds')
        on conflict (kind) do update
        set episode = excluded.episode, lease_until = excluded.lease_until, sent_at = null
        where state.lease_until <= statement_timestamp()
          and (
            (state.episode = excluded.episode and state.sent_at is null)
            or (
                state.episode < excluded.episode
                and (state.kind <> 'short_cycling' or state.sent_at is null
                    or state.sent_at <= statement_timestamp() - interval '15 minutes')
            )
          )
        returning 1
    )
    select exists (select 1 from claim);
$$;

create or replace function public.finish_pump_watch_alert(alert_kind text, alert_episode timestamptz, delivered boolean)
returns void language sql security definer set search_path = ''
as $$
    update pump_watch.alert_state
    set sent_at = case when delivered then statement_timestamp() else null end,
        lease_until = statement_timestamp()
    where kind = alert_kind and episode = alert_episode and sent_at is null;
$$;

revoke execute on function public.record_pump_monitor_heartbeat() from public, anon, authenticated;
revoke execute on function public.claim_pump_watch_alert(text, timestamptz) from public, anon, authenticated;
revoke execute on function public.finish_pump_watch_alert(text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.record_pump_monitor_heartbeat() to service_role;
grant execute on function public.claim_pump_watch_alert(text, timestamptz) to service_role;
grant execute on function public.finish_pump_watch_alert(text, timestamptz, boolean) to service_role;

create or replace function public.pump_watch_configuration()
returns jsonb language sql security definer set search_path = ''
as $$
    select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb)
    from vault.decrypted_secrets
    where name in ('pump_watch_telegram_token', 'pump_watch_telegram_chat',
        'pump_watch_cron_secret', 'pump_watch_heartbeat_secret');
$$;
revoke execute on function public.pump_watch_configuration() from public, anon, authenticated;
grant execute on function public.pump_watch_configuration() to service_role;

commit;
