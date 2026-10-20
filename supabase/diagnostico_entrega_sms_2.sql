-- Diagnóstico de entrega, parte 2 (solo lectura — no modifica nada).
-- Corré cada consulta por separado en el SQL Editor de Supabase.

-- A) Conversaciones de los 3 clientes (¿tienen varias? ¿en qué estado?).
select c.phone, cv.id as conversation_id, cv.status, cv.channel,
       cv.created_at at time zone 'America/New_York' as creada_atlanta,
       cv.last_message_at at time zone 'America/New_York' as ultimo_msj_atlanta
from conversations cv
join contacts c on c.id = cv.contact_id
where regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') like any
      (array['%6788734912', '%7702947242', '%4707140626'])
order by c.phone, cv.created_at desc;

-- B) Por qué canal escribió cada uno en los últimos 90 días.
select c.phone, m.sent_via_channel as canal, count(*) as mensajes,
       max(m.created_at at time zone 'America/New_York') as ultimo_atlanta
from messages m
join conversations cv on cv.id = m.conversation_id
join contacts c on c.id = cv.contact_id
where m.sender_type = 'contact'
  and m.created_at > now() - interval '90 days'
  and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') like any
      (array['%6788734912', '%7702947242', '%4707140626'])
group by 1, 2
order by 1, 4 desc;

-- C) ¿Qué son los SMS "sin estado" (unos 800 por día)?
select m.sender_type,
       (m.rc_message_id is not null) as tiene_id_ringcentral,
       left(m.content, 45) as empieza_con,
       count(*) as cantidad
from messages m
where m.sent_via_channel = 'sms'
  and m.sender_type <> 'contact'
  and m.delivery_status is null
  and m.created_at > now() - interval '24 hours'
group by 1, 2, 3
order by 4 desc
limit 25;

-- D) Dimensionar: avisos "ha llegado" enviados por SMS en los últimos 7 días,
--    según el canal por el que el cliente escribió la ÚLTIMA vez (mirando
--    TODAS sus conversaciones, no solo la actual).
with avisos as (
  select m.id, m.created_at, cv.contact_id
  from messages m
  join conversations cv on cv.id = m.conversation_id
  where m.sender_type <> 'contact'
    and m.sent_via_channel = 'sms'
    and m.content ilike '%ha llegado%'
    and m.created_at > now() - interval '7 days'
)
select count(*) as avisos_por_sms,
       count(*) filter (where ult.canal = 'whatsapp') as ultimo_entrante_whatsapp,
       count(*) filter (where ult.canal = 'whatsapp'
                          and a.created_at - ult.t < interval '24 hours') as ultimo_whatsapp_y_dentro_de_24h,
       count(*) filter (where ult.canal = 'sms') as ultimo_entrante_sms,
       count(*) filter (where ult.canal is null) as sin_historial
from avisos a
left join lateral (
  select m2.sent_via_channel as canal, m2.created_at as t
  from messages m2
  join conversations c2 on c2.id = m2.conversation_id
  where c2.contact_id = a.contact_id
    and m2.sender_type = 'contact'
    and m2.sent_via_channel in ('sms', 'whatsapp')
    and m2.created_at < a.created_at
  order by m2.created_at desc
  limit 1
) ult on true;

-- E) Errores registrados en los últimos 7 días, agrupados (para ver por qué
--    fallaron los WhatsApp salientes).
select context, left(message, 140) as mensaje, count(*) as veces
from app_errors
where created_at > now() - interval '7 days'
group by 1, 2
order by 3 desc
limit 25;
