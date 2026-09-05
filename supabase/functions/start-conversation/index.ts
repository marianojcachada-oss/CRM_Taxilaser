// supabase/functions/start-conversation/index.ts
//
// Inicia una conversación de SMS nueva con un teléfono que todavía no te
// escribió. Crea el contacto si no existe, y manda el SMS de verdad por
// RingCentral. Cualquier operador puede usarla (no solo admins) — queda
// asignada directo a quien la inicia, sin pasar por el round robin.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSettings } from "../_shared/settings.ts";
import { getRingCentralAccessToken } from "../_shared/ringcentral.ts";
import { normalizePhone } from "../_shared/phone.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

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

  const { data: operator } = await serviceClient
    .from("operators")
    .select("id")
    .eq("auth_user_id", userData.user.id)
    .single();

  if (!operator) {
    return new Response(JSON.stringify({ error: "Operador no encontrado" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { phone: rawPhone, name, text } = await req.json();

  if (!rawPhone || !text) {
    return new Response(JSON.stringify({ error: "Faltan phone o text" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const phone = normalizePhone(rawPhone);

  try {
    // 1. Contacto: usarlo si ya existe, crearlo si no
    const { data: existingContact } = await serviceClient
      .from("contacts")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();

    let contactId = existingContact?.id;

    if (!contactId) {
      const { data: newContact, error } = await serviceClient
        .from("contacts")
        .insert({ phone, full_name: name || null })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      contactId = newContact.id;

      await serviceClient.from("contact_channels").insert({
        contact_id: contactId,
        channel: "sms",
        external_id: phone,
      });
    }

    // 2. Conversación de SMS más reciente con este contacto (se reabre si
    // estaba cerrada), o una nueva — asignada directo a quien la inicia
    const { data: existingConversation } = await serviceClient
      .from("conversations")
      .select("id, status")
      .eq("contact_id", contactId)
      .eq("channel", "sms")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let conversationId = existingConversation?.id;

    if (conversationId && existingConversation!.status === "cerrada") {
      await serviceClient
        .from("conversations")
        .update({ status: "esperando_operador", assigned_operator_id: operator.id })
        .eq("id", conversationId);
    }

    if (!conversationId) {
      const { data: newConversation, error } = await serviceClient
        .from("conversations")
        .insert({
          contact_id: contactId,
          channel: "sms",
          external_thread_id: phone,
          assigned_operator_id: operator.id,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      conversationId = newConversation.id;
    }

    // 3. Mandar el SMS de verdad por RingCentral
    const rcSettings = await getSettings(["RINGCENTRAL_SERVER_URL", "RINGCENTRAL_EXTENSION_ID", "RINGCENTRAL_FROM_NUMBER"]);
    const rcServer = rcSettings.RINGCENTRAL_SERVER_URL ?? "https://platform.ringcentral.com";
    const extensionId = rcSettings.RINGCENTRAL_EXTENSION_ID || "~";
    const fromNumber = rcSettings.RINGCENTRAL_FROM_NUMBER;

    if (!fromNumber) {
      throw new Error("Falta cargar RINGCENTRAL_FROM_NUMBER en Integrations.");
    }

    const accessToken = await getRingCentralAccessToken();

    const res = await fetch(`${rcServer}/restapi/v1.0/account/~/extension/${extensionId}/sms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        from: { phoneNumber: fromNumber },
        to: [{ phoneNumber: phone }],
        text,
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(`RingCentral rechazó el envío: ${JSON.stringify(errData)}`);
    }

    // 4. Registrar el mensaje
    const { data: insertedMessage, error: msgError } = await serviceClient
      .from("messages")
      .insert({
        conversation_id: conversationId,
        sender_type: "operator",
        sender_operator_id: operator.id,
        content: text,
        sent_via_channel: "sms",
      })
      .select("id")
      .single();
    if (msgError) throw new Error(msgError.message);

    return new Response(JSON.stringify({ success: true, conversationId, messageId: insertedMessage.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err instanceof Error ? err.message : err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});