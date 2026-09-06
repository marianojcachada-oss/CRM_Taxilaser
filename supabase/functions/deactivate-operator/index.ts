// supabase/functions/deactivate-operator/index.ts
//
// Desactiva un operador en vez de borrarlo: le corta el acceso (login
// bloqueado), lo saca de todas las colas y libera lo que tuviera
// asignado — pero conserva su fila en operators intacta, para que el
// historial de auditoría siga mostrando quién hizo qué mientras estuvo
// activo. Solo un admin puede llamarla.

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
    return new Response(JSON.stringify({ error: "Solo un administrador puede desactivar operadores" }), {
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

  // Liberar lo que tuviera asignado, para que vuelva a repartirse solo
  await serviceClient.from("conversations").update({ assigned_operator_id: null }).eq("assigned_operator_id", operator_id);

  // Sacarlo de todas las colas — no vuelve a entrar al round robin
  await serviceClient.from("queue_members").delete().eq("operator_id", operator_id);

  // Marcarlo inactivo y no disponible, sin borrar la fila (mantiene el
  // historial de auditoría con su nombre real, no un actor desconocido)
  const { error: updateError } = await serviceClient
    .from("operators")
    .update({ is_active: false, presence: "unavailable" })
    .eq("id", operator_id);
  if (updateError) {
    return new Response(JSON.stringify({ error: updateError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Bloquearle el login (baneo largo, no borra la cuenta) — un admin
  // puede reactivarlo más adelante si hace falta
  if (target.auth_user_id) {
    await serviceClient.auth.admin.updateUserById(target.auth_user_id, { ban_duration: "876000h" });
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});