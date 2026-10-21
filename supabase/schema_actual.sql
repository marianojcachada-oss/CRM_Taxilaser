


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."assign_conversation_round_robin"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  chosen_operator_id uuid;
  preferred_ok boolean;
begin
  if new.status = 'cerrada' then
    return new;
  end if;

  if new.queue_id is not null and new.assigned_operator_id is null then

    -- Desasignación por "No disponible": no se rellena sola
    if current_setting('app.round_robin_unassign_only', true) = 'on' then
      return new;
    end if;

    -- Un reparto a la vez por cola, así nadie se salta el turno
    perform pg_advisory_xact_lock(hashtext(new.queue_id::text));

    -- Prioridad al operador que ya llevaba este chat (si sigue disponible)
    if new.preferred_operator_id is not null then
      select exists (
        select 1
        from operators o
        join queue_members qm on qm.operator_id = o.id
        where o.id = new.preferred_operator_id
          and qm.queue_id = new.queue_id
          and o.presence = 'available'
          and o.is_active = true
      ) into preferred_ok;

      if preferred_ok then
        chosen_operator_id := new.preferred_operator_id;
      end if;
    end if;

    -- Reparto por turno: al que hace más tiempo que no le toca una
    if chosen_operator_id is null then
      select o.id into chosen_operator_id
      from operators o
      join queue_members qm on qm.operator_id = o.id
      where qm.queue_id = new.queue_id
        and o.presence = 'available'
        and o.is_active = true
      order by o.last_assigned_at asc nulls first, o.id
      limit 1;
    end if;

    if chosen_operator_id is not null then
      new.assigned_operator_id := chosen_operator_id;
      update operators
         set last_assigned_at = clock_timestamp()
       where id = chosen_operator_id;
    end if;

    new.preferred_operator_id := null;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."assign_conversation_round_robin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assign_unassigned_conversations_on_available"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  conv record;
begin
  if new.presence = 'available' and old.presence is distinct from 'available' and new.is_active = true then
    for conv in
      select c.id
      from conversations c
      join queue_members qm on qm.queue_id = c.queue_id and qm.operator_id = new.id
      where c.assigned_operator_id is null
        and c.needs_assignment = true
        and c.status <> 'cerrada'
      order by coalesce(c.last_contact_message_at, c.created_at) asc
    loop
      update conversations
      set assigned_operator_id = null
      where id = conv.id;
    end loop;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."assign_unassigned_conversations_on_available"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_add_preferred_channel"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_contact_id uuid;
  v_channel text := new.sent_via_channel;
begin
  -- Solo mensajes reales del cliente, con canal conocido.
  if new.sender_type <> 'contact' or v_channel is null then
    return new;
  end if;

  select contact_id into v_contact_id
  from conversations
  where id = new.conversation_id;

  if v_contact_id is null then
    return new;
  end if;

  update contacts
  set preferred_channels = array_append(preferred_channels, v_channel)
  where id = v_contact_id
    and not (v_channel = any(preferred_channels)); -- no duplicar si ya estaba

  return new;
end;
$$;


ALTER FUNCTION "public"."auto_add_preferred_channel"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_edit_setting"("p_key" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from operators o
    where o.auth_user_id = auth.uid()
      and (
        o.is_superadmin = true
        or (
          o.is_admin = true
          and (
            select count(*) from role_permissions rp
            where rp.role = 'admin' and rp.allowed = true
              and rp.permission in (
                case when p_key like 'NEURAL\_%' or p_key like 'AI\_%' or p_key like 'CLAUDE\_%'
                     then 'view.admin.ai' else 'view.admin.integrations' end,
                case when p_key like 'NEURAL\_%' or p_key like 'AI\_%' or p_key like 'CLAUDE\_%'
                     then 'edit.admin.ai' else 'edit.admin.integrations' end
              )
          ) = 2
        )
      )
  );
$$;


ALTER FUNCTION "public"."can_edit_setting"("p_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_and_record_missed_call_cooldown"("p_phone" "text", "p_channel" "text", "p_cooldown_minutes" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_last timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext(p_phone || ':' || p_channel));

  select sent_at into v_last
  from missed_call_auto_replies
  where phone = p_phone and channel = p_channel
  order by sent_at desc
  limit 1;

  if v_last is not null and now() - v_last < (p_cooldown_minutes || ' minutes')::interval then
    return false; -- todavía en cooldown, no se manda
  end if;

  insert into missed_call_auto_replies (phone, channel) values (p_phone, p_channel);
  return true; -- se puede mandar
end;
$$;


ALTER FUNCTION "public"."check_and_record_missed_call_cooldown"("p_phone" "text", "p_channel" "text", "p_cooldown_minutes" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."classify_message_and_update_status"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
    if body ~ 'cancel' then
      new_status := 'cancelacion';

    elsif body ~ '(reclamo|indignante|pésimo|pesimo|desastre|quiero hablar con|denuncia|terrible)'
       or body ~ 'hace\s+\d+\s+(d[ií]a|d[ií]as|hora|horas).*esper'
       or body ~ '!!!' then
      new_status := 'reclamo';

    -- Antes esto cerraba la conversación sola ("cerrada") cuando el
    -- cliente agradecía o confirmaba algo — el cierre tiene que ser
    -- siempre una decisión manual del operador, nunca automática por el
    -- contenido del mensaje. Se deja igual clasificado (para no perder la
    -- distinción de "no necesita atención urgente"), pero sin cerrar nada.
    elsif body ~ '(gracias|perfecto|genial|buen[ií]simo|listo|dale)' and body !~ '\?' then
      new_status := 'esperando_operador';

    elsif body ~ '\?' and body ~ '(cu[aá]nto|precio|tarifa|cuesta|demora|tarda|direcci[oó]n|a qu[eé] hora)' then
      new_status := 'esperando_informacion';

    else
      new_status := 'esperando_operador';
    end if;
  end if;

  update conversations set status = new_status where id = new.conversation_id;

  return new;
end;
$$;


ALTER FUNCTION "public"."classify_message_and_update_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."command_center_day"("p_start" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    AS $$
  with m as (
    select conversation_id, sender_type, sender_operator_id, created_at
    from messages
    where created_at >= p_start
      and sender_type in ('contact', 'operator')
  ),
  hrs as (
    select extract(hour from created_at at time zone 'America/New_York')::int as h,
           count(distinct conversation_id)::int as n
    from m
    where sender_type = 'contact'
    group by 1
  ),
  agents as (
    select sender_operator_id as id, count(*)::int as n
    from m
    where sender_type = 'operator' and sender_operator_id is not null
    group by 1
    order by n desc
    limit 8
  ),
  fc as (
    select conversation_id, min(created_at) as t
    from m
    where sender_type = 'contact'
    group by 1
  ),
  fr as (
    select fc.conversation_id, fc.t, min(m.created_at) as r
    from fc
    join m on m.conversation_id = fc.conversation_id
          and m.sender_type = 'operator'
          and m.created_at > fc.t
    group by fc.conversation_id, fc.t
  )
  select jsonb_build_object(
    'inbound',  (select count(*) from m where sender_type = 'contact'),
    'inbound_conversations', (select count(distinct conversation_id) from m where sender_type = 'contact'),
    'outbound', (select count(*) from m where sender_type = 'operator'),
    'inbound_hours', (
      select coalesce(jsonb_agg(coalesce(hrs.n, 0) order by g.h), '[]'::jsonb)
      from generate_series(0, 23) as g(h)
      left join hrs on hrs.h = g.h
    ),
    'agents', (
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'count', n) order by n desc), '[]'::jsonb)
      from agents
    ),
    'avg_response_min', (select avg(extract(epoch from (r - t)) / 60.0) from fr),
    'avg_resolution_min', (
      select avg(extract(epoch from (closed_at - created_at)) / 60.0)
      from conversations
      where closed_at >= p_start
    ),
    'channels', (
      select coalesce(jsonb_object_agg(channel, n), '{}'::jsonb)
      from (
        select channel, count(*)::int as n
        from conversations
        where last_message_at >= p_start
        group by channel
      ) c
    )
  );
$$;


ALTER FUNCTION "public"."command_center_day"("p_start" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_hourly_operator_metrics"("p_hour" timestamp with time zone) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
begin
  insert into hourly_operator_metrics (operator_id, hour_bucket, messages_whatsapp, messages_ringcentral)
  select
    m.sender_operator_id,
    p_hour,
    count(distinct m.conversation_id),
    0
  from messages m
  where m.sender_type = 'operator'
    and m.sender_operator_id is not null
    and (m.sent_via_channel like '%whatsapp%' or m.sent_via_channel like '%sms%')
    and m.created_at >= p_hour and m.created_at < p_hour + interval '1 hour'
  group by m.sender_operator_id
  on conflict (operator_id, hour_bucket) do update set
    messages_whatsapp = excluded.messages_whatsapp,
    messages_ringcentral = excluded.messages_ringcentral,
    computed_at = now();
end;
$$;


ALTER FUNCTION "public"."compute_hourly_operator_metrics"("p_hour" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_hourly_operator_service_metrics"("p_hour" timestamp with time zone) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
begin
  insert into hourly_operator_metrics (operator_id, hour_bucket, services_completed, services_cancelled)
  select
    o.id,
    p_hour,
    count(*) filter (where rh.event_type = 'completed'),
    count(*) filter (where rh.event_type = 'cancelled')
  from ride_history rh
  join operators o
    on (regexp_match(o.operator_code, '\d+'))[1]::int
     = (regexp_match(rh.booked_by, '\d+'))[1]::int
  where rh.booked_by is not null
    and rh.booked_by ~ '\d'
    and o.operator_code ~ '\d'
    and rh.updated_at >= p_hour and rh.updated_at < p_hour + interval '1 hour'
  group by o.id
  on conflict (operator_id, hour_bucket) do update set
    services_completed = excluded.services_completed,
    services_cancelled = excluded.services_cancelled,
    computed_at = now();
end;
$$;


ALTER FUNCTION "public"."compute_hourly_operator_service_metrics"("p_hour" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_hourly_service_metrics"("p_hour" timestamp with time zone) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
begin
  insert into hourly_service_metrics (hour_bucket, services_completed, services_cancelled)
  select
    p_hour,
    count(*) filter (where event_type = 'completed'),
    count(*) filter (where event_type = 'cancelled')
  from ride_history
  where updated_at >= p_hour
    and updated_at < p_hour + interval '1 hour'
  on conflict (hour_bucket) do update set
    services_completed = excluded.services_completed,
    services_cancelled = excluded.services_cancelled,
    computed_at = now();
end;
$$;


ALTER FUNCTION "public"."compute_hourly_service_metrics"("p_hour" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_operator_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE
    AS $$
  select id from operators where auth_user_id = auth.uid()
$$;


ALTER FUNCTION "public"."current_operator_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."decrement_operator_load"("operator_id" "uuid") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  update operators set current_load = greatest(0, current_load - 1) where id = operator_id;
$$;


ALTER FUNCTION "public"."decrement_operator_load"("operator_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."find_or_create_channel_conversation"("p_contact_id" "uuid", "p_channel" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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


ALTER FUNCTION "public"."find_or_create_channel_conversation"("p_contact_id" "uuid", "p_channel" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."find_or_create_sms_whatsapp_conversation"("p_contact_id" "uuid", "p_default_channel" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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


ALTER FUNCTION "public"."find_or_create_sms_whatsapp_conversation"("p_contact_id" "uuid", "p_default_channel" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_auto_logout_enabled"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(
    (select value = 'true' from public.integration_settings where key = 'AUTO_LOGOUT_ENABLED'),
    false
  );
$$;


ALTER FUNCTION "public"."get_auto_logout_enabled"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_operator_load"("operator_id" "uuid") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  update operators set current_load = current_load + 1 where id = operator_id;
$$;


ALTER FUNCTION "public"."increment_operator_load"("operator_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_audit_event"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  actor_id uuid;
  row_id text;
begin
  select id into actor_id from operators where auth_user_id = auth.uid();

  row_id := coalesce(
    (case when TG_OP = 'DELETE' then old.id else new.id end)::text,
    null
  );

  insert into audit_log (actor_operator_id, action, target_table, target_id, details)
  values (
    actor_id,
    lower(TG_OP),
    TG_TABLE_NAME,
    row_id,
    case when TG_OP = 'DELETE' then to_jsonb(old) else to_jsonb(new) end
  );

  return coalesce(new, old);
end;
$$;


ALTER FUNCTION "public"."log_audit_event"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_contact_timeline"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  if new.blocked and not old.blocked then
    insert into contact_timeline (contact_id, event_type, description) values (new.id, 'blocked', 'Contacto bloqueado');
  elsif old.blocked and not new.blocked then
    insert into contact_timeline (contact_id, event_type, description) values (new.id, 'unblocked', 'Contacto desbloqueado');
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."log_contact_timeline"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_conversation_timeline"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_operator_name text;
begin
  if new.assigned_operator_id is distinct from old.assigned_operator_id and new.assigned_operator_id is not null then
    select full_name into v_operator_name from operators where id = new.assigned_operator_id;
    insert into contact_timeline (contact_id, conversation_id, event_type, description)
    values (new.contact_id, new.id, 'assigned', 'Asignado a ' || coalesce(v_operator_name, 'un operador'));
  end if;

  if new.status = 'cerrada' and old.status is distinct from 'cerrada' then
    insert into contact_timeline (contact_id, conversation_id, event_type, description)
    values (new.contact_id, new.id, 'closed', 'Conversación cerrada');
  elsif new.status is distinct from 'cerrada' and old.status = 'cerrada' then
    insert into contact_timeline (contact_id, conversation_id, event_type, description)
    values (new.contact_id, new.id, 'reopened', 'Conversación reabierta');
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."log_conversation_timeline"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_message_timeline"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_contact_id uuid;
  v_channel text;
begin
  if new.sender_type = 'contact' then
    select contact_id, channel into v_contact_id, v_channel
    from conversations where id = new.conversation_id;

    insert into contact_timeline (contact_id, conversation_id, event_type, description)
    values (v_contact_id, new.conversation_id, 'message', 'Mensaje por ' || v_channel);
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."log_message_timeline"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."merge_contacts"("keep_id" "uuid", "merge_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  is_caller_admin boolean;
begin
  select is_admin into is_caller_admin from operators where auth_user_id = auth.uid();
  if not coalesce(is_caller_admin, false) then
    raise exception 'Solo un administrador puede fusionar contactos';
  end if;

  if keep_id = merge_id then
    raise exception 'No se puede fusionar un contacto consigo mismo';
  end if;

  -- Mover las conversaciones del contacto que se descarta
  update conversations set contact_id = keep_id where contact_id = merge_id;

  -- Mover los canales que no estén ya duplicados en el contacto que se conserva
  update contact_channels cc
  set contact_id = keep_id
  where cc.contact_id = merge_id
    and not exists (
      select 1 from contact_channels cc2
      where cc2.contact_id = keep_id and cc2.channel = cc.channel and cc2.external_id = cc.external_id
    );

  -- Lo que haya quedado duplicado, se descarta
  delete from contact_channels where contact_id = merge_id;

  -- Combinar datos: nombre/teléfono que falten, VIP si cualquiera lo era, tags únicas
  update contacts k
  set full_name = coalesce(k.full_name, m.full_name),
      phone = coalesce(k.phone, m.phone),
      vip = k.vip or m.vip,
      tags = (select array(select distinct unnest(k.tags || m.tags)))
  from contacts m
  where k.id = keep_id and m.id = merge_id;

  delete from contacts where id = merge_id;
end;
$$;


ALTER FUNCTION "public"."merge_contacts"("keep_id" "uuid", "merge_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."message_update_conversation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_body            text := lower(coalesce(new.content, ''));
  v_status          text;
  v_conv_assigned   uuid;
  v_conv_queue      uuid;
  v_conv_channel    text;
  v_available       boolean := false;
  v_clear_assigned  boolean := false;
  v_fallback_queue  uuid;
begin
  -- 1) Estado nuevo. Misma regla que classify_message_and_update_status:
  --    los avisos de TaxiCaller (wait / cancelled / finished) no lo cambian.
  if new.automation_type is null or new.automation_type not in ('wait', 'cancelled', 'finished') then
    if new.sender_type = 'operator' then
      v_status := 'esperando_cliente';
    else
      if v_body ~ 'cancel' then
        v_status := 'cancelacion';
      elsif v_body ~ '(reclamo|indignante|pésimo|pesimo|desastre|quiero hablar con|denuncia|terrible)'
         or v_body ~ 'hace\s+\d+\s+(d[ií]a|d[ií]as|hora|horas).*esper'
         or v_body ~ '!!!' then
        v_status := 'reclamo';
      elsif v_body ~ '(gracias|perfecto|genial|buen[ií]simo|listo|dale)' and v_body !~ '\?' then
        v_status := 'esperando_operador';
      elsif v_body ~ '\?' and v_body ~ '(cu[aá]nto|precio|tarifa|cuesta|demora|tarda|direcci[oó]n|a qu[eé] hora)' then
        v_status := 'esperando_informacion';
      else
        v_status := 'esperando_operador';
      end if;
    end if;
  end if;

  -- 2) Mensaje de cliente: cola de respaldo y chequeo del operador asignado
  --    (misma regla que reopen_and_reassign_on_client_message). Si el operador
  --    ya no está disponible se lo saca, y el trigger de round robin de
  --    "conversations" reparte la conversación en este mismo UPDATE.
  if new.sender_type = 'contact' then
    select assigned_operator_id, queue_id, channel
      into v_conv_assigned, v_conv_queue, v_conv_channel
    from conversations where id = new.conversation_id;

    if v_conv_queue is null then
      select id into v_fallback_queue from queues where name = v_conv_channel || '_general' limit 1;
    end if;

    if v_conv_assigned is not null then
      select (presence = 'available' and is_active = true)
        into v_available
      from operators where id = v_conv_assigned;
      v_clear_assigned := not coalesce(v_available, false);
    end if;
  end if;

  -- 3) UN solo UPDATE. Las columnas dependientes del estado actual se calculan
  --    con CASE sobre la propia fila (igual que los UPDATE condicionales de
  --    antes), no con valores leídos antes.
  update conversations
     set status = coalesce(v_status, status),
         unread = case
                    when new.sender_type = 'contact' then true
                    when new.sender_type = 'operator' and new.automation_type is null then false
                    else unread
                  end,
         keep_with_operator = case
                    when new.sender_type = 'operator' and new.sender_operator_id is not null then true
                    else keep_with_operator
                  end,
         snoozed_until = case when new.sender_type = 'contact' then null else snoozed_until end,
         queue_id = coalesce(queue_id, v_fallback_queue),
         assigned_operator_id = case when v_clear_assigned then null else assigned_operator_id end,
         last_message_preview = left(coalesce(new.content, ''), 200),
         last_message_at = new.created_at,
         last_contact_message_at = case
                    when new.sender_type = 'contact' then new.created_at
                    else last_contact_message_at
                  end
   where id = new.conversation_id;

  return new;
end;
$$;


ALTER FUNCTION "public"."message_update_conversation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_replied_conversation_ids"("p_operator_id" "uuid", "p_limit" integer DEFAULT 300) RETURNS TABLE("conversation_id" "uuid")
    LANGUAGE "sql" STABLE
    AS $$
  select m.conversation_id
  from public.messages m
  where m.sender_operator_id = p_operator_id
    and m.conversation_id is not null
  group by m.conversation_id
  order by max(m.created_at) desc
  limit p_limit;
$$;


ALTER FUNCTION "public"."my_replied_conversation_ids"("p_operator_id" "uuid", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."neural_notify_inbound"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."neural_notify_inbound"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."neural_pending_messages"("min_age" interval, "max_age" interval) RETURNS TABLE("message_id" "text", "conversation_id" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."neural_pending_messages"("min_age" interval, "max_age" interval) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pick_next_available_operator"() RETURNS TABLE("id" "uuid", "operator_code" "text", "full_name" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  chosen uuid;
begin
  perform pg_advisory_xact_lock(hashtext('pick_next_available_operator'));

  select o.id into chosen
  from operators o
  where o.presence = 'available' and o.is_active = true
  order by o.last_assigned_at asc nulls first, o.id
  limit 1;

  if chosen is null then
    return;
  end if;

  update operators set last_assigned_at = clock_timestamp() where operators.id = chosen;

  return query
    select o.id, o.operator_code, o.full_name from operators o where o.id = chosen;
end;
$$;


ALTER FUNCTION "public"."pick_next_available_operator"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pin_conversation_on_operator_reply"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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


ALTER FUNCTION "public"."pin_conversation_on_operator_reply"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_superadmin_self_escalation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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


ALTER FUNCTION "public"."prevent_superadmin_self_escalation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_pending_releases"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  p record;
  conv record;
begin
  -- Camino rápido: casi siempre no hay nada pendiente.
  if not exists (select 1 from public.operator_release_pending where release_after <= now()) then
    return;
  end if;

  for p in
    select operator_id
    from public.operator_release_pending
    where release_after <= now()
    for update skip locked
  loop
    delete from public.operator_release_pending where operator_id = p.operator_id;

    -- Si mientras tanto volvió a Disponible, no se mueve nada.
    if exists (select 1 from public.operators where id = p.operator_id and presence <> 'available') then
      for conv in
        select id
        from public.conversations
        where assigned_operator_id = p.operator_id
          and status <> 'cerrada'
        order by coalesce(last_contact_message_at, created_at) asc
      loop
        -- Una sentencia por conversación: el trigger del round robin cuenta la
        -- carga en vivo, así cada una ve las asignaciones anteriores.
        update public.conversations
        set assigned_operator_id = null,
            keep_with_operator = false,
            needs_assignment = true
        where id = conv.id
          and assigned_operator_id = p.operator_id;
      end loop;
    end if;
  end loop;
end;
$$;


ALTER FUNCTION "public"."process_pending_releases"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protect_problem_report"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.id is distinct from old.id
     or new.created_at is distinct from old.created_at
     or new.kind is distinct from old.kind
     or new.message is distinct from old.message
     or new.sender_operator_id is distinct from old.sender_operator_id
     or new.sender_name is distinct from old.sender_name
     or new.sender_code is distinct from old.sender_code
     or new.page_url is distinct from old.page_url
     or new.conversation_id is distinct from old.conversation_id
     or new.user_agent is distinct from old.user_agent then
    raise exception 'Un reporte guardado no se puede modificar (solo su estado y la respuesta).';
  end if;

  if new.status is distinct from old.status then
    new.status_updated_at := now();
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."protect_problem_report"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reassign_on_next_client_message"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  if new.sender_type = 'contact' then
    update conversations
    set assigned_operator_id = assigned_operator_id
    where id = new.conversation_id
      and status <> 'cerrada'
      and assigned_operator_id is null;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."reassign_on_next_client_message"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recompute_operator_load"("op_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  if op_id is null then
    return;
  end if;
  update operators
  set current_load = (
    select count(*) from conversations
    where assigned_operator_id = op_id and status <> 'cerrada'
  )
  where id = op_id;
end;
$$;


ALTER FUNCTION "public"."recompute_operator_load"("op_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_operator_load"() RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  update operators o
     set current_load = c.n
    from (
      select o2.id, count(c.id)::int as n
      from operators o2
      left join conversations c
        on c.assigned_operator_id = o2.id and c.status <> 'cerrada'
      group by o2.id
    ) c
   where c.id = o.id
     and o.current_load is distinct from c.n;
$$;


ALTER FUNCTION "public"."refresh_operator_load"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."release_conversations_on_unavailable"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.presence <> 'available' and old.presence = 'available' then
    insert into public.operator_release_pending (operator_id, release_after)
    values (new.id, now() + interval '10 seconds')
    on conflict (operator_id) do update set release_after = excluded.release_after;
  elsif new.presence = 'available' and old.presence is distinct from 'available' then
    delete from public.operator_release_pending where operator_id = new.id;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."release_conversations_on_unavailable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."release_operator_capacity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  if new.status = 'cerrada'
     and old.status is distinct from 'cerrada'
     and new.assigned_operator_id is not null then

    update operators
    set current_load = greatest(current_load - 1, 0)
    where id = new.assigned_operator_id;

  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."release_operator_capacity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."release_support_on_unavailable"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  if old.presence = 'apoyo' and new.presence is distinct from 'apoyo' then
    update conversation_support
    set active = false, updated_at = now()
    where operator_id = new.id and active = true;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."release_support_on_unavailable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reopen_and_reassign_on_client_message"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  conv record;
  fallback_queue_id uuid;
  assigned_still_available boolean := false;
begin
  -- Mensaje automático (sin operador humano detrás): no se toca nada.
  if new.sender_type = 'operator' and new.sender_operator_id is null then
    return new;
  end if;

  if new.sender_type = 'contact' then
    select * into conv from conversations where id = new.conversation_id;

    select id into fallback_queue_id from queues where name = conv.channel || '_general' limit 1;

    if conv.assigned_operator_id is not null then
      select (presence = 'available' and is_active = true)
        into assigned_still_available
      from operators
      where id = conv.assigned_operator_id;
    end if;

    update conversations
    set unread = true,
        queue_id = coalesce(queue_id, fallback_queue_id),
        assigned_operator_id = case
          -- Estaba cerrada, sin asignar, o el que la tenía ya no está
          -- disponible: vuelve a repartirse entre quien esté disponible ahora.
          when conv.status = 'cerrada'
            or conv.assigned_operator_id is null
            or not coalesce(assigned_still_available, false)
            then null
          -- Sigue en curso con alguien disponible: se queda con esa persona, no salta.
          else conv.assigned_operator_id
        end
    where id = new.conversation_id;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."reopen_and_reassign_on_client_message"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."run_auto_snooze"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
declare
  rule record;
begin
  select * into rule from auto_snooze_settings where id = true;
  if not found or not rule.enabled then
    return;
  end if;

  update conversations
  set snoozed_until = now() + (rule.snooze_duration_minutes || ' minutes')::interval
  where status <> 'cerrada'
    and keep_with_operator = false
    and (snoozed_until is null or snoozed_until < now())
    and last_message_at is not null
    and last_message_at < now() - (rule.inactivity_minutes || ' minutes')::interval;
end;
$$;


ALTER FUNCTION "public"."run_auto_snooze"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."run_hourly_metrics"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_hour timestamptz := date_trunc('hour', now() - interval '1 hour');
begin
  perform compute_hourly_operator_metrics(v_hour);
  perform compute_hourly_service_metrics(v_hour);
  perform compute_hourly_operator_service_metrics(v_hour);
end;
$$;


ALTER FUNCTION "public"."run_hourly_metrics"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."run_shift_reassignment"() RETURNS "void"
    LANGUAGE "sql"
    AS $$
  update conversations
  set assigned_operator_id = null
  where status <> 'cerrada'
    and assigned_operator_id is not null
    and keep_with_operator = false;
$$;


ALTER FUNCTION "public"."run_shift_reassignment"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_all_operators_max_capacity"("p_value" integer) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_count int;
begin
  if not exists (
    select 1 from operators
    where auth_user_id = auth.uid() and (is_admin = true or is_superadmin = true)
  ) then
    raise exception 'Solo un admin puede hacer esto';
  end if;

  update operators set max_capacity = p_value where is_active = true;
  get diagnostics v_count = row_count;

  return v_count;
end;
$$;


ALTER FUNCTION "public"."set_all_operators_max_capacity"("p_value" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_closed_at"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  if new.status = 'cerrada' and old.status is distinct from 'cerrada' then
    new.closed_at := now();
  elsif new.status is distinct from 'cerrada' and old.status = 'cerrada' then
    -- se reabrió: limpiamos closed_at para que no quede una fecha vieja
    new.closed_at := null;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."set_closed_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_conversation_pin_state"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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


ALTER FUNCTION "public"."set_conversation_pin_state"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_conversation_unread_on_message"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.sender_type = 'operator' and new.automation_type is null then
    update public.conversations
       set unread = false
     where id = new.conversation_id
       and unread = true;
  elsif new.sender_type = 'contact' then
    update public.conversations
       set unread = true
     where id = new.conversation_id
       and unread = false;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."set_conversation_unread_on_message"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_ride_history_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_ride_history_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sweep_unassigned_conversations"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  conv record;
begin
  if not exists (
    select 1 from public.conversations
    where assigned_operator_id is null and status <> 'cerrada' and queue_id is not null
  ) then
    return;
  end if;

  for conv in
    select c.id
    from public.conversations c
    where c.assigned_operator_id is null
      and c.status <> 'cerrada'
      and c.queue_id is not null
      and exists (
        select 1
        from public.operators o
        join public.queue_members qm on qm.operator_id = o.id
        where qm.queue_id = c.queue_id
          and o.presence = 'available'
          and o.is_active = true
          and (o.max_capacity is null or o.max_capacity > (
                select count(*) from public.conversations c2
                where c2.assigned_operator_id = o.id and c2.status <> 'cerrada'))
      )
    order by coalesce(c.last_contact_message_at, c.created_at) asc
    limit 20
  loop
    -- Una sentencia por conversación: el trigger del round robin cuenta la
    -- carga en vivo, así cada reparto ve los anteriores.
    update public.conversations
    set assigned_operator_id = null
    where id = conv.id and assigned_operator_id is null;
  end loop;
end;
$$;


ALTER FUNCTION "public"."sweep_unassigned_conversations"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_conversation_channel_on_contact_message"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  if new.sender_type = 'contact'
     and new.sent_via_channel in ('sms', 'whatsapp') then
    update conversations
    set channel = new.sent_via_channel
    where id = new.conversation_id
      and channel in ('sms', 'whatsapp')
      and channel <> new.sent_via_channel;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."sync_conversation_channel_on_contact_message"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_operator_load_on_conversation_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  if tg_op = 'DELETE' then
    perform recompute_operator_load(old.assigned_operator_id);
    return old;
  end if;

  if tg_op = 'INSERT' then
    perform recompute_operator_load(new.assigned_operator_id);
    return new;
  end if;

  if new.assigned_operator_id is distinct from old.assigned_operator_id
     or new.status is distinct from old.status then
    perform recompute_operator_load(old.assigned_operator_id);
    perform recompute_operator_load(new.assigned_operator_id);
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."sync_operator_load_on_conversation_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."track_conversation_support"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_presence text;
  v_assigned uuid;
begin
  if new.sender_type = 'operator' and new.sender_operator_id is not null then
    select presence into v_presence from operators where id = new.sender_operator_id;

    if v_presence = 'apoyo' then
      select assigned_operator_id into v_assigned
      from conversations where id = new.conversation_id;

      -- Solo cuenta como "apoyo" si la conversación es de otro operador
      -- (si por lo que sea el que apoya es también el dueño, no tiene
      -- sentido que se aparezca a sí mismo en su propia bandeja de Apoyo).
      if v_assigned is not null and v_assigned <> new.sender_operator_id then
        insert into conversation_support (conversation_id, operator_id, active, updated_at)
        values (new.conversation_id, new.sender_operator_id, true, now())
        on conflict (conversation_id, operator_id)
        do update set active = true, updated_at = now();
      end if;
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."track_conversation_support"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trim_old_app_errors"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  delete from app_errors where created_at < now() - interval '30 days';
  return new;
end;
$$;


ALTER FUNCTION "public"."trim_old_app_errors"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."unassign_conversations_on_operator_offline"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  perform set_config('app.round_robin_unassign_only', 'on', true);

  update conversations
  set assigned_operator_id = null,
      needs_assignment = true
  where assigned_operator_id = new.id
    and status <> 'cerrada';

  return new;
end;
$$;


ALTER FUNCTION "public"."unassign_conversations_on_operator_offline"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_conversation_on_new_message"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  update conversations
  set last_message_preview = left(coalesce(new.content, ''), 200),
      last_message_at = new.created_at,
      unread = case when new.sender_type = 'contact' then true else unread end,
      last_contact_message_at = case
        when new.sender_type = 'contact' then new.created_at
        else last_contact_message_at
      end
  where id = new.conversation_id;
  return new;
end;
$$;


ALTER FUNCTION "public"."update_conversation_on_new_message"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_ride_dispatch"("p_job_id" "text", "p_contact_id" "uuid", "p_booked_by" "text", "p_created_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
begin
  insert into ride_history (job_id, contact_id, booked_by, event_type, created_at)
  values (p_job_id, p_contact_id, p_booked_by, 'dispatched', coalesce(p_created_at, now()))
  on conflict (job_id) do update set
    contact_id = excluded.contact_id,
    booked_by = excluded.booked_by,
    -- Si llega un p_created_at nuevo (ej: TaxiCaller reenvía el evento
    -- "en camino" con el dato ya bien formado) lo actualiza; si no,
    -- deja el que ya estaba guardado.
    created_at = coalesce(excluded.created_at, ride_history.created_at);
    -- event_type NO se actualiza acá a propósito: lo completa otro
    -- proceso (webhook de cierre/cancelación) y no queremos pisarlo
    -- con 'dispatched' cada vez que se reenvía un evento de despacho.
end;
$$;


ALTER FUNCTION "public"."upsert_ride_dispatch"("p_job_id" "text", "p_contact_id" "uuid", "p_booked_by" "text", "p_created_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."wake_up_on_client_message"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  if new.sender_type = 'contact' then
    update conversations
    set snoozed_until = null
    where id = new.conversation_id and snoozed_until is not null;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."wake_up_on_client_message"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."_snap_writes" (
    "label" "text",
    "taken_at" timestamp with time zone DEFAULT "now"(),
    "relname" "text",
    "ins" bigint,
    "upd" bigint,
    "del" bigint
);


ALTER TABLE "public"."_snap_writes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_conversation_state" (
    "conversation_id" "uuid" NOT NULL,
    "state" "jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ai_conversation_state" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_dispatch_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "direction" "text" NOT NULL,
    "dedupe_key" "text",
    "conversation_id" "text",
    "message_id" "text",
    "status" "text" NOT NULL,
    "reason" "text",
    "http_status" integer,
    "detail" "jsonb",
    CONSTRAINT "ai_dispatch_log_direction_check" CHECK (("direction" = ANY (ARRAY['out'::"text", 'in'::"text"])))
);


ALTER TABLE "public"."ai_dispatch_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_ride_requests" (
    "id" bigint NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "contact_id" "uuid",
    "pickup" "text" NOT NULL,
    "destination" "text",
    "scheduled_for_raw" "text",
    "claimed_by_operator_id" "uuid",
    "claimed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ai_ride_requests" OWNER TO "postgres";


ALTER TABLE "public"."ai_ride_requests" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."ai_ride_requests_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."ai_usage_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid",
    "triggered_by_operator_id" "uuid",
    "mode" "text" DEFAULT 'manual'::"text" NOT NULL,
    "model" "text" NOT NULL,
    "input_tokens" integer DEFAULT 0 NOT NULL,
    "output_tokens" integer DEFAULT 0 NOT NULL,
    "success" boolean DEFAULT true NOT NULL,
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "selected_rule_id" "text",
    "matched_rule_ids" "text"[],
    "conflicts" "jsonb",
    "detected_intents" "text"[],
    CONSTRAINT "ai_usage_log_mode_check" CHECK (("mode" = ANY (ARRAY['manual'::"text", 'auto'::"text"])))
);


ALTER TABLE "public"."ai_usage_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_errors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "operator_id" "uuid",
    "context" "text",
    "message" "text" NOT NULL,
    "stack" "text",
    "url" "text",
    "user_agent" "text"
);


ALTER TABLE "public"."app_errors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "actor_operator_id" "uuid",
    "action" "text" NOT NULL,
    "target_table" "text" NOT NULL,
    "target_id" "text",
    "details" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."auto_snooze_settings" (
    "id" boolean DEFAULT true NOT NULL,
    "enabled" boolean DEFAULT false NOT NULL,
    "inactivity_minutes" integer DEFAULT 1440 NOT NULL,
    "snooze_duration_minutes" integer DEFAULT 60 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "auto_snooze_settings_id_check" CHECK ("id")
);


ALTER TABLE "public"."auto_snooze_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."automation_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "trigger_description" "text" NOT NULL,
    "action_description" "text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."automation_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."campaigns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "channel" "text" NOT NULL,
    "template_id" "uuid",
    "audience_tag" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "campaigns_channel_check" CHECK (("channel" = ANY (ARRAY['whatsapp'::"text", 'facebook'::"text", 'instagram'::"text", 'sms'::"text"]))),
    CONSTRAINT "campaigns_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'scheduled'::"text", 'sent'::"text"])))
);


ALTER TABLE "public"."campaigns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contact_channels" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "contact_id" "uuid" NOT NULL,
    "channel" "text" NOT NULL,
    "external_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "contact_channels_channel_check" CHECK (("channel" = ANY (ARRAY['whatsapp'::"text", 'sms'::"text", 'facebook'::"text", 'instagram'::"text"])))
);


ALTER TABLE "public"."contact_channels" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contact_merge_log" (
    "keeper_id" "uuid",
    "loser_id" "uuid",
    "loser_phone" "text",
    "loser_full_name" "text",
    "merged_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."contact_merge_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contact_timeline" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "contact_id" "uuid" NOT NULL,
    "conversation_id" "uuid",
    "event_type" "text" NOT NULL,
    "description" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."contact_timeline" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "full_name" "text",
    "phone" "text",
    "email" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "vip" boolean DEFAULT false NOT NULL,
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "blocked" boolean DEFAULT false NOT NULL,
    "total_invertido" "text",
    "servicios_completados" integer,
    "servicios_cancelados" integer,
    "notes" "text",
    "has_active_ride" boolean DEFAULT false NOT NULL,
    "active_ride_unit" "text",
    "active_ride_eta_minutes" integer,
    "active_ride_eta_received_at" timestamp with time zone,
    "active_ride_status" "text",
    "active_ride_fare" "text",
    "active_ride_completed_at" timestamp with time zone,
    "preferred_channels" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "do_not_contact" boolean DEFAULT false NOT NULL,
    "opted_out_at" timestamp with time zone,
    "last_out_of_hours_notice_at" timestamp with time zone,
    "active_ride_color" "text",
    "active_ride_plate" "text",
    "active_ride_booked_by" "text"
);


ALTER TABLE "public"."contacts" OWNER TO "postgres";


COMMENT ON COLUMN "public"."contacts"."preferred_channels" IS 'Canales elegidos por el operador para los mensajes automáticos de este cliente: whatsapp, sms, facebook, instagram. Vacío = comportamiento anterior (SMS).';



CREATE TABLE IF NOT EXISTS "public"."conversation_support" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "operator_id" "uuid" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."conversation_support" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "contact_id" "uuid" NOT NULL,
    "channel" "text" NOT NULL,
    "queue_id" "uuid",
    "assigned_operator_id" "uuid",
    "status" "text" DEFAULT 'esperando_operador'::"text" NOT NULL,
    "external_thread_id" "text",
    "last_message_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "unread" boolean DEFAULT true NOT NULL,
    "last_message_preview" "text",
    "team" "text",
    "closed_at" timestamp with time zone,
    "snoozed_until" timestamp with time zone,
    "last_contact_message_at" timestamp with time zone,
    "keep_with_operator" boolean DEFAULT false NOT NULL,
    "channels_available" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "needs_assignment" boolean DEFAULT true NOT NULL,
    "preferred_operator_id" "uuid",
    "ai_paused" boolean DEFAULT false NOT NULL,
    "ai_resume_at" timestamp with time zone,
    "ai_escalated_at" timestamp with time zone,
    "ai_assigned" boolean DEFAULT false NOT NULL,
    CONSTRAINT "conversations_channel_check" CHECK (("channel" = ANY (ARRAY['whatsapp'::"text", 'sms'::"text", 'facebook'::"text", 'instagram'::"text"]))),
    CONSTRAINT "conversations_status_check" CHECK (("status" = ANY (ARRAY['esperando_operador'::"text", 'esperando_informacion'::"text", 'esperando_cliente'::"text", 'reclamo'::"text", 'cancelacion'::"text", 'cerrada'::"text"])))
);


ALTER TABLE "public"."conversations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversations_backup_20260909" (
    "id" "uuid",
    "contact_id" "uuid",
    "channel" "text",
    "queue_id" "uuid",
    "assigned_operator_id" "uuid",
    "status" "text",
    "external_thread_id" "text",
    "last_message_at" timestamp with time zone,
    "created_at" timestamp with time zone,
    "unread" boolean,
    "last_message_preview" "text",
    "team" "text",
    "closed_at" timestamp with time zone,
    "snoozed_until" timestamp with time zone,
    "last_contact_message_at" timestamp with time zone,
    "keep_with_operator" boolean
);


ALTER TABLE "public"."conversations_backup_20260909" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."hourly_operator_metrics" (
    "id" bigint NOT NULL,
    "operator_id" "uuid" NOT NULL,
    "hour_bucket" timestamp with time zone NOT NULL,
    "messages_whatsapp" integer DEFAULT 0 NOT NULL,
    "messages_ringcentral" integer DEFAULT 0 NOT NULL,
    "calls_answered" integer DEFAULT 0 NOT NULL,
    "computed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "services_completed" integer DEFAULT 0 NOT NULL,
    "services_cancelled" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."hourly_operator_metrics" OWNER TO "postgres";


ALTER TABLE "public"."hourly_operator_metrics" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."hourly_operator_metrics_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."hourly_service_metrics" (
    "hour_bucket" timestamp with time zone NOT NULL,
    "services_completed" integer DEFAULT 0 NOT NULL,
    "services_cancelled" integer DEFAULT 0 NOT NULL,
    "computed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."hourly_service_metrics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."integration_settings" (
    "key" "text" NOT NULL,
    "value" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."integration_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."internal_channels" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."internal_channels" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."internal_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "channel_id" "uuid" NOT NULL,
    "sender_operator_id" "uuid",
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."internal_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."message_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."message_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "sender_type" "text" NOT NULL,
    "sender_operator_id" "uuid",
    "content" "text",
    "external_message_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "attachment_url" "text",
    "attachment_name" "text",
    "attachment_kind" "text",
    "sent_via_channel" "text",
    "automation_type" "text",
    "wamid" "text",
    "delivery_status" "text",
    "delivered_at" timestamp with time zone,
    "read_at" timestamp with time zone,
    "rc_message_id" "text",
    "reply_to_message_id" "uuid",
    "reply_to_external_id" "text",
    CONSTRAINT "messages_attachment_kind_check" CHECK (("attachment_kind" = ANY (ARRAY['image'::"text", 'audio'::"text", 'file'::"text"]))),
    CONSTRAINT "messages_sender_type_check" CHECK (("sender_type" = ANY (ARRAY['contact'::"text", 'operator'::"text", 'system'::"text"])))
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."messages_backup_20260909" (
    "id" "uuid",
    "conversation_id" "uuid",
    "sender_type" "text",
    "sender_operator_id" "uuid",
    "content" "text",
    "external_message_id" "text",
    "created_at" timestamp with time zone,
    "attachment_url" "text",
    "attachment_name" "text",
    "attachment_kind" "text",
    "sent_via_channel" "text",
    "automation_type" "text"
);


ALTER TABLE "public"."messages_backup_20260909" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."missed_call_auto_replies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phone" "text" NOT NULL,
    "channel" "text" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."missed_call_auto_replies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."missed_calls" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phone" "text" NOT NULL,
    "contact_id" "uuid",
    "acknowledged" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "channel" "text" DEFAULT 'ringcentral'::"text" NOT NULL
);


ALTER TABLE "public"."missed_calls" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."operator_release_pending" (
    "operator_id" "uuid" NOT NULL,
    "release_after" timestamp with time zone NOT NULL
);


ALTER TABLE "public"."operator_release_pending" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."operators" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "auth_user_id" "uuid",
    "full_name" "text" NOT NULL,
    "email" "text",
    "phone" "text",
    "presence" "text" DEFAULT 'offline'::"text" NOT NULL,
    "max_capacity" integer,
    "current_load" integer DEFAULT 0 NOT NULL,
    "last_assigned_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_admin" boolean DEFAULT false NOT NULL,
    "theme_preference" "text" DEFAULT 'dark'::"text" NOT NULL,
    "operator_code" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "is_superadmin" boolean DEFAULT false NOT NULL,
    "chat_pattern_preference" "text",
    "font_preference" "text",
    "can_view_metrics" boolean DEFAULT false NOT NULL,
    "ringcentral_extension_id" "text",
    "notification_sound" "text",
    CONSTRAINT "operators_presence_check" CHECK (("presence" = ANY (ARRAY['offline'::"text", 'available'::"text", 'busy'::"text", 'apoyo'::"text"])))
);


ALTER TABLE "public"."operators" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."problem_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "kind" "text" DEFAULT 'problema'::"text" NOT NULL,
    "message" "text" NOT NULL,
    "sender_operator_id" "uuid",
    "sender_name" "text" NOT NULL,
    "sender_code" "text",
    "page_url" "text",
    "conversation_id" "uuid",
    "user_agent" "text",
    "status" "text" DEFAULT 'nuevo'::"text" NOT NULL,
    "admin_reply" "text",
    "replied_at" timestamp with time zone,
    "status_updated_at" timestamp with time zone,
    CONSTRAINT "problem_reports_kind_check" CHECK (("kind" = ANY (ARRAY['problema'::"text", 'idea'::"text", 'soporte'::"text"]))),
    CONSTRAINT "problem_reports_message_check" CHECK ((("char_length"("btrim"("message")) >= 1) AND ("char_length"("btrim"("message")) <= 4000))),
    CONSTRAINT "problem_reports_status_check" CHECK (("status" = ANY (ARRAY['nuevo'::"text", 'en_revision'::"text", 'resuelto'::"text"])))
);


ALTER TABLE "public"."problem_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."queue_members" (
    "queue_id" "uuid" NOT NULL,
    "operator_id" "uuid" NOT NULL
);


ALTER TABLE "public"."queue_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."queues" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "assignment_method" "text" DEFAULT 'round_robin'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "queues_assignment_method_check" CHECK (("assignment_method" = ANY (ARRAY['round_robin'::"text", 'highest_capacity'::"text"])))
);


ALTER TABLE "public"."queues" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ride_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "contact_id" "uuid" NOT NULL,
    "job_id" "text",
    "event_type" "text" NOT NULL,
    "vehicle_unit" "text",
    "fare" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "booked_by" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ride_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."role_permissions" (
    "role" "text" NOT NULL,
    "permission" "text" NOT NULL,
    "allowed" boolean NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    CONSTRAINT "role_permissions_role_check" CHECK (("role" = ANY (ARRAY['operador'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."role_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."taxicaller_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "unit_id" "text" NOT NULL,
    "plate" "text",
    "driver_name" "text",
    "job_status" "text" NOT NULL,
    "contact_phone" "text",
    "notification_sent" boolean DEFAULT false NOT NULL,
    "notification_channel" "text",
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "taxicaller_events_notification_channel_check" CHECK (("notification_channel" = ANY (ARRAY['sms'::"text", 'whatsapp'::"text"])))
);


ALTER TABLE "public"."taxicaller_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."taxicaller_processed_events" (
    "job_id" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "processed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."taxicaller_processed_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plate" "text" NOT NULL,
    "make" "text",
    "color" "text",
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."vehicles" OWNER TO "postgres";


ALTER TABLE ONLY "public"."ai_conversation_state"
    ADD CONSTRAINT "ai_conversation_state_pkey" PRIMARY KEY ("conversation_id");



ALTER TABLE ONLY "public"."ai_dispatch_log"
    ADD CONSTRAINT "ai_dispatch_log_dedupe_key_key" UNIQUE ("dedupe_key");



ALTER TABLE ONLY "public"."ai_dispatch_log"
    ADD CONSTRAINT "ai_dispatch_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_ride_requests"
    ADD CONSTRAINT "ai_ride_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_usage_log"
    ADD CONSTRAINT "ai_usage_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_errors"
    ADD CONSTRAINT "app_errors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."auto_snooze_settings"
    ADD CONSTRAINT "auto_snooze_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."automation_rules"
    ADD CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contact_channels"
    ADD CONSTRAINT "contact_channels_channel_external_id_key" UNIQUE ("channel", "external_id");



ALTER TABLE ONLY "public"."contact_channels"
    ADD CONSTRAINT "contact_channels_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contact_timeline"
    ADD CONSTRAINT "contact_timeline_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_phone_key" UNIQUE ("phone");



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversation_support"
    ADD CONSTRAINT "conversation_support_conversation_id_operator_id_key" UNIQUE ("conversation_id", "operator_id");



ALTER TABLE ONLY "public"."conversation_support"
    ADD CONSTRAINT "conversation_support_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hourly_operator_metrics"
    ADD CONSTRAINT "hourly_operator_metrics_operator_id_hour_bucket_key" UNIQUE ("operator_id", "hour_bucket");



ALTER TABLE ONLY "public"."hourly_operator_metrics"
    ADD CONSTRAINT "hourly_operator_metrics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hourly_service_metrics"
    ADD CONSTRAINT "hourly_service_metrics_pkey" PRIMARY KEY ("hour_bucket");



ALTER TABLE ONLY "public"."integration_settings"
    ADD CONSTRAINT "integration_settings_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."internal_channels"
    ADD CONSTRAINT "internal_channels_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."internal_channels"
    ADD CONSTRAINT "internal_channels_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."internal_messages"
    ADD CONSTRAINT "internal_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."message_templates"
    ADD CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."missed_call_auto_replies"
    ADD CONSTRAINT "missed_call_auto_replies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."missed_calls"
    ADD CONSTRAINT "missed_calls_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."operator_release_pending"
    ADD CONSTRAINT "operator_release_pending_pkey" PRIMARY KEY ("operator_id");



ALTER TABLE ONLY "public"."operators"
    ADD CONSTRAINT "operators_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."problem_reports"
    ADD CONSTRAINT "problem_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."queue_members"
    ADD CONSTRAINT "queue_members_pkey" PRIMARY KEY ("queue_id", "operator_id");



ALTER TABLE ONLY "public"."queues"
    ADD CONSTRAINT "queues_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."queues"
    ADD CONSTRAINT "queues_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ride_history"
    ADD CONSTRAINT "ride_history_job_id_key" UNIQUE ("job_id");



ALTER TABLE ONLY "public"."ride_history"
    ADD CONSTRAINT "ride_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role", "permission");



ALTER TABLE ONLY "public"."taxicaller_events"
    ADD CONSTRAINT "taxicaller_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."taxicaller_processed_events"
    ADD CONSTRAINT "taxicaller_processed_events_pkey" PRIMARY KEY ("job_id", "event_type");



ALTER TABLE ONLY "public"."vehicles"
    ADD CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicles"
    ADD CONSTRAINT "vehicles_plate_key" UNIQUE ("plate");



CREATE INDEX "hourly_operator_metrics_hour_idx" ON "public"."hourly_operator_metrics" USING "btree" ("hour_bucket");



CREATE INDEX "idx_ai_conversation_state_updated_at" ON "public"."ai_conversation_state" USING "btree" ("updated_at");



CREATE INDEX "idx_ai_dispatch_log_conv" ON "public"."ai_dispatch_log" USING "btree" ("conversation_id", "created_at" DESC);



CREATE INDEX "idx_ai_dispatch_log_created" ON "public"."ai_dispatch_log" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_ai_ride_requests_unclaimed" ON "public"."ai_ride_requests" USING "btree" ("created_at") WHERE ("claimed_by_operator_id" IS NULL);



CREATE INDEX "idx_ai_usage_log_created_at" ON "public"."ai_usage_log" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_contact_channels_lookup" ON "public"."contact_channels" USING "btree" ("channel", "external_id");



CREATE INDEX "idx_contact_timeline_contact" ON "public"."contact_timeline" USING "btree" ("contact_id", "created_at" DESC);



CREATE INDEX "idx_contacts_full_name" ON "public"."contacts" USING "btree" ("full_name");



CREATE INDEX "idx_contacts_phone" ON "public"."contacts" USING "btree" ("phone");



CREATE INDEX "idx_conversation_support_operator_active" ON "public"."conversation_support" USING "btree" ("operator_id") WHERE "active";



CREATE INDEX "idx_conversations_assigned_operator" ON "public"."conversations" USING "btree" ("assigned_operator_id");



CREATE INDEX "idx_conversations_channel" ON "public"."conversations" USING "btree" ("channel");



CREATE INDEX "idx_conversations_contact_id" ON "public"."conversations" USING "btree" ("contact_id");



CREATE INDEX "idx_conversations_contact_status" ON "public"."conversations" USING "btree" ("contact_id", "status", "created_at" DESC);



CREATE INDEX "idx_conversations_operator" ON "public"."conversations" USING "btree" ("assigned_operator_id", "status");



CREATE INDEX "idx_conversations_queue" ON "public"."conversations" USING "btree" ("queue_id", "status");



CREATE INDEX "idx_conversations_status_last_message" ON "public"."conversations" USING "btree" ("status", "last_message_at" DESC);



CREATE INDEX "idx_internal_messages_channel" ON "public"."internal_messages" USING "btree" ("channel_id", "created_at");



CREATE INDEX "idx_messages_content_trgm" ON "public"."messages" USING "gin" ("content" "public"."gin_trgm_ops");



CREATE INDEX "idx_messages_conversation" ON "public"."messages" USING "btree" ("conversation_id", "created_at");



CREATE INDEX "idx_messages_conversation_created" ON "public"."messages" USING "btree" ("conversation_id", "created_at");



CREATE UNIQUE INDEX "idx_messages_external_message_id_unique" ON "public"."messages" USING "btree" ("external_message_id") WHERE ("external_message_id" IS NOT NULL);



CREATE INDEX "idx_messages_sender_operator" ON "public"."messages" USING "btree" ("sender_operator_id", "conversation_id", "created_at") WHERE ("sender_operator_id" IS NOT NULL);



CREATE INDEX "idx_messages_wamid" ON "public"."messages" USING "btree" ("wamid") WHERE ("wamid" IS NOT NULL);



CREATE INDEX "idx_missed_call_auto_replies_phone_channel" ON "public"."missed_call_auto_replies" USING "btree" ("phone", "channel", "sent_at" DESC);



CREATE INDEX "idx_ride_history_contact" ON "public"."ride_history" USING "btree" ("contact_id", "created_at" DESC);



CREATE UNIQUE INDEX "messages_rc_message_id_idx" ON "public"."messages" USING "btree" ("rc_message_id") WHERE ("rc_message_id" IS NOT NULL);



CREATE INDEX "problem_reports_created_idx" ON "public"."problem_reports" USING "btree" ("created_at" DESC);



CREATE INDEX "problem_reports_sender_idx" ON "public"."problem_reports" USING "btree" ("sender_operator_id", "created_at" DESC);



CREATE INDEX "problem_reports_status_idx" ON "public"."problem_reports" USING "btree" ("status");



CREATE OR REPLACE TRIGGER "trg_assign_unassigned_on_available" AFTER UPDATE ON "public"."operators" FOR EACH ROW EXECUTE FUNCTION "public"."assign_unassigned_conversations_on_available"();



CREATE OR REPLACE TRIGGER "trg_audit_automation_rules" AFTER INSERT OR DELETE OR UPDATE ON "public"."automation_rules" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit_event"();



CREATE OR REPLACE TRIGGER "trg_audit_campaigns" AFTER INSERT OR DELETE OR UPDATE ON "public"."campaigns" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit_event"();



CREATE OR REPLACE TRIGGER "trg_audit_operators" AFTER INSERT OR DELETE OR UPDATE ON "public"."operators" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit_event"();



CREATE OR REPLACE TRIGGER "trg_audit_templates" AFTER INSERT OR DELETE OR UPDATE ON "public"."message_templates" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit_event"();



CREATE OR REPLACE TRIGGER "trg_auto_add_preferred_channel" AFTER INSERT ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."auto_add_preferred_channel"();



CREATE OR REPLACE TRIGGER "trg_conversation_pin_state" BEFORE UPDATE ON "public"."conversations" FOR EACH ROW EXECUTE FUNCTION "public"."set_conversation_pin_state"();



CREATE OR REPLACE TRIGGER "trg_log_contact_timeline" AFTER UPDATE ON "public"."contacts" FOR EACH ROW EXECUTE FUNCTION "public"."log_contact_timeline"();



CREATE OR REPLACE TRIGGER "trg_log_conversation_timeline" AFTER UPDATE ON "public"."conversations" FOR EACH ROW EXECUTE FUNCTION "public"."log_conversation_timeline"();



CREATE OR REPLACE TRIGGER "trg_log_message_timeline" AFTER INSERT ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."log_message_timeline"();



CREATE OR REPLACE TRIGGER "trg_message_update_conversation" AFTER INSERT ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."message_update_conversation"();



CREATE OR REPLACE TRIGGER "trg_neural_notify_inbound" AFTER INSERT ON "public"."messages" FOR EACH ROW WHEN (("new"."sender_type" = 'contact'::"text")) EXECUTE FUNCTION "public"."neural_notify_inbound"();



CREATE OR REPLACE TRIGGER "trg_prevent_superadmin_self_escalation" BEFORE UPDATE ON "public"."operators" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_superadmin_self_escalation"();



CREATE OR REPLACE TRIGGER "trg_protect_problem_report" BEFORE UPDATE ON "public"."problem_reports" FOR EACH ROW EXECUTE FUNCTION "public"."protect_problem_report"();



CREATE OR REPLACE TRIGGER "trg_release_on_unavailable" AFTER UPDATE ON "public"."operators" FOR EACH ROW EXECUTE FUNCTION "public"."release_conversations_on_unavailable"();



CREATE OR REPLACE TRIGGER "trg_release_support_on_unavailable" AFTER UPDATE ON "public"."operators" FOR EACH ROW EXECUTE FUNCTION "public"."release_support_on_unavailable"();



CREATE OR REPLACE TRIGGER "trg_ride_history_updated_at" BEFORE UPDATE ON "public"."ride_history" FOR EACH ROW EXECUTE FUNCTION "public"."set_ride_history_updated_at"();



CREATE OR REPLACE TRIGGER "trg_round_robin" BEFORE INSERT OR UPDATE OF "assigned_operator_id" ON "public"."conversations" FOR EACH ROW EXECUTE FUNCTION "public"."assign_conversation_round_robin"();



CREATE OR REPLACE TRIGGER "trg_set_closed_at" BEFORE UPDATE ON "public"."conversations" FOR EACH ROW EXECUTE FUNCTION "public"."set_closed_at"();



CREATE OR REPLACE TRIGGER "trg_sync_conversation_channel" AFTER INSERT ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."sync_conversation_channel_on_contact_message"();



CREATE OR REPLACE TRIGGER "trg_track_conversation_support" AFTER INSERT ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."track_conversation_support"();



CREATE OR REPLACE TRIGGER "trg_trim_old_app_errors" AFTER INSERT ON "public"."app_errors" FOR EACH STATEMENT EXECUTE FUNCTION "public"."trim_old_app_errors"();



CREATE OR REPLACE TRIGGER "trg_unassign_on_offline" AFTER UPDATE OF "presence" ON "public"."operators" FOR EACH ROW WHEN ((("new"."presence" = 'offline'::"text") AND ("old"."presence" IS DISTINCT FROM 'offline'::"text"))) EXECUTE FUNCTION "public"."unassign_conversations_on_operator_offline"();



ALTER TABLE ONLY "public"."ai_conversation_state"
    ADD CONSTRAINT "ai_conversation_state_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_ride_requests"
    ADD CONSTRAINT "ai_ride_requests_claimed_by_operator_id_fkey" FOREIGN KEY ("claimed_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_ride_requests"
    ADD CONSTRAINT "ai_ride_requests_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_ride_requests"
    ADD CONSTRAINT "ai_ride_requests_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_usage_log"
    ADD CONSTRAINT "ai_usage_log_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_usage_log"
    ADD CONSTRAINT "ai_usage_log_triggered_by_operator_id_fkey" FOREIGN KEY ("triggered_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."app_errors"
    ADD CONSTRAINT "app_errors_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_actor_operator_id_fkey" FOREIGN KEY ("actor_operator_id") REFERENCES "public"."operators"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."message_templates"("id");



ALTER TABLE ONLY "public"."contact_channels"
    ADD CONSTRAINT "contact_channels_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contact_timeline"
    ADD CONSTRAINT "contact_timeline_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contact_timeline"
    ADD CONSTRAINT "contact_timeline_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."conversation_support"
    ADD CONSTRAINT "conversation_support_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_support"
    ADD CONSTRAINT "conversation_support_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_assigned_operator_id_fkey" FOREIGN KEY ("assigned_operator_id") REFERENCES "public"."operators"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "public"."queues"("id");



ALTER TABLE ONLY "public"."hourly_operator_metrics"
    ADD CONSTRAINT "hourly_operator_metrics_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."internal_messages"
    ADD CONSTRAINT "internal_messages_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "public"."internal_channels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."internal_messages"
    ADD CONSTRAINT "internal_messages_sender_operator_id_fkey" FOREIGN KEY ("sender_operator_id") REFERENCES "public"."operators"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_reply_to_message_id_fkey" FOREIGN KEY ("reply_to_message_id") REFERENCES "public"."messages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_sender_operator_id_fkey" FOREIGN KEY ("sender_operator_id") REFERENCES "public"."operators"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."missed_calls"
    ADD CONSTRAINT "missed_calls_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id");



ALTER TABLE ONLY "public"."operator_release_pending"
    ADD CONSTRAINT "operator_release_pending_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."operators"
    ADD CONSTRAINT "operators_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."problem_reports"
    ADD CONSTRAINT "problem_reports_sender_operator_id_fkey" FOREIGN KEY ("sender_operator_id") REFERENCES "public"."operators"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."queue_members"
    ADD CONSTRAINT "queue_members_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."queue_members"
    ADD CONSTRAINT "queue_members_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "public"."queues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ride_history"
    ADD CONSTRAINT "ride_history_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE CASCADE;



ALTER TABLE "public"."_snap_writes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_conversation_state" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_dispatch_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ai_dispatch_log_select_admin" ON "public"."ai_dispatch_log" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."operators"
  WHERE (("operators"."auth_user_id" = "auth"."uid"()) AND (("operators"."is_admin" = true) OR ("operators"."is_superadmin" = true))))));



ALTER TABLE "public"."ai_ride_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_usage_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ai_usage_log_select_superadmin" ON "public"."ai_usage_log" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."operators"
  WHERE (("operators"."auth_user_id" = "auth"."uid"()) AND ("operators"."is_superadmin" = true)))));



ALTER TABLE "public"."app_errors" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "app_errors_insert_own" ON "public"."app_errors" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "app_errors_select_admin" ON "public"."app_errors" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."operators"
  WHERE (("operators"."auth_user_id" = "auth"."uid"()) AND ("operators"."is_admin" = true)))));



ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_log_select_admin" ON "public"."audit_log" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."operators"
  WHERE (("operators"."auth_user_id" = "auth"."uid"()) AND "operators"."is_admin"))));



ALTER TABLE "public"."auto_snooze_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "auto_snooze_settings_select_authenticated" ON "public"."auto_snooze_settings" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "auto_snooze_settings_update_admin" ON "public"."auto_snooze_settings" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."operators"
  WHERE (("operators"."auth_user_id" = "auth"."uid"()) AND ("operators"."is_admin" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."operators"
  WHERE (("operators"."auth_user_id" = "auth"."uid"()) AND ("operators"."is_admin" = true)))));



ALTER TABLE "public"."automation_rules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "automation_rules_all_admin" ON "public"."automation_rules" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."operators"
  WHERE (("operators"."auth_user_id" = "auth"."uid"()) AND "operators"."is_admin")))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."operators"
  WHERE (("operators"."auth_user_id" = "auth"."uid"()) AND "operators"."is_admin"))));



ALTER TABLE "public"."campaigns" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "campaigns_all_admin" ON "public"."campaigns" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."operators"
  WHERE (("operators"."auth_user_id" = "auth"."uid"()) AND "operators"."is_admin")))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."operators"
  WHERE (("operators"."auth_user_id" = "auth"."uid"()) AND "operators"."is_admin"))));



ALTER TABLE "public"."contact_channels" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contact_channels_select_authenticated" ON "public"."contact_channels" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."contact_merge_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."contact_timeline" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contact_timeline_insert_authenticated" ON "public"."contact_timeline" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "contact_timeline_select_authenticated" ON "public"."contact_timeline" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."contacts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contacts_select_authenticated" ON "public"."contacts" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "contacts_update_authenticated" ON "public"."contacts" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."conversation_support" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "conversation_support_insert" ON "public"."conversation_support" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "conversation_support_select" ON "public"."conversation_support" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "conversation_support_update" ON "public"."conversation_support" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."conversations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."conversations_backup_20260909" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "conversations_delete_admin" ON "public"."conversations" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."operators"
  WHERE (("operators"."auth_user_id" = "auth"."uid"()) AND (("operators"."is_admin" = true) OR ("operators"."is_superadmin" = true))))));



CREATE POLICY "conversations_delete_admin_only" ON "public"."conversations" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."operators"
  WHERE (("operators"."auth_user_id" = "auth"."uid"()) AND "operators"."is_admin"))));



CREATE POLICY "conversations_select_all_authenticated" ON "public"."conversations" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "conversations_update_all_authenticated" ON "public"."conversations" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "conversations_update_own_or_claimable" ON "public"."conversations" FOR UPDATE TO "authenticated" USING ((("assigned_operator_id" = "public"."current_operator_id"()) OR (("assigned_operator_id" IS NULL) AND ("queue_id" IN ( SELECT "queue_members"."queue_id"
   FROM "public"."queue_members"
  WHERE ("queue_members"."operator_id" = "public"."current_operator_id"())))))) WITH CHECK ((("assigned_operator_id" = "public"."current_operator_id"()) OR ("assigned_operator_id" IS NULL)));



ALTER TABLE "public"."hourly_operator_metrics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."hourly_service_metrics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."integration_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "integration_settings_delete_superadmin" ON "public"."integration_settings" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."operators"
  WHERE (("operators"."auth_user_id" = "auth"."uid"()) AND ("operators"."is_superadmin" = true)))));



CREATE POLICY "integration_settings_insert_by_permission" ON "public"."integration_settings" FOR INSERT TO "authenticated" WITH CHECK ("public"."can_edit_setting"("key"));



CREATE POLICY "integration_settings_select_admin" ON "public"."integration_settings" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."operators"
  WHERE (("operators"."auth_user_id" = "auth"."uid"()) AND (("operators"."is_admin" = true) OR ("operators"."is_superadmin" = true))))));



CREATE POLICY "integration_settings_select_public_flags" ON "public"."integration_settings" FOR SELECT TO "authenticated" USING (("key" = 'MISSED_CALLS_COUNTER_ENABLED'::"text"));



CREATE POLICY "integration_settings_update_by_permission" ON "public"."integration_settings" FOR UPDATE TO "authenticated" USING ("public"."can_edit_setting"("key")) WITH CHECK ("public"."can_edit_setting"("key"));



CREATE POLICY "integration_settings_update_superadmin" ON "public"."integration_settings" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."operators"
  WHERE (("operators"."auth_user_id" = "auth"."uid"()) AND ("operators"."is_superadmin" = true)))));



CREATE POLICY "integration_settings_write_superadmin" ON "public"."integration_settings" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."operators"
  WHERE (("operators"."auth_user_id" = "auth"."uid"()) AND ("operators"."is_superadmin" = true)))));



ALTER TABLE "public"."internal_channels" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "internal_channels_select_authenticated" ON "public"."internal_channels" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."internal_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "internal_messages_insert_own" ON "public"."internal_messages" FOR INSERT TO "authenticated" WITH CHECK (("sender_operator_id" IN ( SELECT "operators"."id"
   FROM "public"."operators"
  WHERE ("operators"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "internal_messages_select_authenticated" ON "public"."internal_messages" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."message_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."messages_backup_20260909" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "messages_insert_own" ON "public"."messages" FOR INSERT TO "authenticated" WITH CHECK ((("sender_type" = 'operator'::"text") AND ("sender_operator_id" IN ( SELECT "operators"."id"
   FROM "public"."operators"
  WHERE ("operators"."auth_user_id" = "auth"."uid"())))));



CREATE POLICY "messages_select_all_authenticated" ON "public"."messages" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "metrics_select_permitted_operators" ON "public"."hourly_operator_metrics" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."operators" "o"
  WHERE (("o"."auth_user_id" = "auth"."uid"()) AND ("o"."can_view_metrics" OR "o"."is_admin" OR "o"."is_superadmin")))));



CREATE POLICY "metrics_select_permitted_operators" ON "public"."hourly_service_metrics" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."operators" "o"
  WHERE (("o"."auth_user_id" = "auth"."uid"()) AND ("o"."can_view_metrics" OR "o"."is_admin" OR "o"."is_superadmin")))));



ALTER TABLE "public"."missed_call_auto_replies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."missed_calls" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "missed_calls_select_authenticated" ON "public"."missed_calls" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "missed_calls_update_authenticated" ON "public"."missed_calls" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."operator_release_pending" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."operators" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "operators_select_all_authenticated" ON "public"."operators" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "operators_update_admin" ON "public"."operators" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."operators" "o"
  WHERE (("o"."auth_user_id" = "auth"."uid"()) AND ("o"."is_admin" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."operators" "o"
  WHERE (("o"."auth_user_id" = "auth"."uid"()) AND ("o"."is_admin" = true)))));



CREATE POLICY "operators_update_self" ON "public"."operators" FOR UPDATE TO "authenticated" USING (("auth_user_id" = "auth"."uid"())) WITH CHECK (("auth_user_id" = "auth"."uid"()));



ALTER TABLE "public"."problem_reports" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "problem_reports_insert_own" ON "public"."problem_reports" FOR INSERT TO "authenticated" WITH CHECK (("sender_operator_id" = ( SELECT "o"."id"
   FROM "public"."operators" "o"
  WHERE ("o"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "problem_reports_select" ON "public"."problem_reports" FOR SELECT TO "authenticated" USING ((("sender_operator_id" = ( SELECT "o"."id"
   FROM "public"."operators" "o"
  WHERE ("o"."auth_user_id" = "auth"."uid"()))) OR (EXISTS ( SELECT 1
   FROM "public"."operators" "o"
  WHERE (("o"."auth_user_id" = "auth"."uid"()) AND ("o"."is_superadmin" = true))))));



CREATE POLICY "problem_reports_update_superadmin" ON "public"."problem_reports" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."operators" "o"
  WHERE (("o"."auth_user_id" = "auth"."uid"()) AND ("o"."is_superadmin" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."operators" "o"
  WHERE (("o"."auth_user_id" = "auth"."uid"()) AND ("o"."is_superadmin" = true)))));



ALTER TABLE "public"."queue_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "queue_members_select_authenticated" ON "public"."queue_members" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."queues" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "queues_select_authenticated" ON "public"."queues" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."ride_history" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ride_history_select_authenticated" ON "public"."ride_history" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."role_permissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "role_permissions_read" ON "public"."role_permissions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "role_permissions_write" ON "public"."role_permissions" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."operators"
  WHERE (("operators"."auth_user_id" = "auth"."uid"()) AND ("operators"."is_superadmin" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."operators"
  WHERE (("operators"."auth_user_id" = "auth"."uid"()) AND ("operators"."is_superadmin" = true)))));



ALTER TABLE "public"."taxicaller_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."taxicaller_processed_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "templates_all_admin" ON "public"."message_templates" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."operators"
  WHERE (("operators"."auth_user_id" = "auth"."uid"()) AND "operators"."is_admin")))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."operators"
  WHERE (("operators"."auth_user_id" = "auth"."uid"()) AND "operators"."is_admin"))));



CREATE POLICY "templates_select_authenticated" ON "public"."message_templates" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."vehicles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vehicles_select_authenticated" ON "public"."vehicles" FOR SELECT TO "authenticated" USING (true);





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."conversations";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."internal_messages";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."messages";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."missed_calls";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."operators";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."problem_reports";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "service_role";











































































































































































GRANT ALL ON FUNCTION "public"."assign_conversation_round_robin"() TO "anon";
GRANT ALL ON FUNCTION "public"."assign_conversation_round_robin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_conversation_round_robin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."assign_unassigned_conversations_on_available"() TO "anon";
GRANT ALL ON FUNCTION "public"."assign_unassigned_conversations_on_available"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_unassigned_conversations_on_available"() TO "service_role";



GRANT ALL ON FUNCTION "public"."auto_add_preferred_channel"() TO "anon";
GRANT ALL ON FUNCTION "public"."auto_add_preferred_channel"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_add_preferred_channel"() TO "service_role";



GRANT ALL ON FUNCTION "public"."can_edit_setting"("p_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."can_edit_setting"("p_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_edit_setting"("p_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_and_record_missed_call_cooldown"("p_phone" "text", "p_channel" "text", "p_cooldown_minutes" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."check_and_record_missed_call_cooldown"("p_phone" "text", "p_channel" "text", "p_cooldown_minutes" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_and_record_missed_call_cooldown"("p_phone" "text", "p_channel" "text", "p_cooldown_minutes" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."classify_message_and_update_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."classify_message_and_update_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."classify_message_and_update_status"() TO "service_role";



GRANT ALL ON FUNCTION "public"."command_center_day"("p_start" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."command_center_day"("p_start" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."command_center_day"("p_start" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_hourly_operator_metrics"("p_hour" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."compute_hourly_operator_metrics"("p_hour" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_hourly_operator_metrics"("p_hour" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_hourly_operator_service_metrics"("p_hour" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."compute_hourly_operator_service_metrics"("p_hour" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_hourly_operator_service_metrics"("p_hour" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_hourly_service_metrics"("p_hour" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."compute_hourly_service_metrics"("p_hour" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_hourly_service_metrics"("p_hour" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."current_operator_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_operator_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_operator_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."decrement_operator_load"("operator_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."decrement_operator_load"("operator_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."decrement_operator_load"("operator_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."find_or_create_channel_conversation"("p_contact_id" "uuid", "p_channel" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."find_or_create_channel_conversation"("p_contact_id" "uuid", "p_channel" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_or_create_channel_conversation"("p_contact_id" "uuid", "p_channel" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."find_or_create_sms_whatsapp_conversation"("p_contact_id" "uuid", "p_default_channel" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."find_or_create_sms_whatsapp_conversation"("p_contact_id" "uuid", "p_default_channel" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_or_create_sms_whatsapp_conversation"("p_contact_id" "uuid", "p_default_channel" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_auto_logout_enabled"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_auto_logout_enabled"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_auto_logout_enabled"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_auto_logout_enabled"() TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_operator_load"("operator_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."increment_operator_load"("operator_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_operator_load"("operator_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."log_audit_event"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_audit_event"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_audit_event"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_contact_timeline"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_contact_timeline"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_contact_timeline"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_conversation_timeline"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_conversation_timeline"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_conversation_timeline"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_message_timeline"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_message_timeline"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_message_timeline"() TO "service_role";



GRANT ALL ON FUNCTION "public"."merge_contacts"("keep_id" "uuid", "merge_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."merge_contacts"("keep_id" "uuid", "merge_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."merge_contacts"("keep_id" "uuid", "merge_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."message_update_conversation"() TO "anon";
GRANT ALL ON FUNCTION "public"."message_update_conversation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."message_update_conversation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."my_replied_conversation_ids"("p_operator_id" "uuid", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."my_replied_conversation_ids"("p_operator_id" "uuid", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_replied_conversation_ids"("p_operator_id" "uuid", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."neural_notify_inbound"() TO "anon";
GRANT ALL ON FUNCTION "public"."neural_notify_inbound"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."neural_notify_inbound"() TO "service_role";



GRANT ALL ON FUNCTION "public"."neural_pending_messages"("min_age" interval, "max_age" interval) TO "anon";
GRANT ALL ON FUNCTION "public"."neural_pending_messages"("min_age" interval, "max_age" interval) TO "authenticated";
GRANT ALL ON FUNCTION "public"."neural_pending_messages"("min_age" interval, "max_age" interval) TO "service_role";



GRANT ALL ON FUNCTION "public"."pick_next_available_operator"() TO "anon";
GRANT ALL ON FUNCTION "public"."pick_next_available_operator"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."pick_next_available_operator"() TO "service_role";



GRANT ALL ON FUNCTION "public"."pin_conversation_on_operator_reply"() TO "anon";
GRANT ALL ON FUNCTION "public"."pin_conversation_on_operator_reply"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."pin_conversation_on_operator_reply"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_superadmin_self_escalation"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_superadmin_self_escalation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_superadmin_self_escalation"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."process_pending_releases"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."process_pending_releases"() TO "anon";
GRANT ALL ON FUNCTION "public"."process_pending_releases"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."process_pending_releases"() TO "service_role";



GRANT ALL ON FUNCTION "public"."protect_problem_report"() TO "anon";
GRANT ALL ON FUNCTION "public"."protect_problem_report"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."protect_problem_report"() TO "service_role";



GRANT ALL ON FUNCTION "public"."reassign_on_next_client_message"() TO "anon";
GRANT ALL ON FUNCTION "public"."reassign_on_next_client_message"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."reassign_on_next_client_message"() TO "service_role";



GRANT ALL ON FUNCTION "public"."recompute_operator_load"("op_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."recompute_operator_load"("op_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."recompute_operator_load"("op_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_operator_load"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_operator_load"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_operator_load"() TO "service_role";



GRANT ALL ON FUNCTION "public"."release_conversations_on_unavailable"() TO "anon";
GRANT ALL ON FUNCTION "public"."release_conversations_on_unavailable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."release_conversations_on_unavailable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."release_operator_capacity"() TO "anon";
GRANT ALL ON FUNCTION "public"."release_operator_capacity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."release_operator_capacity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."release_support_on_unavailable"() TO "anon";
GRANT ALL ON FUNCTION "public"."release_support_on_unavailable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."release_support_on_unavailable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."reopen_and_reassign_on_client_message"() TO "anon";
GRANT ALL ON FUNCTION "public"."reopen_and_reassign_on_client_message"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."reopen_and_reassign_on_client_message"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."run_auto_snooze"() TO "anon";
GRANT ALL ON FUNCTION "public"."run_auto_snooze"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."run_auto_snooze"() TO "service_role";



GRANT ALL ON FUNCTION "public"."run_hourly_metrics"() TO "anon";
GRANT ALL ON FUNCTION "public"."run_hourly_metrics"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."run_hourly_metrics"() TO "service_role";



GRANT ALL ON FUNCTION "public"."run_shift_reassignment"() TO "anon";
GRANT ALL ON FUNCTION "public"."run_shift_reassignment"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."run_shift_reassignment"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_all_operators_max_capacity"("p_value" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."set_all_operators_max_capacity"("p_value" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_all_operators_max_capacity"("p_value" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_closed_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_closed_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_closed_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_conversation_pin_state"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_conversation_pin_state"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_conversation_pin_state"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_conversation_unread_on_message"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_conversation_unread_on_message"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_conversation_unread_on_message"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "postgres";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "anon";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_ride_history_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_ride_history_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_ride_history_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."show_limit"() TO "postgres";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sweep_unassigned_conversations"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sweep_unassigned_conversations"() TO "anon";
GRANT ALL ON FUNCTION "public"."sweep_unassigned_conversations"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sweep_unassigned_conversations"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_conversation_channel_on_contact_message"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_conversation_channel_on_contact_message"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_conversation_channel_on_contact_message"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_operator_load_on_conversation_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_operator_load_on_conversation_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_operator_load_on_conversation_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."track_conversation_support"() TO "anon";
GRANT ALL ON FUNCTION "public"."track_conversation_support"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."track_conversation_support"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trim_old_app_errors"() TO "anon";
GRANT ALL ON FUNCTION "public"."trim_old_app_errors"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trim_old_app_errors"() TO "service_role";



GRANT ALL ON FUNCTION "public"."unassign_conversations_on_operator_offline"() TO "anon";
GRANT ALL ON FUNCTION "public"."unassign_conversations_on_operator_offline"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."unassign_conversations_on_operator_offline"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_conversation_on_new_message"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_conversation_on_new_message"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_conversation_on_new_message"() TO "service_role";



GRANT ALL ON FUNCTION "public"."upsert_ride_dispatch"("p_job_id" "text", "p_contact_id" "uuid", "p_booked_by" "text", "p_created_at" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."upsert_ride_dispatch"("p_job_id" "text", "p_contact_id" "uuid", "p_booked_by" "text", "p_created_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_ride_dispatch"("p_job_id" "text", "p_contact_id" "uuid", "p_booked_by" "text", "p_created_at" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."wake_up_on_client_message"() TO "anon";
GRANT ALL ON FUNCTION "public"."wake_up_on_client_message"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."wake_up_on_client_message"() TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "service_role";
























GRANT ALL ON TABLE "public"."_snap_writes" TO "anon";
GRANT ALL ON TABLE "public"."_snap_writes" TO "authenticated";
GRANT ALL ON TABLE "public"."_snap_writes" TO "service_role";



GRANT ALL ON TABLE "public"."ai_conversation_state" TO "anon";
GRANT ALL ON TABLE "public"."ai_conversation_state" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_conversation_state" TO "service_role";



GRANT ALL ON TABLE "public"."ai_dispatch_log" TO "anon";
GRANT ALL ON TABLE "public"."ai_dispatch_log" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_dispatch_log" TO "service_role";



GRANT ALL ON TABLE "public"."ai_ride_requests" TO "anon";
GRANT ALL ON TABLE "public"."ai_ride_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_ride_requests" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ai_ride_requests_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ai_ride_requests_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ai_ride_requests_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."ai_usage_log" TO "anon";
GRANT ALL ON TABLE "public"."ai_usage_log" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_usage_log" TO "service_role";



GRANT ALL ON TABLE "public"."app_errors" TO "anon";
GRANT ALL ON TABLE "public"."app_errors" TO "authenticated";
GRANT ALL ON TABLE "public"."app_errors" TO "service_role";



GRANT ALL ON TABLE "public"."audit_log" TO "anon";
GRANT ALL ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."auto_snooze_settings" TO "anon";
GRANT ALL ON TABLE "public"."auto_snooze_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."auto_snooze_settings" TO "service_role";



GRANT ALL ON TABLE "public"."automation_rules" TO "anon";
GRANT ALL ON TABLE "public"."automation_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."automation_rules" TO "service_role";



GRANT ALL ON TABLE "public"."campaigns" TO "anon";
GRANT ALL ON TABLE "public"."campaigns" TO "authenticated";
GRANT ALL ON TABLE "public"."campaigns" TO "service_role";



GRANT ALL ON TABLE "public"."contact_channels" TO "anon";
GRANT ALL ON TABLE "public"."contact_channels" TO "authenticated";
GRANT ALL ON TABLE "public"."contact_channels" TO "service_role";



GRANT ALL ON TABLE "public"."contact_merge_log" TO "anon";
GRANT ALL ON TABLE "public"."contact_merge_log" TO "authenticated";
GRANT ALL ON TABLE "public"."contact_merge_log" TO "service_role";



GRANT ALL ON TABLE "public"."contact_timeline" TO "anon";
GRANT ALL ON TABLE "public"."contact_timeline" TO "authenticated";
GRANT ALL ON TABLE "public"."contact_timeline" TO "service_role";



GRANT ALL ON TABLE "public"."contacts" TO "anon";
GRANT ALL ON TABLE "public"."contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."contacts" TO "service_role";



GRANT ALL ON TABLE "public"."conversation_support" TO "anon";
GRANT ALL ON TABLE "public"."conversation_support" TO "authenticated";
GRANT ALL ON TABLE "public"."conversation_support" TO "service_role";



GRANT ALL ON TABLE "public"."conversations" TO "anon";
GRANT ALL ON TABLE "public"."conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."conversations" TO "service_role";



GRANT ALL ON TABLE "public"."conversations_backup_20260909" TO "anon";
GRANT ALL ON TABLE "public"."conversations_backup_20260909" TO "authenticated";
GRANT ALL ON TABLE "public"."conversations_backup_20260909" TO "service_role";



GRANT ALL ON TABLE "public"."hourly_operator_metrics" TO "anon";
GRANT ALL ON TABLE "public"."hourly_operator_metrics" TO "authenticated";
GRANT ALL ON TABLE "public"."hourly_operator_metrics" TO "service_role";



GRANT ALL ON SEQUENCE "public"."hourly_operator_metrics_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."hourly_operator_metrics_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."hourly_operator_metrics_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."hourly_service_metrics" TO "anon";
GRANT ALL ON TABLE "public"."hourly_service_metrics" TO "authenticated";
GRANT ALL ON TABLE "public"."hourly_service_metrics" TO "service_role";



GRANT ALL ON TABLE "public"."integration_settings" TO "anon";
GRANT ALL ON TABLE "public"."integration_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."integration_settings" TO "service_role";



GRANT ALL ON TABLE "public"."internal_channels" TO "anon";
GRANT ALL ON TABLE "public"."internal_channels" TO "authenticated";
GRANT ALL ON TABLE "public"."internal_channels" TO "service_role";



GRANT ALL ON TABLE "public"."internal_messages" TO "anon";
GRANT ALL ON TABLE "public"."internal_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."internal_messages" TO "service_role";



GRANT ALL ON TABLE "public"."message_templates" TO "anon";
GRANT ALL ON TABLE "public"."message_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."message_templates" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT ALL ON TABLE "public"."messages_backup_20260909" TO "anon";
GRANT ALL ON TABLE "public"."messages_backup_20260909" TO "authenticated";
GRANT ALL ON TABLE "public"."messages_backup_20260909" TO "service_role";



GRANT ALL ON TABLE "public"."missed_call_auto_replies" TO "anon";
GRANT ALL ON TABLE "public"."missed_call_auto_replies" TO "authenticated";
GRANT ALL ON TABLE "public"."missed_call_auto_replies" TO "service_role";



GRANT ALL ON TABLE "public"."missed_calls" TO "anon";
GRANT ALL ON TABLE "public"."missed_calls" TO "authenticated";
GRANT ALL ON TABLE "public"."missed_calls" TO "service_role";



GRANT ALL ON TABLE "public"."operator_release_pending" TO "anon";
GRANT ALL ON TABLE "public"."operator_release_pending" TO "authenticated";
GRANT ALL ON TABLE "public"."operator_release_pending" TO "service_role";



GRANT ALL ON TABLE "public"."operators" TO "anon";
GRANT ALL ON TABLE "public"."operators" TO "authenticated";
GRANT ALL ON TABLE "public"."operators" TO "service_role";



GRANT ALL ON TABLE "public"."problem_reports" TO "anon";
GRANT ALL ON TABLE "public"."problem_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."problem_reports" TO "service_role";



GRANT ALL ON TABLE "public"."queue_members" TO "anon";
GRANT ALL ON TABLE "public"."queue_members" TO "authenticated";
GRANT ALL ON TABLE "public"."queue_members" TO "service_role";



GRANT ALL ON TABLE "public"."queues" TO "anon";
GRANT ALL ON TABLE "public"."queues" TO "authenticated";
GRANT ALL ON TABLE "public"."queues" TO "service_role";



GRANT ALL ON TABLE "public"."ride_history" TO "anon";
GRANT ALL ON TABLE "public"."ride_history" TO "authenticated";
GRANT ALL ON TABLE "public"."ride_history" TO "service_role";



GRANT ALL ON TABLE "public"."role_permissions" TO "anon";
GRANT ALL ON TABLE "public"."role_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."role_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."taxicaller_events" TO "anon";
GRANT ALL ON TABLE "public"."taxicaller_events" TO "authenticated";
GRANT ALL ON TABLE "public"."taxicaller_events" TO "service_role";



GRANT ALL ON TABLE "public"."taxicaller_processed_events" TO "anon";
GRANT ALL ON TABLE "public"."taxicaller_processed_events" TO "authenticated";
GRANT ALL ON TABLE "public"."taxicaller_processed_events" TO "service_role";



GRANT ALL ON TABLE "public"."vehicles" TO "anon";
GRANT ALL ON TABLE "public"."vehicles" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicles" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";



































