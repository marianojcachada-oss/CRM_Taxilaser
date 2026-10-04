// supabase/functions/_shared/addressResolver.ts
//
// Resuelve un lugar mencionado en lenguaje natural (ej. "el walmart de
// la jimmy carter") a una direccion real y CONFIRMABLE, usando la
// herramienta de busqueda web nativa de la API de Claude -- nunca el
// conocimiento propio del modelo sin buscar. Si no encuentra un
// resultado con confianza alta, devuelve null y el flujo sigue como
// antes (preguntando la ciudad a mano).
//
// Requiere "Permitir busqueda web" habilitado en platform.claude.com ->
// Capabilities (confirmado prendido para esta cuenta el 4/10/2026).
//
// Se mantiene deliberadamente SEPARADO de la conversacion principal con
// el cliente: es una consulta aparte, de una sola pregunta (la ultima
// frase del cliente) y sin tools mezcladas -- asi se evita el caso
// documentado de Anthropic donde mezclar web_search con una tool propia
// en el mismo turno puede dejar la busqueda sin ejecutar. En vez de una
// segunda tool para la respuesta estructurada, se le pide a Claude que
// termine con una linea de JSON en texto plano, y se parsea aca.

import { askClaude, type ClaudeServerTool } from "./claudeClient.ts";
import { SERVICE_AREA } from "./rule-engine/knowledge/serviceArea.ts";

const WEB_SEARCH_TOOL: ClaudeServerTool = {
  type: "web_search_20250305",
  name: "web_search",
  max_uses: 2,
};

function buildSystemPrompt(cities: string[]): string {
  return `Busca en la web (herramienta web_search, nunca tu conocimiento propio sin buscar primero) la direccion real del lugar que el cliente menciona como punto de recogida para un taxi, en esta zona de Georgia: ${cities.join(", ")} y alrededores.

Cuando termines de buscar, tu ULTIMA linea de respuesta tiene que ser EXCLUSIVAMENTE un objeto JSON de una sola linea, sin texto antes ni despues, con esta forma exacta:
{"found": true o false, "place_name": "string o null", "formatted_address": "string o null", "city": "string o null", "confidence": "high" o "low"}

Reglas:
- "found": true SOLO si la busqueda confirmo una direccion concreta.
- "confidence": "low" si hay mas de un lugar posible con ese nombre en la zona, o no estas seguro de cual es -- en ese caso preferi found=false antes que adivinar.
- "city" tiene que ser una de las ciudades de la lista de arriba, o null si no corresponde.
- Si el mensaje del cliente no menciona ningun lugar reconocible (ya es una direccion completa, o no tiene nada que ver con un punto de recogida), devolve {"found": false, "place_name": null, "formatted_address": null, "city": null, "confidence": "low"}.
- Nunca inventes una direccion que la busqueda no haya confirmado.`;
}

export interface AddressMatch {
  placeName: string | null;
  formattedAddress: string;
  city: string | null;
}

/**
 * Intenta resolver el pickup mencionado por el cliente a una direccion
 * real. Nunca lanza -- cualquier falla (red, limite de la API, JSON mal
 * formado) se trata como "no se encontro nada", para no cortar el flujo
 * principal de la conversacion por este paso opcional.
 */
export async function resolvePickupAddress(customerMessage: string): Promise<AddressMatch | null> {
  const cities = SERVICE_AREA.coveredCities;

  let result;
  try {
    result = await askClaude({
      systemPrompt: buildSystemPrompt(cities),
      messages: [{ role: "user", content: customerMessage }],
      maxTokens: 1024,
      tools: [WEB_SEARCH_TOOL],
      toolChoice: { type: "tool", name: "web_search" },
    });
  } catch {
    return null;
  }

  const jsonMatch = result.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  let parsed: {
    found?: boolean;
    place_name?: string | null;
    formatted_address?: string | null;
    city?: string | null;
    confidence?: string;
  };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }

  if (!parsed.found || parsed.confidence !== "high" || !parsed.formatted_address) {
    return null;
  }

  return {
    placeName: parsed.place_name ?? null,
    formattedAddress: parsed.formatted_address,
    city: parsed.city ?? null,
  };
}
