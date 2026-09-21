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

    // 2. Conversación — misma función atómica que usan los webhooks
    // reales (evita el "chat partido en dos" si se mandan simulados
    // casi al mismo tiempo para el mismo número, que es justo el tipo
    // de cosa que un stress test tiene que poder probar sin generar un
    // falso positivo por una vulnerabilidad que solo existiera acá).
    const rpcName = channel === "sms" || channel === "whatsapp"
      ? "find_or_create_sms_whatsapp_conversation"
      : "find_or_create_channel_conversation";
    const rpcParams = channel === "sms" || channel === "whatsapp"
      ? { p_contact_id: contactId, p_default_channel: channel }
      : { p_contact_id: contactId, p_channel: channel };

    const { data: conversationId, error: convError } = await supabase.rpc(rpcName, rpcParams);
    if (convError) throw convError;

    // Si estaba cerrada, la reabrimos (mismo criterio que los webhooks reales).
    await supabase
      .from("conversations")
      .update({ status: "esperando_operador", unread: true })
      .eq("id", conversationId)
      .eq("status", "cerrada");

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