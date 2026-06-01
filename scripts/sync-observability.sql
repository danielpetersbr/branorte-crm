-- Observabilidade do sync de orcamentos -> pasta Z: (aplicado em prod 2026-06-01).
-- Referencia/idempotente. A migration ja foi aplicada via Supabase (apply_migration
-- "sync_orcamentos_observability"); este arquivo documenta o estado.

-- 1) Ground truth de ENTREGA na pasta Z: (status=enviado so diz que chegou no BUCKET).
alter table public.orcamentos_gerados add column if not exists entregue_z_at timestamptz;

-- 2) Heartbeat do daemon (PC do admin). last_tick velho = daemon caido; z_ok=false = Z: fora.
create table if not exists public.sync_heartbeat (
  service           text primary key,
  last_tick         timestamptz not null default now(),
  z_ok              boolean,
  pendentes         integer,
  entregues_ciclo   integer default 0,
  detail            text,
  host              text,
  alert_vendor_nome text,        -- vendors.name que recebe o alerta WA (ex: DANIEL)
  alerted_at        timestamptz,
  alert_recuperado  boolean default true,
  updated_at        timestamptz not null default now()
);
alter table public.sync_heartbeat enable row level security;
drop policy if exists "sync_heartbeat read auth" on public.sync_heartbeat;
create policy "sync_heartbeat read auth" on public.sync_heartbeat for select to authenticated using (true);

-- seed do destinatario do alerta
insert into public.sync_heartbeat (service, alert_vendor_nome, last_tick)
values ('orcamentos-z-sync', 'DANIEL', now())
on conflict (service) do update set alert_vendor_nome = excluded.alert_vendor_nome;

-- 3) Cron server-side: a cada 5 min chama a edge function sync-health-alert,
--    que avisa o WhatsApp do admin se o daemon cair ou o Z: ficar inacessivel.
--    (independe do PC do escritorio estar ligado).
select cron.schedule(
  'sync-health-alert-5min',
  '*/5 * * * *',
  $job$
    select net.http_post(
      url := 'https://flwbeevtvjiouxdjmziv.supabase.co/functions/v1/sync-health-alert',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer branorte-wa-sync-2026'),
      body := '{}'::jsonb
    );
  $job$
);
