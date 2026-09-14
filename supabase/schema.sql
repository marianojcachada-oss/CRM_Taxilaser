-- ============================================================================
-- SCHEMA.SQL — Qué tal? (CRM Taxi Laser)
-- Consolidado de todos los cambios de base de datos hechos en esta
-- sesión de trabajo (originalmente 20 scripts sueltos, sin migraciones
-- versionadas en el repo). Este archivo reemplaza a todos ellos.
--
-- CÓMO USARLO:
--   - Todo acá es idempotente (CREATE OR REPLACE, IF NOT EXISTS,
--     DROP ... IF EXISTS) — es seguro correr el archivo entero de
--     nuevo, las veces que haga falta, sin romper nada.
--   - Si tu base ya tiene todos los cambios aplicados (lo normal, si
--     venís corriendo los scripts sueltos a medida que te los pasaba),
--     correr esto no debería cambiar nada — es más que nada para
--     quedar con UN solo lugar documentado, y para poder reconstruir
--     todo desde cero si alguna vez hace falta (nuevo entorno, etc.).
--   - Las PARTES A-F son estructura (tablas/columnas/funciones/RLS).
--     La PARTE G son migraciones de datos de una sola vez — en una
--     base que ya las corrió, no van a encontrar nada para hacer.
--
-- Sigue habiendo lógica de base (triggers de round robin originales,
-- RLS base, etc.) que se armó ANTES de esta sesión y no está acá — este
-- archivo es un complemento a esa base, no un dump completo del
-- schema. Para eso hace falta correr `supabase db dump` en algún
-- momento y consolidar todo de una vez.
-- ============================================================================


-- ============================================================================
-- PARTE A — Tablas nuevas
-- ============================================================================

-- Errores del navegador (frontend), para verlos en el panel admin sin
-- tener que mirar la consola de cada operador. Los errores de Edge
-- Functions NO pasan por acá — esos ya se ven en Supabase > Edge
-- Functions > (función) > Logs.
create table if not exists app_errors (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  operator_id uuid references operators(id) on delete set null,
  context text,
  message text not null,
  stack text,
  url text,
  user_agent text
);

-- Cooldown de 30 min por número+canal para no repetir el auto-reply de
-- llamada perdida si la misma persona llama varias veces seguidas.
create table if not exists missed_call_auto_replies (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  channel text not null,
  sent_at timestamptz not null default now()
);

create index if not exists idx_missed_call_auto_replies_phone_channel
  on missed_call_auto_replies (phone, channel, sent_at desc);

-- Deduplicación de eventos de TaxiCaller por (job_id, event_type) — si
-- TaxiCaller reintenta el mismo evento, la clave primaria lo frena.
create table if not exists taxicaller_processed_events (
  job_id text not null,
  event_type text not null,
  processed_at timestamptz not null default now(),
  primary key (job_id, event_type)
);


-- ============================================================================
-- PARTE B — Columnas nuevas en tablas existentes
-- ============================================================================

-- operators: rango Superadmin (acceso total; is_admin sigue siendo
-- "entra al panel", ahora con un nivel más arriba).
alter table operators add column if not exists is_superadmin boolean not null default false;

-- contacts: preferencia de canal para avisos automáticos, y
-- cumplimiento STOP (TCPA).
alter table contacts add column if not exists preferred_channels text[] not null default '{}';
comment on column contacts.preferred_channels is
  'Canales elegidos por el operador para los mensajes automáticos de este cliente: whatsapp, sms, facebook, instagram. Vacío = comportamiento anterior (SMS).';

alter table contacts add column if not exists do_not_contact boolean not null default false;
alter table contacts add column if not exists opted_out_at timestamptz;
alter table contacts add column if not exists last_out_of_hours_notice_at timestamptz;

-- conversations: unificación de canales, y distinción entre "sin
-- asignar" y "necesita que alguien lo atienda".
alter table conversations add column if not exists channels_available text[] not null default '{}';
alter table conversations add column if not exists needs_assignment boolean not null default true;

-- missed_calls: de qué canal vino (existía pensada solo para
-- RingCentral, ahora también se usa para WhatsApp).
alter table missed_calls add column if not exists channel text not null default 'ringcentral';


-- ============================================================================
-- PARTE C — Funciones y triggers
-- ============================================================================

-- ---------------------------------------------------------------------
-- C.1 — Pin automático al responder: cualquier mensaje real de un
-- operador humano marca la conversación como "quedate conmigo", para
-- que el cron de cambio de turno no se la saque.
-- ---------------------------------------------------------------------
create or replace function pin_conversation_on_operator_reply()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.sender_type = 'operator' and new.sender_operator_id is not null then
    update conversations
    set keep_with_operator = true
    where id = new.conversation_id
      and keep_with_operator = false;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pin_on_operator_reply on messages;
create trigger trg_pin_on_operator_reply
after insert on messages
for each row
execute function pin_conversation_on_operator_reply();

-- ---------------------------------------------------------------------
-- C.2 — Pin automático al marcar como visto, y se suelta al cerrar (así
-- si se reabre más adelante entra limpia al reparto de nuevo).
-- ---------------------------------------------------------------------
create or replace function set_conversation_pin_state()
returns trigger
language plpgsql
as $$
begin
  if new.unread = false and old.unread = true then
    new.keep_with_operator := true;
  end if;

  if new.status = 'cerrada' and old.status is distinct from 'cerrada' then
    new.keep_with_operator := false;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_conversation_pin_state on conversations;
create trigger trg_conversation_pin_state
before update on conversations
for each row
execute function set_conversation_pin_state();

-- ---------------------------------------------------------------------
-- C.3 — "No disponible" libera TODO lo asignado a ese operador, incluso
-- lo pineado, y le apaga el pin.
-- ---------------------------------------------------------------------
create or replace function release_conversations_on_unavailable()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.presence <> 'available' and old.presence = 'available' then
    update conversations
    set assigned_operator_id = null,
        keep_with_operator = false
    where assigned_operator_id = new.id
      and status <> 'cerrada';
  end if;

  return new;
end;
$$;
-- (el trigger que la usa ya existe apuntando acá — CREATE OR REPLACE alcanza)

-- ---------------------------------------------------------------------
-- C.4 — Reclasifica el estado de la conversación al insertar un
-- mensaje. Los 3 avisos automáticos de TaxiCaller (wait/cancelled/
-- finished) quedan afuera de esta reclasificación — la Edge Function ya
-- dejó el estado correcto (cerrada) y este trigger no lo tiene que
-- pisar. El auto-reply de llamada perdida SÍ pasa por acá normal (queda
-- en esperando_cliente, como un mensaje real de operador).
-- ---------------------------------------------------------------------
create or replace function classify_message_and_update_status()
returns trigger
language plpgsql
security definer
as $$
declare
  body text := lower(coalesce(new.content, ''));
  new_status text;
begin
  if new.automation_type in ('wait', 'cancelled', 'finished') then
    return new;
  end if;

  if new.sender_type = 'operator' then
    new_status := 'esperando_cliente';
  else
    if body ~ '(cancelar|cancelado|cancele|cancelemelo|cancélemelo|cancelenmelo)' then
      new_status := 'cancelacion';

    elsif body ~ '(reclamo|indignante|pésimo|pesimo|desastre|quiero hablar con|denuncia|terrible)'
       or body ~ 'hace\s+\d+\s+(d[ií]a|d[ií]as|hora|horas).*esper'
       or body ~ '!!!' then
      new_status := 'reclamo';

    elsif body ~ '(gracias|perfecto|genial|buen[ií]simo|listo|dale)' and body !~ '\?' then
      new_status := 'cerrada';

    elsif body ~ '\?' and body ~ '(cu[aá]nto|precio|tarifa|cuesta|demora|tarda|direcci[oó]n|a qu[eé] hora)' then
      new_status := 'esperando_informacion';

    else
      new_status := 'esperando_operador';
    end if;
  end if;

  if new_status = 'cerrada' then
    update conversations set status = new_status, unread = false where id = new.conversation_id;
  else
    update conversations set status = new_status where id = new.conversation_id;
  end if;

  return new;
end;
$$;
-- (el trigger que la usa ya existe apuntando acá — CREATE OR REPLACE alcanza)

-- ---------------------------------------------------------------------
-- C.5 — Protección contra auto-escalación a Superadmin. Si hay una
-- sesión de usuario (alguien logueado en la app), exige que quien
-- cambia el campo YA sea superadmin. Si NO hay sesión (SQL Editor,
-- CLI, migraciones), se deja pasar — es el mecanismo de "bootstrap" del
-- primer superadmin.
-- ---------------------------------------------------------------------
create or replace function prevent_superadmin_self_escalation()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.is_superadmin is distinct from old.is_superadmin then
    if auth.uid() is not null and not exists (
      select 1 from operators
      where auth_user_id = auth.uid() and is_superadmin = true
    ) then
      new.is_superadmin := old.is_superadmin;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_superadmin_self_escalation on operators;
create trigger trg_prevent_superadmin_self_escalation
before update on operators
for each row
execute function prevent_superadmin_self_escalation();

-- ---------------------------------------------------------------------
-- C.6 — Borra automáticamente errores de más de 30 días de app_errors,
-- cada vez que se inserta uno nuevo (barato, no necesita cron aparte).
-- ---------------------------------------------------------------------
create or replace function trim_old_app_errors()
returns trigger
language plpgsql
as $$
begin
  delete from app_errors where created_at < now() - interval '30 days';
  return new;
end;
$$;

drop trigger if exists trg_trim_old_app_errors on app_errors;
create trigger trg_trim_old_app_errors
after insert on app_errors
for each statement
execute function trim_old_app_errors();

-- ---------------------------------------------------------------------
-- C.7 y C.8 — Buscar o crear la conversación de un contacto de forma
-- ATÓMICA (advisory lock), para que dos webhooks casi simultáneos
-- nunca puedan crear dos conversaciones duplicadas para el mismo
-- contacto ("chat partido en dos"). La primera es para SMS/WhatsApp
-- (que comparten conversación); la segunda para Facebook/Instagram
-- (canal exacto, sin fusionar).
-- ---------------------------------------------------------------------
create or replace function find_or_create_sms_whatsapp_conversation(
  p_contact_id uuid,
  p_default_channel text
) returns uuid
language plpgsql
security definer
as $$
declare
  v_id uuid;
  v_queue_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext(p_contact_id::text));

  select id into v_id
  from conversations
  where contact_id = p_contact_id
    and channel in ('sms', 'whatsapp')
  order by created_at desc
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  select id into v_queue_id from queues where name = p_default_channel || '_general' limit 1;

  insert into conversations (contact_id, channel, channels_available, queue_id, external_thread_id, unread)
  values (p_contact_id, p_default_channel, array['sms', 'whatsapp'], v_queue_id, null, true)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function find_or_create_channel_conversation(
  p_contact_id uuid,
  p_channel text
) returns uuid
language plpgsql
security definer
as $$
declare
  v_id uuid;
  v_queue_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext(p_contact_id::text || ':' || p_channel));

  select id into v_id
  from conversations
  where contact_id = p_contact_id
    and channel = p_channel
  order by created_at desc
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  select id into v_queue_id from queues where name = p_channel || '_general' limit 1;

  insert into conversations (contact_id, channel, channels_available, queue_id, unread)
  values (p_contact_id, p_channel, array[p_channel], v_queue_id, true)
  returning id into v_id;

  return v_id;
end;
$$;


-- ============================================================================
-- PARTE D — Políticas RLS
-- ============================================================================

alter table app_errors enable row level security;
alter table missed_call_auto_replies enable row level security;
alter table taxicaller_processed_events enable row level security;
-- Estas dos últimas no tienen policies a propósito: solo las tocan las
-- Edge Functions con service_role, que esquivan RLS igual.

drop policy if exists "app_errors_insert_own" on app_errors;
create policy "app_errors_insert_own"
on app_errors for insert
to authenticated
with check (true);

drop policy if exists "app_errors_select_admin" on app_errors;
create policy "app_errors_select_admin"
on app_errors for select
to authenticated
using (
  exists (
    select 1 from operators
    where operators.auth_user_id = auth.uid() and operators.is_admin = true
  )
);

-- Un operador puede actualizar conversaciones ya asignadas a él, o sin
-- asignar dentro de una cola de la que es miembro (para reclamarlas).
drop policy if exists "conversations_update_own" on conversations;
drop policy if exists "conversations_update_own_or_claimable" on conversations;
create policy "conversations_update_own_or_claimable"
on conversations for update
to authenticated
using (
  assigned_operator_id = current_operator_id()
  or (
    assigned_operator_id is null
    and queue_id in (
      select queue_id from queue_members where operator_id = current_operator_id()
    )
  )
)
with check (
  assigned_operator_id = current_operator_id()
  or assigned_operator_id is null
);

-- Integrations: cualquier admin puede LEER, solo superadmin puede
-- escribir/borrar.
drop policy if exists "integration_settings_all_admin" on integration_settings;
drop policy if exists "integration_settings_select_admin" on integration_settings;
create policy "integration_settings_select_admin"
on integration_settings for select
to authenticated
using (
  exists (
    select 1 from operators
    where auth_user_id = auth.uid() and (is_admin = true or is_superadmin = true)
  )
);

drop policy if exists "integration_settings_write_superadmin" on integration_settings;
create policy "integration_settings_write_superadmin"
on integration_settings for insert
to authenticated
with check (
  exists (select 1 from operators where auth_user_id = auth.uid() and is_superadmin = true)
);

drop policy if exists "integration_settings_update_superadmin" on integration_settings;
create policy "integration_settings_update_superadmin"
on integration_settings for update
to authenticated
using (
  exists (select 1 from operators where auth_user_id = auth.uid() and is_superadmin = true)
);

drop policy if exists "integration_settings_delete_superadmin" on integration_settings;
create policy "integration_settings_delete_superadmin"
on integration_settings for delete
to authenticated
using (
  exists (select 1 from operators where auth_user_id = auth.uid() and is_superadmin = true)
);


-- ============================================================================
-- PARTE E — Restricciones de claves foráneas (FK)
-- ============================================================================

-- messages/internal_messages/conversations -> operators: pasan a
-- SET NULL para poder borrar un operador sin que bloquee su historial
-- de mensajes (antes tiraban "violates foreign key constraint").
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'messages_sender_operator_id_fkey') then
    alter table messages drop constraint messages_sender_operator_id_fkey;
  end if;
end $$;
alter table messages alter column sender_operator_id drop not null;
alter table messages
  add constraint messages_sender_operator_id_fkey
  foreign key (sender_operator_id) references operators(id) on delete set null;

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'internal_messages_sender_operator_id_fkey') then
    alter table internal_messages drop constraint internal_messages_sender_operator_id_fkey;
  end if;
end $$;
alter table internal_messages alter column sender_operator_id drop not null;
alter table internal_messages
  add constraint internal_messages_sender_operator_id_fkey
  foreign key (sender_operator_id) references operators(id) on delete set null;

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'conversations_assigned_operator_id_fkey') then
    alter table conversations drop constraint conversations_assigned_operator_id_fkey;
  end if;
end $$;
alter table conversations alter column assigned_operator_id drop not null;
alter table conversations
  add constraint conversations_assigned_operator_id_fkey
  foreign key (assigned_operator_id) references operators(id) on delete set null;


-- ============================================================================
-- PARTE F — Índices
-- ============================================================================

-- Evita mensajes entrantes duplicados si Meta/RingCentral reintentan la
-- entrega del mismo mensaje. Parcial (solo donde no es null) porque los
-- mensajes internos/automáticos no siempre tienen ID externo.
create unique index if not exists idx_messages_external_message_id_unique
  on messages (external_message_id)
  where external_message_id is not null;


-- ============================================================================
-- PARTE G — Migraciones de datos de una sola vez
--
-- En una base que ya viene corriendo estos cambios, este bloque no
-- encuentra nada para hacer. Solo importa si estás reconstruyendo todo
-- desde cero contra un dump viejo de datos.
-- ============================================================================

-- G.1 — Backfill: cada mensaje existente guarda de qué canal vino
-- (necesario antes de fusionar conversaciones, si no se pierde el dato).
update messages m
set sent_via_channel = c.channel
from conversations c
where m.conversation_id = c.id
  and m.sent_via_channel is null;

-- G.2 — Fusiona conversaciones de sms/whatsapp duplicadas por contacto
-- (de cuando SMS y WhatsApp todavía no compartían conversación).
do $$
declare
  r record;
  keep_id uuid;
  d_id uuid;
begin
  for r in (
    select contact_id, array_agg(id) as conv_ids
    from conversations
    where channel in ('sms', 'whatsapp')
    group by contact_id
    having count(*) > 1
  )
  loop
    select c.id into keep_id
    from conversations c
    where c.id = any(r.conv_ids)
    order by
      (select count(*) from messages m where m.conversation_id = c.id) desc,
      coalesce(c.last_message_at, c.created_at) desc
    limit 1;

    foreach d_id in array r.conv_ids
    loop
      continue when d_id = keep_id;

      update messages set conversation_id = keep_id where conversation_id = d_id;

      update conversations k
      set assigned_operator_id = coalesce(k.assigned_operator_id, d.assigned_operator_id),
          keep_with_operator = k.keep_with_operator or d.keep_with_operator,
          unread = k.unread or d.unread,
          last_message_at = greatest(coalesce(k.last_message_at, 'epoch'::timestamptz), coalesce(d.last_message_at, 'epoch'::timestamptz))
      from conversations d
      where k.id = keep_id and d.id = d_id;

      delete from conversations where id = d_id;
    end loop;
  end loop;
end $$;

-- G.3 — SMS y WhatsApp quedan siempre disponibles para mandar. Facebook
-- e Instagram quedan limitados a sí mismos hasta que se vinculen.
update conversations
set channels_available = array['sms', 'whatsapp']
where channel in ('sms', 'whatsapp');

update conversations
set channels_available = array[channel]
where channel in ('facebook', 'instagram') and channels_available = '{}';

-- G.4 — Limpieza de mensajes que ya estaban duplicados antes de que
-- existiera el índice único de la Parte F (se queda con el más viejo).
with duplicados as (
  select
    id,
    row_number() over (
      partition by external_message_id
      order by created_at asc
    ) as posicion
  from messages
  where external_message_id is not null
)
delete from messages
where id in (select id from duplicados where posicion > 1);

-- G.5 — Cierra y desasigna conversaciones que quedaron mal clasificadas
-- en "Sin asignar" antes del fix del trigger de estado (Parte C.4):
-- cualquiera cuyo ÚLTIMO mensaje sea un aviso automático de TaxiCaller.
update conversations c
set status = 'cerrada', unread = false, assigned_operator_id = null, needs_assignment = false
where status <> 'cerrada'
  and (
    select m.automation_type
    from messages m
    where m.conversation_id = c.id
    order by m.created_at desc
    limit 1
  ) in ('wait', 'cancelled', 'finished');


-- ============================================================================
-- PASO MANUAL — hace falta correrlo una vez, con tu propio mail:
--
-- update operators set is_superadmin = true
-- where auth_user_id = (select id from auth.users where email = 'tu-mail@taxilaser.com');
-- ============================================================================
