-- Store the same value as PUMP_WATCH_CRON_SECRET in Vault as pump_watch_cron_secret first.
-- Requires the pg_cron and pg_net extensions.
do $$
begin
    if not exists (select 1 from vault.decrypted_secrets where name = 'pump_watch_cron_secret') then
        raise exception 'Missing Vault secret pump_watch_cron_secret';
    end if;
end;
$$;

select cron.schedule(
    'pump-watch-minute',
    '* * * * *',
    $job$
    select net.http_post(
        url := 'https://lfatskduuzwdqoomtphh.supabase.co/functions/v1/pump-watch/check',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-pump-key', (select decrypted_secret from vault.decrypted_secrets where name = 'pump_watch_cron_secret')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 50000
    );
    $job$
);
