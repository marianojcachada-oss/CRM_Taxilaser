// supabase/functions/delete-operator-permanently/index.ts
//
// Borra a un operador de verdad: su usuario de Auth y su fila en
// operators, sin dejar rastro. Es distinto de "desactivar" (que
// conserva el historial de auditoría) — usar solo cuando de verdad no
// hace falta conservar nada de esa persona. Ya es seguro hacerlo: la
// constraint de audit_log se corrigió para no romperse si borra a
// alguien con historial (queda con actor desconocido).

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
    return new Response(JSON.stringify({ error: "Solo un administrador puede eliminar operadores" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { operator_id } = await req.json();
  if (!operator_id) {
    return new Response(JSON.stringify({ error: "Falta operator_id" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: target } = await serviceClient
    .from("operators")
    .select("auth_user_id")
    .eq("id", operator_id)
    .single();

  if (!target) {
    return new Response(JSON.stringify({ error: "Ese operador no existe" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  await serviceClient.from("conversations").update({ assigned_operator_id: null }).eq("assigned_operator_id", operator_id);
  await serviceClient.from("queue_members").delete().eq("operator_id", operator_id);

  const { error: deleteRowError } = await serviceClient.from("operators").delete().eq("id", operator_id);
  if (deleteRowError) {
    return new Response(JSON.stringify({ error: deleteRowError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (target.auth_user_id) {
    await serviceClient.auth.admin.deleteUser(target.auth_user_id);
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});