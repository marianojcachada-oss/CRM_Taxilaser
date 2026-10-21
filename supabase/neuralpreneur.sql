-- =====================================================================
-- Neuralpreneur (IA externa) — base de datos
-- Supabase > SQL Editor. Se puede correr más de una vez (es idempotente).
--
-- Qué hace:
--  1. Columnas de pausa por conversación (ai_paused / ai_resume_at / ai_escalated_at).
--  2. Tabla ai_dispatch_log: registro de lo que se manda a la IA y de lo que ella devuelve.
--  3. Valores iniciales en integration_settings (IA APAGADA y modo prueba PRENDIDO).
--  4. Función neural_pending_messages(): mensajes que esperan respuesta (para la espera en minutos).
--  5. Trigger sobre messages que avisa a la función ai-dispatch. Es a prueba de fallas:
--     si algo sale mal, el mensaje se guarda igual (nunca rompe la entrada de mensajes).
--
-- Con NEURAL_MODE = 'off' el trigger sale en la primera línea y no hace nada.
-- =====================================================================

-- 1) Pausa y asignación a la IA por conversación ---------------------------------------------
alter table conversations add column if not exists ai_paused boolean not null default false;
alter table conversations add column if not exists ai_resume_at timestamptz;
alter table conversations add column if not exists ai_escalated_at timestamptz;
alter table conversations add column if not exists ai_assigned boolean not null default false;  -- asignada a Valeria (IA) desde la bandeja
alter table conversations add column if not exists ai_error text;                          -- por qué la IA no pudo contestar (aviso rojo en el chat)
alter table conversations add column if not exists ai_error_at timestamptz;

-- 2) Registro --------------------------------------------------------------
-- Los ids van como text a propósito: no depende del tipo de id de cada tabla.
create table if not exists ai_dispatch_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  direction text not null check (direction in ('out', 'in')),  -- out = nosotros -> IA, in = IA -> nosotros
  dedupe_key text unique,                                       -- evita duplicados (out:<message_id> / in:<idempotency_key>)
  conversation_id text,
  message_id text,
  status text not null,   -- sent | skipped | failed | replied | escalated | rejected | duplicate
  reason text,
  http_status int,
  detail jsonb
);
create index if not exists idx_ai_dispatch_log_created on ai_dispatch_log (created_at desc);
create index if not exists idx_ai_dispatch_log_conv on ai_dispatch_log (conversation_id, created_at desc);

alter table ai_dispatch_log enable row level security;
drop policy if exists "ai_dispatch_log_select_admin" on ai_dispatch_log;
create policy "ai_dispatch_log_select_admin"
on ai_dispatch_log for select
to authenticated
using (
  exists (
    select 1 from operators
    where operators.auth_user_id = auth.uid()
      and (operators.is_admin = true or operators.is_superadmin = true)
  )
);
-- Escribe solo el backend (service_role), que esquiva RLS.

-- 3) Valores iniciales (no pisa nada que ya exista) -----------------------
insert into integration_settings (key, value, updated_at) values
  ('NEURAL_MODE', 'off', now()),            -- off | on_demand | all
  ('NEURAL_TEST_MODE', 'true', now()),      -- true = solo números de prueba
  ('NEURAL_INTERNAL_SECRET', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), now())
on conflict (key) do nothing;

-- URL interna del proyecto, deducida de la URL del webhook de estado de RingCentral si ya está cargada.
insert into integration_settings (key, value, updated_at)
select 'NEURAL_INTERNAL_URL', regexp_replace(value, '/functions/v1/.*$', ''), now()
from integration_settings
where key = 'RINGCENTRAL_STATUS_WEBHOOK_URL' and coalesce(value, '') like '%/functions/v1/%'
on conflict (key) do nothing;

-- 4) Mensajes que esperan respuesta ---------------------------------------
-- Devuelve el último mensaje de cada conversación cuando es del cliente, tiene entre
-- min_age y max_age de antigüedad y todavía no se le mandó a la IA.
create or replace function neural_pending_messages(min_age interval, max_age interval)
returns table (message_id text, conversation_id text)
language sql
stable
security definer
set search_path = public
as $$
  select m.id::text, m.conversation_id::text
  from conversations c
  join lateral (
    select id, conversation_id, sender_type, created_at
    from messages
    where messages.conversation_id = c.id
    order by created_at desc
    limit 1
  ) m on true
  where c.last_message_at between now() - max_age and now() - min_age
    and c.ai_paused = false
    and m.sender_type = 'contact'
    and not exists (select 1 from ai_dispatch_log l where l.dedupe_key = 'out:' || m.id::text)
  limit 50;
$$;

-- 5) Aviso de mensaje entrante a ai-dispatch -------------------------------
do $$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net no se pudo habilitar: activalo en Database > Extensions. (%)', sqlerrm;
end $$;

create or replace function neural_notify_inbound()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text;
  v_url text;
  v_secret text;
  v_assigned boolean;
begin
  select value into v_mode from integration_settings where key = 'NEURAL_MODE';
  if coalesce(v_mode, 'off') = 'off' then
    return new;
  end if;

  -- En "solo cuando un humano la pide" solo avisa si la conversación está asignada a Valeria.
  if v_mode <> 'all' then
    select ai_assigned into v_assigned from conversations where id = new.conversation_id;
    if not coalesce(v_assigned, false) then
      return new;
    end if;
  end if;

  select value into v_url from integration_settings where key = 'NEURAL_INTERNAL_URL';
  select value into v_secret from integration_settings where key = 'NEURAL_INTERNAL_SECRET';
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    return new;
  end if;

  perform net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/ai-dispatch',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_secret),
    body := jsonb_build_object('message_id', new.id::text, 'trigger', 'inbound'),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  -- Nunca romper el guardado del mensaje por esto.
  return new;
end;
$$;

drop trigger if exists trg_neural_notify_inbound on messages;
create trigger trg_neural_notify_inbound
after insert on messages
for each row
when (new.sender_type = 'contact')
execute function neural_notify_inbound();

-- 6) OPCIONAL — solo si vas a usar "esperar X minutos sin respuesta" ------
-- Cada minuto, ai-dispatch revisa los mensajes que ya cumplieron la espera.
-- Requiere la extensión pg_cron (Database > Extensions). Descomentá y corré una vez:
--
-- select cron.schedule(
--   'neural-sweep', '* * * * *',
--   $$ select net.http_post(
--        url := (select rtrim(value, '/') from integration_settings where key = 'NEURAL_INTERNAL_URL') || '/functions/v1/ai-dispatch',
--        headers := jsonb_build_object('Content-Type', 'application/json',
--                   'x-internal-secret', (select value from integration_settings where key = 'NEURAL_INTERNAL_SECRET')),
--        body := jsonb_build_object('sweep', true),
--        timeout_milliseconds := 5000) $$
-- );
-- Para quitarlo:  select cron.unschedule('neural-sweep');

-- Para deshacer todo lo de arriba (sin tocar mensajes):
-- drop trigger if exists trg_neural_notify_inbound on messages;
-- drop function if exists neural_notify_inbound();
-- drop function if exists neural_pending_messages(interval, interval);
-- drop table if exists ai_dispatch_log;
