// supabase/functions/simulate-message/index.ts
//
// Simula un mensaje entrante como si viniera de un canal real, para poder
// probar todo el pipeline (contacto, conversación, round robin, estado
// automático, Realtime) sin depender de que Meta o RingCentral estén
// conectados todavía. Reutiliza exactamente la misma lógica que usan los
// webhooks reales. Solo un admin puede usarlo.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizePhone } from "../_shared/phone.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "No autenticado" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData } = await callerClient.auth.getUser();
  if (!userData.user) {
    return new Response(JSON.stringify({ error: "No autenticado" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: caller } = await supabase
    .from("operators")
    .select("is_admin")
    .eq("auth_user_id", userData.user.id)
    .single();

  if (!caller?.is_admin) {
    return new Response(JSON.stringify({ error: "Solo un administrador puede simular mensajes" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { channel, name, phone: rawPhone, text } = await req.json();

  if (!channel || !rawPhone || !text) {
    return new Response(JSON.stringify({ error: "Faltan channel, phone o text" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const phone = channel === "sms" || channel === "whatsapp" ? normalizePhone(rawPhone) : rawPhone;

  try {
    // 1. Contacto (mismo criterio que los webhooks reales: por teléfono)
    const { data: existingContact } = await supabase
      .from("contacts")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();

    let contactId = existingContact?.id;

    if (!contactId) {
      const { data: newContact, error } = await supabase
        .from("contacts")
        .insert({ full_name: name || null, phone })
        .select("id")
        .single();
      if (error) throw error;
      contactId = newContact.id;

      await supabase.from("contact_channels").insert({
        contact_id: contactId,
        channel,
        external_id: phone,
      });
    }

    // 2. Conversación más reciente (se reabre si estaba cerrada, para no
    // fragmentar el historial), o nueva si nunca hubo (dispara el round robin)
    const { data: existingConversation } = await supabase
      .from("conversations")
      .select("id, status")
      .eq("contact_id", contactId)
      .eq("channel", channel)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let conversationId = existingConversation?.id;

    if (conversationId && existingConversation!.status === "cerrada") {
      await supabase
        .from("conversations")
        .update({ status: "esperando_operador", unread: true })
        .eq("id", conversationId);
    }

    if (!conversationId) {
      const { data: queue } = await supabase
        .from("queues")
        .select("id")
        .eq("name", `${channel}_general`)
        .maybeSingle();

      const { data: newConversation, error } = await supabase
        .from("conversations")
        .insert({
          contact_id: contactId,
          channel,
          queue_id: queue?.id ?? null,
          external_thread_id: phone,
        })
        .select("id")
        .single();
      if (error) throw error;
      conversationId = newConversation.id;
    }

    // 3. Mensaje (dispara la clasificación automática de estado)
    await supabase.from("messages").insert({
      conversation_id: conversationId,
      sender_type: "contact",
      content: text,
    });

    return new Response(JSON.stringify({ success: true, conversationId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});