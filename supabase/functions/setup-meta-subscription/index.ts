// supabase/functions/setup-meta-subscription/index.ts
//
// Activa/desactiva que TU app reciba webhooks de WhatsApp/Facebook/
// Instagram para la cuenta (WABA) que ya usa la otra plataforma.
// Meta permite que varias apps estén suscritas a la misma cuenta a la
// vez — esto no le saca el acceso al otro sistema, solo agrega el
// tuyo como otro receptor.
//
// Body esperado: { "action": "activate" | "deactivate" | "status" }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSettings } from "../_shared/settings.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const GRAPH_VERSION = "v26.0";

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

  const { data: caller } = await serviceClient
    .from("operators")
    .select("is_admin")
    .eq("auth_user_id", userData.user.id)
    .single();

  if (!caller?.is_admin) {
    return new Response(JSON.stringify({ error: "Solo un administrador puede hacer esto" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { action } = await req.json().catch(() => ({ action: "status" }));

  const settings = await getSettings(["META_WABA_ID", "META_ACCESS_TOKEN"]);
  const wabaId = settings.META_WABA_ID;
  const accessToken = settings.META_ACCESS_TOKEN;

  if (!wabaId || !accessToken) {
    return new Response(
      JSON.stringify({ error: "Faltan META_WABA_ID o META_ACCESS_TOKEN en Integrations" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/subscribed_apps`;

  try {
    if (action === "status") {
      const res = await fetch(`${url}?access_token=${accessToken}`);
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data));
      return new Response(JSON.stringify({ success: true, raw: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "deactivate") {
      const res = await fetch(`${url}?access_token=${accessToken}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data));
      return new Response(JSON.stringify({ success: true, deactivated: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // action === "activate"
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(data));

    return new Response(JSON.stringify({ success: true, activated: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err instanceof Error ? err.message : err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});