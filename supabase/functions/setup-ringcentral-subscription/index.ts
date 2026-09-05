// supabase/functions/setup-ringcentral-subscription/index.ts
//
// Activa o desactiva la suscripción de RingCentral que le dice "avisale a
// esta URL cuando llegue un SMS". Sin activarla, ringcentral-webhook nunca
// recibe nada, aunque esté bien desplegado. Solo un admin puede correrlo.
// Las suscripciones activas expiran solas (máximo ~7 días) si no se
// renuevan — hay que volver a activarla cada tanto hasta que armemos una
// renovación automática.
//
// Body esperado: { "action": "activate" } o { "action": "deactivate" }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSetting } from "../_shared/settings.ts";
import { getRingCentralAccessToken } from "../_shared/ringcentral.ts";

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

  const { action } = await req.json().catch(() => ({ action: "activate" }));

  try {
    const rcServer = (await getSetting("RINGCENTRAL_SERVER_URL")) ?? "https://platform.ringcentral.com";
    const accessToken = await getRingCentralAccessToken();

    if (action === "status") {
      const subscriptionId = await getSetting("RINGCENTRAL_SUBSCRIPTION_ID");

      if (!subscriptionId) {
        return new Response(JSON.stringify({ error: "No hay ninguna suscripción registrada todavía" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const res = await fetch(`${rcServer}/restapi/v1.0/subscription/${subscriptionId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();

      if (!res.ok) {
        return new Response(JSON.stringify({ error: data }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({ success: true, raw: data }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action === "deactivate") {
      const subscriptionId = await getSetting("RINGCENTRAL_SUBSCRIPTION_ID");

      if (!subscriptionId) {
        return new Response(JSON.stringify({ error: "No hay ninguna suscripción activa registrada" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const res = await fetch(`${rcServer}/restapi/v1.0/subscription/${subscriptionId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      // RingCentral devuelve 204 sin cuerpo si sale bien
      if (!res.ok && res.status !== 404) {
        const data = await res.json().catch(() => ({}));
        return new Response(JSON.stringify({ error: data }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await serviceClient
        .from("integration_settings")
        .upsert({ key: "RINGCENTRAL_SUBSCRIPTION_ID", value: null, updated_at: new Date().toISOString() });

      return new Response(JSON.stringify({ success: true, deactivated: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // action === "activate"
    const projectRef = SUPABASE_URL.match(/https:\/\/(.*)\.supabase\.co/)?.[1];
    const address = `https://${projectRef}.supabase.co/functions/v1/ringcentral-webhook`;
    const extensionId = (await getSetting("RINGCENTRAL_EXTENSION_ID")) || "~";

    const res = await fetch(`${rcServer}/restapi/v1.0/subscription`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        eventFilters: [
          `/restapi/v1.0/account/~/extension/${extensionId}/message-store/instant?type=SMS`,
        ],
        deliveryMode: { transportType: "WebHook", address },
        expiresIn: 604800, // 7 días, el máximo habitual para WebHook
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      return new Response(JSON.stringify({ error: data }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await serviceClient
      .from("integration_settings")
      .upsert({ key: "RINGCENTRAL_SUBSCRIPTION_ID", value: data.id, updated_at: new Date().toISOString() });

    return new Response(JSON.stringify({ success: true, subscriptionId: data.id, expiresAt: data.expirationTime }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});