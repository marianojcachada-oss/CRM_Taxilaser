// supabase/functions/send-message/index.ts
//
// Manda un mensaje saliente de verdad al canal elegido (no solo lo guarda
// en la base). SMS (RingCentral), WhatsApp, Facebook e Instagram (Meta)
// están implementados — todos dependen de que las credenciales
// correspondientes estén cargadas en Integrations.
//
// Optimizado para que las consultas que no dependen entre sí salgan en
// paralelo (Promise.all) en vez de una atrás de la otra — cada consulta
// es un viaje de red completo, así que esto achica bastante la demora
// total sentida al apretar Enter.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSettings } from "../_shared/settings.ts";
import { sendSms } from "../_shared/ringcentral.ts";

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

  const { conversationId, channel, text, attachmentUrl, attachmentName, attachmentKind } = await req.json();

  if (!conversationId || !channel || (!text && !attachmentUrl)) {
    return new Response(JSON.stringify({ error: "Faltan conversationId, channel, y text o attachmentUrl" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  // Identificar al operador y buscar la conversación al mismo tiempo —
  // son dos consultas que no dependen una de la otra.
  const [userResult, conversationResult] = await Promise.all([
    callerClient.auth.getUser(),
    serviceClient.from("conversations").select("id, contact_id, contacts(phone)").eq("id", conversationId).single(),
  ]);

  if (userResult.error || !userResult.data.user) {
    return new Response(
      JSON.stringify({ error: "No autenticado: " + (userResult.error?.message ?? "sin usuario en la sesión") }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  const userData = userResult.data;

  const conversation = conversationResult.data;
  if (!conversation) {
    return new Response(
      JSON.stringify({ error: "Conversación no encontrada: " + (conversationResult.error?.message ?? "") }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { data: operator } = await serviceClient
    .from("operators")
    .select("id")
    .eq("auth_user_id", userData.user.id)
    .single();

  if (!operator) {
    return new Response(JSON.stringify({ error: "Operador no encontrado" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const phone = (conversation as any).contacts?.phone;

  // Solo hace falta buscar el ID externo (PSID/IGSID) cuando el canal es
  // Messenger o Instagram — WhatsApp y SMS ya resuelven todo por teléfono.
  let recipientExternalId: string | null = null;
  if (channel === "facebook" || channel === "instagram") {
    const { data: contactChannel } = await serviceClient
      .from("contact_channels")
      .select("external_id")
      .eq("contact_id", conversation.contact_id)
      .eq("channel", channel)
      .maybeSingle();
    recipientExternalId = contactChannel?.external_id ?? null;
  }

  try {
    if (channel === "sms") {
      if (!phone) throw new Error("El contacto no tiene teléfono cargado");

      if (attachmentUrl) {
        // RingCentral necesita los bytes de verdad para un MMS — bajamos
        // el archivo de nuestro propio Storage antes de mandarlo.
        const fileRes = await fetch(attachmentUrl);
        if (!fileRes.ok) throw new Error("No se pudo descargar el adjunto para mandarlo por SMS");
        const bytes = new Uint8Array(await fileRes.arrayBuffer());
        const mimeType = fileRes.headers.get("content-type") ?? "application/octet-stream";
        const filename = attachmentName || "adjunto";

        await sendSms(phone, text ?? "", { bytes, filename, mimeType });
      } else {
        await sendSms(phone, text);
      }
    } else if (channel === "whatsapp") {
      if (!phone) throw new Error("El contacto no tiene teléfono cargado");

      const metaSettings = await getSettings(["META_ACCESS_TOKEN", "META_PHONE_NUMBER_ID"]);
      const metaToken = metaSettings.META_ACCESS_TOKEN;
      const phoneNumberId = metaSettings.META_PHONE_NUMBER_ID;

      if (!metaToken || !phoneNumberId) {
        throw new Error(
          "Falta cargar META_ACCESS_TOKEN o META_PHONE_NUMBER_ID en Integrations para poder enviar por WhatsApp.",
        );
      }

      // WhatsApp espera el teléfono sin "+" y sin espacios
      const toNumber = phone.replace(/[^\d]/g, "");

      let body: Record<string, unknown>;

      if (attachmentUrl) {
        // Meta acepta mandar el adjunto directo por URL pública (link),
        // sin tener que subirlo antes a sus servidores — nuestro Storage
        // ya lo sirve público, así que alcanza con esto.
        const mediaType = attachmentKind === "image" ? "image" : attachmentKind === "audio" ? "audio" : "document";
        body = {
          messaging_product: "whatsapp",
          to: toNumber,
          type: mediaType,
          [mediaType]:
            mediaType === "document"
              ? { link: attachmentUrl, filename: attachmentName || "archivo", caption: text || undefined }
              : { link: attachmentUrl, caption: mediaType === "image" ? text || undefined : undefined },
        };
      } else {
        body = {
          messaging_product: "whatsapp",
          to: toNumber,
          type: "text",
          text: { body: text },
        };
      }

      const res = await fetch(`https://graph.facebook.com/v26.0/${phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${metaToken}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        // Fuera de la ventana de 24hs desde el último mensaje del cliente,
        // WhatsApp exige un template aprobado en vez de texto libre — este
        // es el error más probable si el envío falla acá.
        throw new Error(`Meta (WhatsApp) rechazó el envío: ${JSON.stringify(errData)}`);
      }
    } else if (channel === "facebook" || channel === "instagram") {
      // Messenger e Instagram comparten el mismo "Send API" de Meta — el
      // token del System User (META_ACCESS_TOKEN) alcanza para los dos
      // siempre que tenga los permisos pages_messaging +
      // instagram_manage_messages, y que la Página/cuenta de Instagram
      // estén agregadas como activos de ese mismo token en Meta Business
      // Suite. No hace falta un token de página aparte.
      if (!recipientExternalId) {
        throw new Error(
          `Falta el ID externo del contacto en ${channel} — no se puede mandar el mensaje sin saber a quién.`,
        );
      }

      const metaSettings = await getSettings(["META_ACCESS_TOKEN"]);
      const metaToken = metaSettings.META_ACCESS_TOKEN;
      if (!metaToken) {
        throw new Error("Falta cargar META_ACCESS_TOKEN en Integrations para poder enviar.");
      }

      const body: Record<string, unknown> = {
        recipient: { id: recipientExternalId },
        message: attachmentUrl
          ? {
              attachment: {
                type: attachmentKind === "image" ? "image" : attachmentKind === "audio" ? "audio" : "file",
                payload: { url: attachmentUrl, is_reusable: true },
              },
            }
          : { text: text ?? "" },
        messaging_type: "RESPONSE",
      };

      const res = await fetch(`https://graph.facebook.com/v26.0/me/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${metaToken}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        // Fuera de la ventana de 24hs desde el último mensaje del cliente,
        // Meta exige un "message tag" especial en vez de texto libre —
        // este es el error más probable si el envío falla acá.
        throw new Error(`Meta (${channel}) rechazó el envío: ${JSON.stringify(errData)}`);
      }
    } else {
      throw new Error(`Canal desconocido: ${channel}`);
    }

    const { data: insertedMessage, error: insertError } = await serviceClient
      .from("messages")
      .insert({
        conversation_id: conversationId,
        sender_type: "operator",
        sender_operator_id: operator.id,
        content: text || null,
        sent_via_channel: channel,
        attachment_url: attachmentUrl || null,
        attachment_name: attachmentName || null,
        attachment_kind: attachmentKind || null,
      })
      .select("id")
      .single();

    if (insertError) throw new Error(insertError.message);

    return new Response(JSON.stringify({ success: true, messageId: insertedMessage.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err instanceof Error ? err.message : err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});