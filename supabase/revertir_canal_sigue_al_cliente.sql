-- Revierte "el canal sigue al cliente": saca el trigger y la función.
-- Correr YA en el SQL Editor de Supabase. Es solo un DROP de lo que agregué.
drop trigger if exists trg_sync_conversation_channel on messages;
drop function if exists sync_conversation_channel_on_contact_message();
