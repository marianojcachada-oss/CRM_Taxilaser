-- Command Center: los números del día calculados EN la base, en una sola llamada.
-- Antes el navegador bajaba todos los mensajes de hoy (miles de filas) para
-- contarlos; ahora la base devuelve solo los totales. "Hoy" = desde p_start
-- (el frontend manda la medianoche de Atlanta). Las horas del gráfico también
-- se calculan en hora de Atlanta. El gráfico por hora cuenta CONVERSACIONES
-- distintas (una conversación vale 1 por hora aunque mande varios mensajes);
-- 'inbound' sigue siendo la cantidad de mensajes.
--
-- Es "security invoker": respeta los mismos permisos (RLS) del usuario que
-- llama, igual que las consultas de antes.
create or replace function command_center_day(p_start timestamptz)
returns jsonb
language sql
stable
as $$
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

grant execute on function command_center_day(timestamptz) to authenticated;

-- Opcional, si la consulta se siente lenta con mucho volumen: un índice por
-- fecha en messages (puede tardar un poco en crearse y frena escrituras unos
-- segundos mientras tanto). Ejecutalo aparte, en un horario tranquilo.
-- create index if not exists idx_messages_created_at on messages (created_at);
