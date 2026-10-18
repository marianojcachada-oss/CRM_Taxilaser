-- Sonido de notificación elegido por cada operador (se guarda en su usuario).
-- Es opcional: sin este SQL el sonido igual se recuerda, pero solo en ese navegador.
alter table operators add column if not exists notification_sound text;
