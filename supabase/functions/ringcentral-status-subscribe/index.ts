// supabase/functions/ringcentral-status-subscribe/index.ts
//
// OJO: esto es una suscripción DISTINTA e INDEPENDIENTE de la que ya
// tenías (setup-ringcentral-subscription, con su propia clave
// RINGCENTRAL_SUBSCRIPTION_ID) — esa es la que trae los SMS entrantes de
// los clientes y los avisos de llamada perdida, y esta función NO la
// toca para nada. Esta usa sus propias claves separadas
// (RINGCENTRAL_STATUS_*) a propósito, para no pisarla nunca.
//
// Da de alta (o renueva) la suscripción de RingCentral que hace que
// ringcentral-status-webhook reciba un aviso cada vez que cambia el
// estado de un SMS que MANDAMOS nosotros (entregado / falló). Las
// suscripciones de RingCentral vencen solas (máximo 7 días para este
// tipo), así que esta función está pensada para llamarse:
//   1. Una vez a mano, para darla de alta la primera vez.
//   2. Todos los días desde ahí en más, vía pg_cron (ver el SQL) — no
//      hace falta tocar esto de nuevo salvo que cambien las
//      credenciales de RingCentral.
//
// Requiere que RINGCENTRAL_STATUS_WEBHOOK_URL y
// RINGCENTRAL_STATUS_WEBHOOK_SECRET ya estén cargados en Integrations, y
// que ringcentral-status-webhook ya esté deployada y sea alcanzable
// públicamente ANTES de llamar a esta función — RingCentral valida el
// endpoint en el momento de crear la suscripción, y si no responde, la
// rechaza.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSetting, getSettings } from "../_shared/settings.ts";
import { getRingCentralAccessToken } from "../_shared/ringcentral.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  // No la llama ningún proveedor externo (a diferencia de los otros
  // webhooks) — la llamamos nosotros mismos a mano o desde pg_cron, así
  // que alcanza con el mismo secreto compartido como header simple.
  const expectedSecret = await getSetting("RINGCENTRAL_STATUS_WEBHOOK_SECRET");
  const receivedSecret = req.headers.get("X-Webhook-Secret");
  if (expectedSecret && receivedSecret !== expectedSecret) {
    return new Response(JSON.stringify({ error: "Secreto inválido" }), { status: 401 });
  }

  try {
    const settings = await getSettings([
      "RINGCENTRAL_SERVER_URL",
      "RINGCENTRAL_STATUS_WEBHOOK_URL",
      "RINGCENTRAL_STATUS_WEBHOOK_SECRET",
      "RINGCENTRAL_STATUS_SUBSCRIPTION_ID",
    ]);
    const rcServer = settings.RINGCENTRAL_SERVER_URL ?? "https://platform.ringcentral.com";
    const webhookUrl = settings.RINGCENTRAL_STATUS_WEBHOOK_URL;
    const webhookSecret = settings.RINGCENTRAL_STATUS_WEBHOOK_SECRET;

    if (!webhookUrl) {
      throw new Error(
        "Falta cargar RINGCENTRAL_STATUS_WEBHOOK_URL en Integrations (la URL pública de la función ringcentral-status-webhook, ya deployada).",
      );
    }

    const accessToken = await getRingCentralAccessToken();
    const deliveryAddress = webhookSecret
      ? `${webhookUrl}${webhookUrl.includes("?") ? "&" : "?"}secret=${encodeURIComponent(webhookSecret)}`
      : webhookUrl;

    // Si ya había una suscripción de ESTA (de una renovación anterior),
    // se borra primero — RingCentral no deja tener dos activas para la
    // misma dirección y el mismo filtro de eventos. Esto usa su propia
    // clave separada, nunca toca RINGCENTRAL_SUBSCRIPTION_ID (la de los
    // SMS entrantes).
    if (settings.RINGCENTRAL_STATUS_SUBSCRIPTION_ID) {
      await fetch(`${rcServer}/restapi/v1.0/subscription/${settings.RINGCENTRAL_STATUS_SUBSCRIPTION_ID}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch(() => {}); // si ya había vencido sola, esto puede fallar sin problema, se ignora
    }

    const res = await fetch(`${rcServer}/restapi/v1.0/subscription`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        eventFilters: ["/restapi/v1.0/account/~/extension/~/message-store"],
        deliveryMode: { transportType: "WebHook", address: deliveryAddress },
        // El máximo que permite RingCentral para este tipo de entrega —
        // por eso hace falta renovarla seguido (ver pg_cron).
        expiresIn: 604800,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`RingCentral rechazó el alta de la suscripción: ${JSON.stringify(data)}`);
    }

    await supabase.from("integration_settings").upsert({
      key: "RINGCENTRAL_STATUS_SUBSCRIPTION_ID",
      value: String(data.id),
      updated_at: new Date().toISOString(),
    });

    return new Response(
      JSON.stringify({ success: true, subscriptionId: data.id, expirationTime: data.expirationTime }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("No se pudo dar de alta/renovar la suscripción de estado de RingCentral:", message);
    await supabase.from("app_errors").insert({
      context: "ringcentral-status-subscribe",
      message: `No se pudo dar de alta/renovar la suscripción de estado de RingCentral: ${message}`,
    });
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
