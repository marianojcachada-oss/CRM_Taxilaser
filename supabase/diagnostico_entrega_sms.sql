-- Diagnóstico de entrega de mensajes (solo lectura — no modifica nada).
-- Corré cada consulta por separado en el SQL Editor de Supabase.
-- OJO: los nombres de columnas son los que usa el CRM; si alguna da error
-- ("column ... does not exist"), pasame el error y la ajusto.

-- 1) Qué pasó con los mensajes a los 3 clientes (últimos 7 días).
--    Mirá la columna delivery_status de los mensajes NUESTROS por SMS:
--      delivered = RingCentral dice que la operadora lo entregó
--      sent      = salió, pero nunca llegó una confirmación
--      failed    = lo rechazó la operadora
select c.phone,
       m.created_at at time zone 'America/New_York' as hora_atlanta,
       m.sender_type,
       m.sent_via_channel as canal,
       m.delivery_status,
       m.delivered_at at time zone 'America/New_York' as entregado_atlanta,
       (m.rc_message_id is not null) as tiene_id_ringcentral,
       left(m.content, 70) as texto
from messages m
join conversations cv on cv.id = m.conversation_id
join contacts c on c.id = cv.contact_id
where regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') like any
      (array['%6788734912', '%7702947242', '%4707140626'])
  and m.created_at > now() - interval '7 days'
order by c.phone, m.created_at;

-- 2) Panorama general: SALIENTES de los últimos 7 días por canal y estado.
--    Sirve para ver qué porcentaje de los SMS queda en "sent" (sin confirmar)
--    o "failed", y si hay algún día donde empeora.
select (m.created_at at time zone 'America/New_York')::date as dia,
       m.sent_via_channel as canal,
       coalesce(m.delivery_status, '(sin estado)') as estado,
       count(*) as cantidad
from messages m
where m.sender_type <> 'contact'
  and m.created_at > now() - interval '7 days'
  and m.sent_via_channel in ('sms', 'whatsapp')
group by 1, 2, 3
order by 1 desc, 2, 3;

-- 3) SMS salientes de hace más de 15 minutos que nunca recibieron confirmación.
--    (Si son muchos, o RingCentral no está avisando, o las operadoras no
--    devuelven la confirmación.)
select (m.created_at at time zone 'America/New_York')::date as dia,
       count(*) as sms_sin_confirmar
from messages m
where m.sender_type <> 'contact'
  and m.sent_via_channel = 'sms'
  and coalesce(m.delivery_status, 'sent') = 'sent'
  and m.created_at between now() - interval '7 days' and now() - interval '15 minutes'
group by 1
order by 1 desc;

-- 4) Errores que registró el aviso de estado de RingCentral (últimos 7 días).
--    El campo "stack" trae el detalle que mandó RingCentral (códigos de error).
select created_at at time zone 'America/New_York' as hora_atlanta, message, left(stack, 600) as detalle
from app_errors
where context = 'ringcentral-status-webhook'
  and created_at > now() - interval '7 days'
order by created_at desc
limit 50;

-- 5) Clientes que escribieron algo como "no me llegó el mensaje" en los
--    últimos 14 días (para dimensionar el problema y ver el patrón).
select (m.created_at at time zone 'America/New_York') as hora_atlanta,
       c.phone,
       m.sent_via_channel as canal_en_que_escribio,
       left(m.content, 100) as texto
from messages m
join conversations cv on cv.id = m.conversation_id
join contacts c on c.id = cv.contact_id
where m.sender_type = 'contact'
  and m.created_at > now() - interval '14 days'
  and m.content ~* '(no me lleg|no lleg[oó] (el )?mensaje|no recib|not receiv|didn.t get|no (me )?avis)'
order by m.created_at desc
limit 100;
