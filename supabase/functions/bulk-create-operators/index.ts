// supabase/functions/bulk-create-operators/index.ts
//
// Crea varios operadores de una — a cada uno le manda una invitación por
// email de Supabase para que elija su propia contraseña, en vez de que
// alguien tenga que inventar y compartir contraseñas a mano. Solo un
// admin puede llamarla. Devuelve el resultado de cada fila (ok o error),
// no corta todo si una falla.

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
    return new Response(JSON.stringify({ error: "Solo un administrador puede cargar operadores" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { rows } = await req.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    return new Response(JSON.stringify({ error: "Falta la lista de operadores (rows)" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: { email: string; success: boolean; error?: string }[] = [];

  for (const row of rows) {
    const full_name = String(row.full_name ?? "").trim();
    const email = String(row.email ?? "").trim().toLowerCase();

    if (!full_name || !email) {
      results.push({ email: email || "(vacío)", success: false, error: "Falta nombre o email" });
      continue;
    }

    try {
      // inviteUserByEmail crea el usuario SIN contraseña y le manda un
      // correo con un link para que elija la suya — nadie tiene que
      // inventar ni comunicar contraseñas a mano.
      const { data: invited, error: inviteError } = await serviceClient.auth.admin.inviteUserByEmail(email);
      if (inviteError) throw inviteError;

      const { error: insertError } = await serviceClient.from("operators").insert({
        auth_user_id: invited.user.id,
        full_name,
        is_admin: false,
        is_active: true,
      });
      if (insertError) throw insertError;

      results.push({ email, success: true });
    } catch (err: any) {
      results.push({ email, success: false, error: err.message ?? String(err) });
    }
  }

  return new Response(JSON.stringify({ results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});