// supabase/functions/link-contact-channel/index.ts
//
// Vincula el canal de Facebook o Instagram de OTRO contacto (que se creó
// aparte porque esa persona escribió primero por esa red social, sin
// teléfono asociado) al contacto que tenés abierto — típicamente porque
// el operador reconoce que es la misma persona.
//
// Mueve el contact_channels (para poder mandar mensajes) y la
// conversación de esa red social entera al contacto de destino, así el
// historial completo por Facebook/Instagram queda visible ahí. No borra
// nada — cualquier operador autenticado puede hacerlo (mismo nivel de
// permiso que tildar tags o preferred_channels).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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

  const { targetContactId, sourceContactId, channel } = await req.json();

  if (!targetContactId || !sourceContactId || !["facebook", "instagram"].includes(channel)) {
    return new Response(JSON.stringify({ error: "Faltan datos (targetContactId, sourceContactId, channel)" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (targetContactId === sourceContactId) {
    return new Response(JSON.stringify({ error: "Es el mismo contacto" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Mover el contact_channel (el que tiene el external_id real de Messenger/Instagram)
  const { error: channelErr } = await serviceClient
    .from("contact_channels")
    .update({ contact_id: targetContactId })
    .eq("contact_id", sourceContactId)
    .eq("channel", channel);

  if (channelErr) {
    return new Response(JSON.stringify({ error: channelErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Mover también la(s) conversación(es) de esa red social, para que el
  // historial se vea desde el contacto de destino.
  const { error: convErr } = await serviceClient
    .from("conversations")
    .update({ contact_id: targetContactId })
    .eq("contact_id", sourceContactId)
    .eq("channel", channel);

  if (convErr) {
    return new Response(JSON.stringify({ error: convErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});