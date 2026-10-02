// supabase/functions/ringcentral-metrics-sync/index.ts
//
// Trae de RingCentral, UNA vez por hora, la cantidad de llamadas
// ATENDIDAS por operador durante la hora recién cerrada, y la guarda en
// hourly_operator_metrics.calls_answered (la misma tabla que ya llena
// compute_hourly_operator_metrics() para mensajes). No toca mensajes ni
// servicios — solo la columna de llamadas.
//
// Mismo patrón que ringcentral-status-subscribe: no la llama ningún
// proveedor externo, la llama pg_cron (ver el SQL) con un secreto propio
// como header simple — no hace falta login de usuario.
//
// Requiere:
//   - operators.ringcentral_extension_id ya cargado (metrics_fase2_extensions.sql)
//   - RINGCENTRAL_METRICS_SYNC_SECRET cargado en Integrations
//
// OJO — esto todavía no está probado contra una respuesta real de la
// Analytics API: el nombre exacto del campo del contador de "llamadas
// atendidas" puede no ser "AnsweredCalls" tal cual está acá. Por eso el
// modo "debug" de abajo: antes de dejarlo corriendo solo por cron, llamalo
// una vez a mano con { "debug": true } y pasame el "raw" que devuelve —
// así ajustamos el nombre del campo si hace falta, sin tocar nada en la
// base todavía.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSetting } from "../_shared/settings.ts";
import { getRingCentralAccessToken } from "../_shared/ringcentral.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function truncToHour(d: Date): Date {
  const t = new Date(d);
  t.setUTCMinutes(0, 0, 0);
  return t;
}

Deno.serve(async (req) => {
  const expectedSecret = await getSetting("RINGCENTRAL_METRICS_SYNC_SECRET");
  const receivedSecret = req.headers.get("X-Webhook-Secret");
  if (expectedSecret && receivedSecret !== expectedSecret) {
    return new Response(JSON.stringify({ error: "Secreto inválido" }), { status: 401 });
  }

  const body = await req.json().catch(() => ({}));

  // Hora a sincronizar: por default, la última hora ya cerrada (UTC). Se
  // puede pedir otra a mano con { "hour": "2026-10-02T05:00:00.000Z" }
  // para backfill o pruebas puntuales.
  const hourStart = body.hour ? truncToHour(new Date(body.hour)) : truncToHour(new Date(Date.now() - 3_600_000));
  const hourEnd = new Date(hourStart.getTime() + 3_600_000);

  try {
    const rcServer = (await getSetting("RINGCENTRAL_SERVER_URL")) ?? "https://platform.ringcentral.com";
    const accessToken = await getRingCentralAccessToken();

    const res = await fetch(`${rcServer}/analytics/calls/v1/accounts/~/timeline/fetch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        grouping: { groupBy: "Users" },
        timeSettings: {
          timeZone: "UTC",
          timeRange: { timeFrom: hourStart.toISOString(), timeTo: hourEnd.toISOString() },
          interval: "Hour",
        },
        responseOptions: {
          counters: { sum: ["AnsweredCalls"] },
        },
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(`RingCentral Analytics rechazó el pedido: ${JSON.stringify(data)}`);
    }

    // Modo de prueba: devuelve la respuesta cruda de RingCentral sin
    // escribir nada en la base, para confirmar una sola vez la forma
    // exacta de la respuesta antes de dejarlo corriendo solo.
    if (body.debug) {
      return new Response(
        JSON.stringify({ hourStart: hourStart.toISOString(), hourEnd: hourEnd.toISOString(), raw: data }, null, 2),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    const { data: operators } = await supabase
      .from("operators")
      .select("id, ringcentral_extension_id")
      .not("ringcentral_extension_id", "is", null);

    const extensionToOperator = new Map<string, string>(
      (operators ?? [])
        .filter((op) => op.ringcentral_extension_id)
        .map((op) => [op.ringcentral_extension_id as string, op.id as string]),
    );

    const records: any[] = data?.records ?? [];
    const updates: { operator_id: string; hour_bucket: string; calls_answered: number; computed_at: string }[] = [];
    const computedAt = new Date().toISOString();

    for (const record of records) {
      const extensionId = String(
        record?.dimensions?.userDetails?.extensionId ?? record?.dimensions?.extensionId ?? "",
      );
      const operatorId = extensionToOperator.get(extensionId);
      if (!operatorId) continue;

      const countersList: any[] = record?.counters ?? [];
      const answeredEntry = Array.isArray(countersList)
        ? countersList.find((c) => c?.name === "AnsweredCalls")
        : null;
      const answered = Number(answeredEntry?.sum ?? record?.counters?.AnsweredCalls?.sum ?? 0);

      updates.push({
        operator_id: operatorId,
        hour_bucket: hourStart.toISOString(),
        calls_answered: answered,
        computed_at: computedAt,
      });
    }

    if (updates.length > 0) {
      const { error: upsertError } = await supabase
        .from("hourly_operator_metrics")
        .upsert(updates, { onConflict: "operator_id,hour_bucket" });

      if (upsertError) throw new Error(`No se pudo guardar calls_answered: ${upsertError.message}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        hourStart: hourStart.toISOString(),
        hourEnd: hourEnd.toISOString(),
        recordsRecibidos: records.length,
        operadoresActualizados: updates.length,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("No se pudo sincronizar llamadas de RingCentral:", message);
    await supabase.from("app_errors").insert({
      context: "ringcentral-metrics-sync",
      message: `No se pudo sincronizar llamadas de RingCentral: ${message}`,
    });
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
