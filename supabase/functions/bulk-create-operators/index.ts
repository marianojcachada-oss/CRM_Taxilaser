// supabase/functions/bulk-create-operators/index.ts
//
// Crea varios operadores de una — el admin carga nombre, email y
// contraseña para cada uno (en vez de una invitación por correo), así
// puede entregarles el acceso ya armado. Solo un admin puede llamarla.
// Devuelve el resultado de cada fila (ok o error), no corta todo si una falla.

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
    const password = String(row.password ?? "").trim();

    if (!full_name || !email || !password) {
      results.push({ email: email || "(vacío)", success: false, error: "Falta nombre, email o contraseña" });
      continue;
    }
    if (password.length < 6) {
      results.push({ email, success: false, error: "La contraseña debe tener al menos 6 caracteres" });
      continue;
    }

    try {
      // Se crea con contraseña ya definida y el mail confirmado — el
      // operador puede entrar directo, sin pasar por el link de invitación.
      const { data: created, error: createError } = await serviceClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (createError) throw createError;

      const { error: insertError } = await serviceClient.from("operators").insert({
        auth_user_id: created.user.id,
        full_name,
        is_admin: false,
        is_active: true,
        presence: "offline",
      });
      if (insertError) throw insertError;

      // Sin esto el operador nuevo queda invisible para el round robin —
      // no hay forma de repartirle nada si no está anotado en ninguna cola.
      const { data: allQueues } = await serviceClient.from("queues").select("id");
      if (allQueues && allQueues.length > 0) {
        const { data: newOp } = await serviceClient
          .from("operators")
          .select("id")
          .eq("auth_user_id", created.user.id)
          .single();
        if (newOp) {
          await serviceClient
            .from("queue_members")
            .insert(allQueues.map((q) => ({ queue_id: q.id, operator_id: newOp.id })));
        }
      }

      results.push({ email, success: true });
    } catch (err: any) {
      results.push({ email, success: false, error: err.message ?? String(err) });
    }
  }

  return new Response(JSON.stringify({ results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});