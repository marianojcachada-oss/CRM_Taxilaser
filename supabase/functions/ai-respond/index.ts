// supabase/functions/ai-respond/index.ts
//
// Etapa 1 de la IA configurable: el botón "Responder con IA" (visible
// solo para el superadmin, desde ConversationsView.tsx) llama a esta
// función. Genera una respuesta con la API de Claude, la manda de
// verdad al cliente (por el canal que corresponda, reusando
// sendAutomatedMessage — mismo mecanismo que los avisos automáticos de
// TaxiCaller) y la deja guardada en el historial como mensaje
// automático (automation_type: "ai_response").
//
// Tres llaves en Integrations controlan esto:
//  - AI_ENABLED: llave maestra. Si está en "false", esta función corta
//    de entrada y no llama a Claude ni manda nada.
//  - AI_SYSTEM_PROMPT: la personalidad y las reglas de la IA, en texto
//    plano, editable desde el panel sin tocar código ni redesplegar
//    nada. Si se deja vacío, se usa DEFAULT_SYSTEM_PROMPT de más abajo.
//  - AI_AUTO_REPLY_ALL: todavía NO está conectada a nada acá — queda
//    guardada en integration_settings lista para cuando se conecte el
//    modo automático en los webhooks de entrada (Etapa 2). Prenderla
//    hoy no tiene ningún efecto.
//
// Solo el superadmin puede llamar a esta función — se verifica ACÁ
// ADENTRO, no alcanza con que el botón esté escondido en el frontend,
// porque esto manda mensajes reales a clientes reales.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSettings } from "../_shared/settings.ts";
import { askClaude, type ClaudeMessage } from "../_shared/claudeClient.ts";
import { sendAutomatedMessage } from "../_shared/automatedMessage.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

// Red de seguridad, no lo que vos editás día a día: si AI_SYSTEM_PROMPT
// queda vacío en Integrations (por ejemplo, recién instalado esto), la
// IA igual arranca con reglas conservadoras en vez de quedar sin ninguna.
// Lo normal es ir ajustando el texto desde el panel, no este archivo.
const DEFAULT_SYSTEM_PROMPT = `Sos el asistente de atención al cliente de Taxi Laser, una empresa de taxis en Atlanta. Respondés por WhatsApp a nombre de la empresa.

Reglas que NUNCA podés romper:
- NUNCA cancelás un viaje vos. Si el cliente pide cancelar, respondé con amabilidad que un operador lo va a atender ya mismo, y mencioná (si te los paso como dato real más abajo) la unidad asignada y los minutos de llegada — nunca inventes esos datos si no te los dieron.
- NO podés crear ni reservar un viaje nuevo todavía, ni cotizar una tarifa — si el cliente pide eso, decile amablemente que un operador le va a confirmar el precio o la reserva en breve.
- Si te preguntan dónde está el taxi y te paso datos del viaje activo (unidad, color, patente, minutos de espera), contestá con ESOS datos exactos, nunca inventes ninguno.
- Si el pedido no encaja en nada de lo anterior, o no estás seguro, decile que un operador le va a responder en breve — no improvises.
- Respondé en el mismo idioma en que te escribió el cliente (español o inglés).
- Sé breve y cordial, como lo sería un operador humano — no uses firmas tipo "Atentamente" ni te presentes como una inteligencia artificial.`;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "No autenticado" }, 401);
  }

  const { conversationId } = await req.json().catch(() => ({}));
  if (!conversationId) {
    return jsonResponse({ error: "Falta conversationId" }, 400);
  }

  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  // 3 cosas que no dependen una de la otra, en paralelo: quién llama, si
  // la IA está prendida, y la conversación con su contacto.
  const [userResult, settings, conversationResult] = await Promise.all([
    callerClient.auth.getUser(),
    getSettings(["AI_ENABLED", "CLAUDE_MODEL", "AI_SYSTEM_PROMPT"]),
    serviceClient
      .from("conversations")
      .select(
        "id, contact_id, contacts(phone, blocked, do_not_contact, has_active_ride, active_ride_unit, active_ride_color, active_ride_plate, active_ride_eta_minutes, active_ride_status)",
      )
      .eq("id", conversationId)
      .single(),
  ]);

  if (userResult.error || !userResult.data.user) {
    return jsonResponse(
      { error: "No autenticado: " + (userResult.error?.message ?? "sin usuario en la sesión") },
      401,
    );
  }

  if (settings.AI_ENABLED !== "true") {
    return jsonResponse({ error: "La IA está desactivada — prendela en Integrations primero." }, 400);
  }

  const { data: operator } = await serviceClient
    .from("operators")
    .select("id, is_superadmin")
    .eq("auth_user_id", userResult.data.user.id)
    .single();

  if (!operator || !operator.is_superadmin) {
    return jsonResponse({ error: "Solo el superadmin puede usar la IA por ahora." }, 403);
  }

  const conversation = conversationResult.data;
  if (!conversation) {
    return jsonResponse({ error: "Conversación no encontrada" }, 404);
  }

  const contact = (conversation as any).contacts;
  if (!contact?.phone) {
    return jsonResponse({ error: "El contacto no tiene teléfono cargado" }, 400);
  }

  if (contact.blocked || contact.do_not_contact) {
    return jsonResponse({ error: "Este contacto está bloqueado o dado de baja — la IA no le manda nada." }, 403);
  }

  // Últimos mensajes de la conversación, para darle contexto a la IA —
  // 20 alcanza para una conversación de ida y vuelta típica sin gastar
  // tokens de más en historial viejo.
  const { data: history } = await serviceClient
    .from("messages")
    .select("sender_type, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(20);

  const orderedHistory = (history ?? []).slice().reverse();

  const claudeMessages: ClaudeMessage[] = orderedHistory
    .filter((m) => m.content && m.content.trim().length > 0)
    .map((m) => ({
      role: m.sender_type === "contact" ? "user" : "assistant",
      content: m.content as string,
    }));

  // Si no hay un mensaje de texto del cliente para responder (todo
  // adjuntos, o la IA ya contestó lo último), no tiene sentido llamar a
  // Claude — evita responder dos veces lo mismo o contestar a nada.
  if (claudeMessages.length === 0 || claudeMessages[claudeMessages.length - 1].role !== "user") {
    return jsonResponse({ error: "No hay un mensaje del cliente reciente para responder." }, 400);
  }

  // Datos reales del viaje activo — SIEMPRE se le manda a Claude un
  // bloque explícito, positivo o negativo. Antes, cuando el cliente no
  // tenía viaje activo, este texto quedaba vacío y el modelo terminaba
  // inventando unidad/ETA porque el propio prompt le mostraba el
  // formato esperado sin datos reales para completarlo. Dejar el campo
  // vacío nunca es una opción acá.
  let contextNote: string;
  if (contact.has_active_ride) {
    contextNote =
      `\n\nEstado del viaje de este cliente: TIENE un viaje activo. Dato real (usalo tal cual, no inventes otro): ` +
      `unidad ${contact.active_ride_unit ?? "sin dato"}, color ${contact.active_ride_color ?? "sin dato"}, ` +
      `patente ${contact.active_ride_plate ?? "sin dato"}, estado "${contact.active_ride_status ?? "sin dato"}", ` +
      `ETA ${contact.active_ride_eta_minutes ?? "sin dato"} minutos.`;
  } else {
    contextNote =
      `\n\nEstado del viaje de este cliente: NO tiene ningún viaje activo registrado en este momento. ` +
      `No hay unidad, color, patente ni ETA real para dar — no inventes ninguno de esos datos. ` +
      `Si pregunta por su taxi, decile que todavía no tiene un viaje asignado y que un operador se va a comunicar.`;
  }

  const basePrompt = settings.AI_SYSTEM_PROMPT?.trim() || DEFAULT_SYSTEM_PROMPT;

  let result;
  try {
    result = await askClaude({
      systemPrompt: basePrompt + contextNote,
      messages: claudeMessages,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await serviceClient.from("ai_usage_log").insert({
      conversation_id: conversationId,
      triggered_by_operator_id: operator.id,
      mode: "manual",
      model: settings.CLAUDE_MODEL || "claude-haiku-4-5",
      success: false,
      error_message: message,
    });
    return jsonResponse({ error: message }, 502);
  }

  if (!result.text) {
    return jsonResponse({ error: "La IA no devolvió ningún texto." }, 502);
  }

  const { sentVia, errors, wamid, rcMessageId } = await sendAutomatedMessage({
    contactId: conversation.contact_id,
    phone: contact.phone,
    text: result.text,
  });

  if (sentVia.length === 0) {
    await serviceClient.from("ai_usage_log").insert({
      conversation_id: conversationId,
      triggered_by_operator_id: operator.id,
      mode: "manual",
      model: result.model,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      success: false,
      error_message: "No se pudo mandar por ningún canal: " + JSON.stringify(errors),
    });
    return jsonResponse({ error: "No se pudo mandar el mensaje: " + JSON.stringify(errors) }, 502);
  }

  // Registrar el mensaje que se mandó, para que quede visible en el
  // hilo — mismo patrón que cualquier otro aviso automático.
  await serviceClient.from("messages").insert({
    conversation_id: conversationId,
    sender_type: "operator",
    content: result.text,
    sent_via_channel: sentVia.join(",") || "whatsapp",
    automation_type: "ai_response",
    wamid,
    rc_message_id: rcMessageId,
    delivery_status: "sent",
  });

  await serviceClient.from("ai_usage_log").insert({
    conversation_id: conversationId,
    triggered_by_operator_id: operator.id,
    mode: "manual",
    model: result.model,
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    success: true,
  });

  return jsonResponse({ text: result.text, sentVia });
});
