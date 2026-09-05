// supabase/functions/_shared/settings.ts
//
// Helper compartido: busca valores de configuración en la tabla
// integration_settings (lo que carga el admin desde el panel), con
// respaldo en los secrets de la CLI si no están cargados ahí.
//
// getSettings() (plural) trae varias claves de una sola consulta, en vez
// de una consulta por clave — cada consulta es un viaje de red completo,
// así que agrupar varias de una achica bastante la demora total.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

export async function getSetting(key: string, envFallbackName?: string): Promise<string | null> {
  const { data } = await supabase
    .from("integration_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  if (data?.value) return data.value;
  if (envFallbackName) return Deno.env.get(envFallbackName) ?? null;
  return null;
}

export async function getSettings(keys: string[]): Promise<Record<string, string | null>> {
  const { data } = await supabase
    .from("integration_settings")
    .select("key, value")
    .in("key", keys);

  const result: Record<string, string | null> = {};
  for (const key of keys) result[key] = null;
  for (const row of data ?? []) {
    if (row.value) result[row.key] = row.value;
  }
  return result;
}