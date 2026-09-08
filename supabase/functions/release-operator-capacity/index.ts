// supabase/functions/release-operator-capacity/index.ts
//
// Botón de emergencia para reiniciar el reparto: pone current_load en 0
// para todos los operadores, y marca como visto todas las conversaciones
// abiertas que quedaron asignadas. Solo un admin puede llamarla — el
// permiso se verifica acá contra el JWT de quien llama, no en el
// frontend, así que aunque alguien manipule el botón no puede ejecutarla
// sin ser admin de verdad.

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

  const { data: callerOperator } = await serviceClient
    .from("operators")
    .select("is_admin")
    .eq("auth_user_id", userData.user.id)
    .single();

  if (!callerOperator?.is_admin) {
    return new Response(JSON.stringify({ error: "Solo un administrador puede liberar la carga" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 1. Todos los operadores vuelven a carga 0 — reinicia el reparto del
  // round robin desde cero para todo el equipo.
  const { error: loadError, count: operatorsReset } = await serviceClient
    .from("operators")
    .update({ current_load: 0 })
    .neq("current_load", 0)
    .select("id", { count: "exact", head: true });

  if (loadError) {
    return new Response(JSON.stringify({ error: loadError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 2. Todo lo abierto y asignado pasa a "visto" — limpia la bandeja para
  // arrancar de nuevo, sin tocar lo cerrado ni lo todavía sin asignar.
  const { error: unreadError, count: conversationsMarkedRead } = await serviceClient
    .from("conversations")
    .update({ unread: false })
    .neq("status", "cerrada")
    .not("assigned_operator_id", "is", null)
    .select("id", { count: "exact", head: true });

  if (unreadError) {
    return new Response(JSON.stringify({ error: unreadError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      success: true,
      operatorsReset: operatorsReset ?? 0,
      conversationsMarkedRead: conversationsMarkedRead ?? 0,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});