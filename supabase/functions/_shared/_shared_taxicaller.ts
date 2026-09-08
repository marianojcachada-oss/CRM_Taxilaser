// supabase/functions/_shared/taxicaller.ts
//
// Busca en la API de TaxiCaller si un teléfono corresponde a un pasajero
// conocido, para poder usar el nombre que ya tienen cargado en vez del
// que manda el canal (o ninguno, en el caso de SMS).
//
// El endpoint EXACTO de búsqueda por teléfono depende de tu plan/versión
// de la API de TaxiCaller — no hay una ruta pública y estable documentada
// para "buscar pasajero por teléfono", así que queda configurable en
// Integrations en vez de hardcodeada acá:
//
//   TAXICALLER_BASE_URL              ej: https://api.taxicaller.net
//   TAXICALLER_API_KEY               tu API key
//   TAXICALLER_PASSENGER_LOOKUP_PATH ej: /api/v1/passengers/search?phone={phone}
//
// Poné el path exacto que te pase soporte de TaxiCaller (o que encuentres
// en su documentación de API para tu cuenta) usando el literal
// "{phone}" donde tiene que ir el teléfono. Si no está cargado, esta
// función no hace nada (no rompe el flujo normal de mensajes).

import { getSettings } from "./settings.ts";

function extractName(data: any): string | null {
  // Probamos varios nombres de campo típicos, porque no sabemos de
  // antemano la forma exacta de la respuesta de tu cuenta.
  const candidates = [
    data?.name,
    data?.full_name,
    data?.fullName,
    data?.passenger_name,
    data?.passengerName,
    data?.client?.name,
    data?.passenger?.name,
    Array.isArray(data?.results) ? data.results[0]?.name ?? data.results[0]?.full_name : undefined,
    Array.isArray(data?.passengers) ? data.passengers[0]?.name ?? data.passengers[0]?.full_name : undefined,
  ];
  const found = candidates.find((c) => typeof c === "string" && c.trim().length > 0);
  return found ?? null;
}

export async function lookupPassengerName(phone: string): Promise<string | null> {
  const settings = await getSettings([
    "TAXICALLER_BASE_URL",
    "TAXICALLER_API_KEY",
    "TAXICALLER_PASSENGER_LOOKUP_PATH",
  ]);

  const baseUrl = settings.TAXICALLER_BASE_URL;
  const apiKey = settings.TAXICALLER_API_KEY;
  const pathTemplate = settings.TAXICALLER_PASSENGER_LOOKUP_PATH;

  if (!baseUrl || !apiKey || !pathTemplate) return null;

  const path = pathTemplate.replace("{phone}", encodeURIComponent(phone));
  const url = baseUrl.replace(/\/+$/, "") + (path.startsWith("/") ? path : `/${path}`);

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;

    const data = await res.json();
    return extractName(data);
  } catch (err) {
    console.error("No se pudo consultar TaxiCaller para buscar el nombre del pasajero:", err);
    return null;
  }
}
