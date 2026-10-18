-- Citas de WhatsApp: guarda el id del mensaje citado cuando ese mensaje no está
-- en la base, para que el CRM muestre igual que el cliente respondió a algo.
alter table messages add column if not exists reply_to_external_id text;
