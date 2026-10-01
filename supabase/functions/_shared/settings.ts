// supabase/functions/_shared/settings.ts
//
// Helper compartido: busca valores de configuración en la tabla
// integration_settings (lo que carga el admin desde el panel), con
// respaldo en los secrets de la CLI si no están cargados ahí.
//
// getSettings() (plural) trae varias claves de una sola consulta, en vez
// de una consulta por clave — cada consulta es un viaje de red completo,
// así que agrupar varias de una achica bastante la demora total.
//
// CACHE EN MEMORIA (nuevo): antes cada getSetting()/getSettings() era un
// viaje a la base por cada mensaje que entraba o salía (WhatsApp, SMS,
// RingCentral, etc.) — y estos valores son credenciales/flags que se
// tocan desde el panel de admin, no por mensaje, así que casi nunca
// cambian. En los logs de Supabase esto aparecía más de 140 veces por
// minuto, siempre desde el backend. Como las instancias de Edge
// Functions se mantienen "calientes" y se reusan entre invocaciones
// seguidas (que es exactamente lo que pasa con mucho tráfico de
// mensajes), un cache corto en memoria corta la gran mayoría de esos
// viajes a la base sin que un cambio de configuración tarde más de 60
// segundos en reflejarse.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const CACHE_TTL_MS = 60_000; // 60 segundos — balance entre ahorro real y que un cambio de config se note rápido

type CacheEntry = { value: string | null; expiresAt: number };
const cache = new Map<string, CacheEntry>();

function getFromCache(key: string): CacheEntry | undefined {
  const entry = cache.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry;
  return undefined;
}

export async function getSetting(key: string, envFallbackName?: string): Promise<string | null> {
  const cached = getFromCache(key);
  if (cached) {
    if (cached.value) return cached.value;
    return envFallbackName ? Deno.env.get(envFallbackName) ?? null : null;
  }

  const { data } = await supabase
    .from("integration_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  const value = data?.value ?? null;
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });

  if (value) return value;
  if (envFallbackName) return Deno.env.get(envFallbackName) ?? null;
  return null;
}

export async function getSettings(keys: string[]): Promise<Record<string, string | null>> {
  const now = Date.now();
  const missing = keys.filter((k) => !getFromCache(k));

  if (missing.length > 0) {
    const { data } = await supabase
      .from("integration_settings")
      .select("key, value")
      .in("key", missing);

    const found = new Set<string>();
    for (const row of data ?? []) {
      cache.set(row.key, { value: row.value ?? null, expiresAt: now + CACHE_TTL_MS });
      found.add(row.key);
    }
    // Las que no vinieron en el resultado también se cachean como "sin
    // valor" — si no, cada clave sin configurar seguiría generando una
    // consulta nueva en cada invocación.
    for (const k of missing) {
      if (!found.has(k)) cache.set(k, { value: null, expiresAt: now + CACHE_TTL_MS });
    }
  }

  const result: Record<string, string | null> = {};
  for (const key of keys) {
    result[key] = cache.get(key)?.value ?? null;
  }
  return result;
}