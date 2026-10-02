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
// Todo esto se confirmó probando contra la API real (modo debug), no
// estaba documentado así de memoria:
//   1. El rango pedido tiene que ser ESTRICTAMENTE más largo que el
//      intervalo (ANL-305) — pedir exactamente 1 hora con interval=Hour
//      lo rechaza, así que acá se piden 2 horas y se descarta la que sobra.
//   2. responseOptions.counters no acepta {sum:[...]} (ANL-202) — es un
//      set fijo de breakdowns; "callsByResponse" trae
//      answered/notAnswered/connected/notConnected.
//   3. Cada registro trae un array "points" (uno por hora dentro del
//      rango), no un contador plano, y la extensión real está en
//      record.info.extensionNumber (lo que tenemos guardado en
//      operators.ringcentral_extension_id) — "key" NO es la extensión.
//   4. page/perPage van como QUERY PARAM, no en el body (ANL-202 si se
//      manda "paging" en el body). El máximo de perPage es 20 (ANL-503
//      si se pide más) — con ~60 operadores hacen falta 3 páginas, así
//      que se loopea hasta totalPages.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSetting } from "../_shared/settings.ts";
import { getRingCentralAccessToken } from "../_shared/ringcentral.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const PER_PAGE = 20;
const MAX_PAGES = 10; // techo de seguridad — a ~20 operadores por página, cubre hasta 200 operadores

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
  const hourStartMs = hourStart.getTime();

  // RingCentral rechaza un rango de EXACTAMENTE 1 hora con intervalo
  // "Hour" (ANL-305) — el intervalo tiene que ser estrictamente más
  // chico que el rango pedido. Se pide una ventana de 2 horas y después
  // nos quedamos solo con el punto que arranca en hourStart.
  const queryFrom = new Date(hourStart.getTime() - 3_600_000);
  const queryTo = hourEnd;

  try {
    const rcServer = (await getSetting("RINGCENTRAL_SERVER_URL")) ?? "https://platform.ringcentral.com";
    const accessToken = await getRingCentralAccessToken();

    const requestBody = JSON.stringify({
      grouping: { groupBy: "Users" },
      timeSettings: {
        timeZone: "UTC",
        timeRange: { timeFrom: queryFrom.toISOString(), timeTo: queryTo.toISOString() },
      },
      responseOptions: {
        counters: { callsByResponse: true },
      },
    });

    const allRecords: any[] = [];
    let page = 1;
    let totalPages = 1;
    let lastPaging: any = null;

    do {
      const res = await fetch(
        `${rcServer}/analytics/calls/v1/accounts/~/timeline/fetch?interval=Hour&page=${page}&perPage=${PER_PAGE}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: requestBody,
        },
      );

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(`RingCentral Analytics rechazó el pedido (página ${page}): ${JSON.stringify(data)}`);
      }

      lastPaging = data?.paging ?? null;
      totalPages = data?.paging?.totalPages ?? 1;
      allRecords.push(...(data?.data?.records ?? []));
      page++;
    } while (page <= totalPages && page <= MAX_PAGES);

    // Modo de prueba: devuelve todo lo que se juntó de todas las
    // páginas, sin escribir nada en la base.
    if (body.debug) {
      return new Response(
        JSON.stringify(
          {
            hourStart: hourStart.toISOString(),
            hourEnd: hourEnd.toISOString(),
            totalPages,
            paginasTraidas: page - 1,
            lastPaging,
            records: allRecords,
          },
          null,
          2,
        ),
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

    const updates: { operator_id: string; hour_bucket: string; calls_answered: number; computed_at: string }[] = [];
    const computedAt = new Date().toISOString();
    let sinMatch = 0;

    for (const record of allRecords) {
      const extensionNumber = String(record?.info?.extensionNumber ?? "");
      const operatorId = extensionToOperator.get(extensionNumber);
      if (!operatorId) {
        sinMatch++;
        continue;
      }

      const points: any[] = record?.points ?? [];
      const point = points.find((p) => new Date(p?.time).getTime() === hourStartMs);
      const answered = Number(point?.counters?.callsByResponse?.values?.answered ?? 0);

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

    if (totalPages > MAX_PAGES) {
      await supabase.from("app_errors").insert({
        context: "ringcentral-metrics-sync",
        message: `Atención: la Analytics API devolvió ${totalPages} páginas para la hora ${hourStart.toISOString()} — el techo de seguridad es ${MAX_PAGES}, puede haber operadores sin sincronizar.`,
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        hourStart: hourStart.toISOString(),
        hourEnd: hourEnd.toISOString(),
        recordsRecibidos: allRecords.length,
        operadoresActualizados: updates.length,
        sinMatchDeExtension: sinMatch,
        totalPages,
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