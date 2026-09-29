// supabase/functions/ringcentral-status-webhook/index.ts
//
// OJO: esto es una suscripción DISTINTA e INDEPENDIENTE de la que ya
// tenías (setup-ringcentral-subscription / ringcentral-webhook, que es
// la que recibe los SMS entrantes de los clientes y los avisos de
// llamada perdida — esa no se toca acá). Esta es solo para enterarse si
// un SMS que MANDAMOS nosotros se entregó o falló.
//
// Recibe los avisos de la suscripción de RingCentral al "message-store"
// (ver ringcentral-status-subscribe). OJO: a diferencia del webhook de
// Meta, este aviso NO trae el mensaje ni su estado adentro — solo dice
// "algo cambió en tus SMS", así que hay que ir a buscar a la API los
// mensajes recientes y fijarse cuáles tienen un estado nuevo.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSetting, getSettings } from "../_shared/settings.ts";
import { getRingCentralAccessToken } from "../_shared/ringcentral.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Orden de "avance" de un estado — igual que con WhatsApp, para no pisar
// un estado más avanzado con uno viejo si los avisos llegan medio
// desordenados.
const STATUS_MAP: Record<string, "sent" | "delivered" | "failed"> = {
  Queued: "sent",
  SubmitFailed: "failed",
  Sent: "sent",
  Delivered: "delivered",
  DeliveryFailed: "failed",
  SendingFailed: "failed",
};
const STATUS_RANK: Record<string, number> = { sent: 1, delivered: 2, failed: 3 };

Deno.serve(async (req) => {
  // Paso de validación: cuando se da de alta (o se renueva) la
  // suscripción, RingCentral manda este header y espera que se lo
  // devolvamos tal cual, para confirmar que este endpoint es de
  // verdad nuestro. Sin esto, RingCentral nunca termina de activar la
  // suscripción.
  const validationToken = req.headers.get("Validation-Token");
  if (validationToken) {
    return new Response(null, { status: 200, headers: { "Validation-Token": validationToken } });
  }

  // RingCentral no permite mandar un header custom en la suscripción —
  // por eso el secreto se valida como query param (?secret=...) en la
  // URL que se registró, no como header.
  const url = new URL(req.url);
  const expectedSecret = await getSetting("RINGCENTRAL_STATUS_WEBHOOK_SECRET");
  if (expectedSecret && url.searchParams.get("secret") !== expectedSecret) {
    return new Response("Forbidden", { status: 403 });
  }

  // El body del aviso en sí no sirve de nada (no trae el estado) — se
  // descarta y se va derecho a preguntarle a la API qué cambió.
  await req.text().catch(() => {});

  try {
    const accessToken = await getRingCentralAccessToken();
    const settings = await getSettings(["RINGCENTRAL_SERVER_URL", "RINGCENTRAL_EXTENSION_ID"]);
    const rcServer = settings.RINGCENTRAL_SERVER_URL ?? "https://platform.ringcentral.com";
    const extensionId = settings.RINGCENTRAL_EXTENSION_ID || "~";

    // Los últimos 30 minutos alcanzan de sobra — este aviso llega casi
    // al instante de que algo cambia, y se pide varias veces por hora
    // entre las renovaciones, así que no hace falta ir más atrás.
    const dateFrom = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const listUrl =
      `${rcServer}/restapi/v1.0/account/~/extension/${extensionId}/message-store` +
      `?dateFrom=${encodeURIComponent(dateFrom)}&messageType=SMS&direction=Outbound&perPage=100`;

    const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!listRes.ok) {
      console.error("No se pudo consultar message-store de RingCentral:", await listRes.text());
      return new Response("OK (no se pudo consultar el estado)", { status: 200 });
    }

    const listData = await listRes.json();

    for (const msg of listData.records ?? []) {
      const rcId = msg?.id ? String(msg.id) : null;
      const rcStatus = msg?.messageStatus as string | undefined;
      if (!rcId || !rcStatus) continue;

      const mappedStatus = STATUS_MAP[rcStatus];
      if (!mappedStatus) continue; // estado que no nos interesa (ej: "Received", que es entrante)

      const { data: existing } = await supabase
        .from("messages")
        .select("id, delivery_status")
        .eq("rc_message_id", rcId)
        .maybeSingle();
      if (!existing) continue; // no es un mensaje mandado desde acá (o el insert todavía no terminó)

      const currentRank = STATUS_RANK[existing.delivery_status ?? ""] ?? 0;
      const newRank = STATUS_RANK[mappedStatus];
      if (mappedStatus !== "failed" && newRank <= currentRank) continue;

      const patch: Record<string, unknown> = { delivery_status: mappedStatus };
      if (mappedStatus === "delivered") patch.delivered_at = new Date().toISOString();

      await supabase.from("messages").update(patch).eq("id", existing.id);

      if (mappedStatus === "failed" && existing.delivery_status !== "failed") {
        await supabase.from("app_errors").insert({
          context: "ringcentral-status-webhook",
          message: `RingCentral marcó un SMS como fallido después de aceptarlo (estado: ${rcStatus}).`,
          stack: JSON.stringify(msg, null, 2),
        });
      }
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    // Nunca se le devuelve error a RingCentral por esto — si algo sale
    // mal acá, que se reintente solo en el próximo aviso, no tiene
    // sentido que RingCentral vea esto como un endpoint roto.
    console.error("Error procesando el webhook de RingCentral:", err);
    return new Response("OK (error interno, ver logs)", { status: 200 });
  }
});
