// supabase/functions/create-operator/index.ts
//
// Crea un usuario real de Supabase Auth + su fila en operators.
// Solo un admin puede llamar a esta función (se verifica el JWT de quien
// llama, no confiamos en nada que mande el frontend sin chequear).
//
// A diferencia de los webhooks, esta función SE DESPLIEGA CON verify-jwt
// (sin --no-verify-jwt), porque necesita saber quién la está llamando.
// Y a diferencia de los webhooks, la llama el navegador directamente,
// así que necesita headers de CORS.

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
  // El navegador manda un OPTIONS antes del pedido real, para preguntar
  // si tiene permiso — hay que contestarlo, si no el pedido real ni sale.
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
  const { data: userData, error: userError } = await callerClient.auth.getUser();

  if (userError || !userData.user) {
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
    return new Response(JSON.stringify({ error: "Solo un administrador puede agregar operadores" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { email, password, full_name } = await req.json();

  if (!email || !password || !full_name) {
    return new Response(JSON.stringify({ error: "Faltan email, password o full_name" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (password.length < 6) {
    return new Response(JSON.stringify({ error: "La contraseña debe tener al menos 6 caracteres" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: newUser, error: createError } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError || !newUser.user) {
    return new Response(JSON.stringify({ error: createError?.message ?? "No se pudo crear el usuario" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { error: insertError } = await serviceClient.from("operators").insert({
    auth_user_id: newUser.user.id,
    full_name,
    presence: "offline",
  });

  if (insertError) {
    return new Response(JSON.stringify({ error: insertError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});