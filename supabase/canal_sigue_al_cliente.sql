-- ============================================================================
-- El canal de la conversación sigue al cliente (SMS <-> WhatsApp)
--
-- Problema: un cliente que empezó por SMS y después escribe por WhatsApp
-- (o al revés) seguía figurando con el canal viejo en la lista ("SMS") y en
-- la ficha ("SMS (RingCentral)"), porque conversations.channel se fija al
-- crear la conversación y nunca se actualizaba.
--
-- Solución: cada vez que entra un mensaje DEL CLIENTE por sms o whatsapp,
-- conversations.channel pasa a ser ese canal. Se queda así hasta que el
-- cliente escriba por el otro.
--
-- Es seguro: las búsquedas de conversación de sms/whatsapp ya usan
-- "channel in ('sms','whatsapp')", así que cambiar entre esos dos no crea
-- conversaciones duplicadas. Facebook e Instagram NO se tocan (son
-- conversaciones aparte).
-- Correr una sola vez en el SQL Editor de Supabase (se puede repetir sin
-- problema: no duplica nada).
-- ============================================================================

create or replace function sync_conversation_channel_on_contact_message()
returns trigger
language plpgsql
security definer
as $$
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

drop trigger if exists trg_sync_conversation_channel on messages;
create trigger trg_sync_conversation_channel
after insert on messages
for each row
execute function sync_conversation_channel_on_contact_message();

-- Corrección de las conversaciones que ya están desfasadas (ej. el caso de
-- Julian Rios): el canal pasa a ser el del ÚLTIMO mensaje del cliente.
update conversations c
set channel = l.ch
from (
  select distinct on (m.conversation_id)
         m.conversation_id,
         m.sent_via_channel as ch
  from messages m
  where m.sender_type = 'contact'
    and m.sent_via_channel in ('sms', 'whatsapp')
  order by m.conversation_id, m.created_at desc
) l
where c.id = l.conversation_id
  and c.channel in ('sms', 'whatsapp')
  and c.channel <> l.ch;

-- Chequeo: debería devolver 0 filas
-- select c.id, c.channel, l.ch from conversations c join (select distinct on (conversation_id) conversation_id, sent_via_channel ch from messages where sender_type='contact' and sent_via_channel in ('sms','whatsapp') order by conversation_id, created_at desc) l on l.conversation_id=c.id where c.channel in ('sms','whatsapp') and c.channel<>l.ch;
