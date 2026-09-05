// supabase/functions/translate/index.ts
//
// Traduce texto usando la API de LibreTranslate. La URL/API key se cargan
// desde el panel de Integrations (tabla integration_settings); si no están
// cargadas ahí, usan los secrets de la CLI como respaldo.
// La llama el navegador directamente, así que necesita headers de CORS.

import { getSetting } from "../_shared/settings.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { text, target } = await req.json();

    if (!text || !target) {
      return new Response(JSON.stringify({ error: "Faltan 'text' o 'target'" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const libretranslateUrl =
      (await getSetting("LIBRETRANSLATE_URL", "LIBRETRANSLATE_URL")) ??
      "https://translate.argosopentech.com";
    const apiKey = await getSetting("LIBRETRANSLATE_API_KEY", "LIBRETRANSLATE_API_KEY");

    const body: Record<string, string> = {
      q: text,
      source: "auto",
      target,
      format: "text",
    };
    if (apiKey) body.api_key = apiKey;

    const res = await fetch(`${libretranslateUrl}/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    // Defensivo: si la instancia está caída/mal configurada, puede
    // devolver una página de error en HTML en vez de JSON — sin esto,
    // el .json() explota con un error críptico de sintaxis.
    const rawText = await res.text();
    let data: any;
    try {
      data = JSON.parse(rawText);
    } catch {
      return new Response(
        JSON.stringify({
          error: `La instancia de traducción (${libretranslateUrl}) no devolvió una respuesta válida — probablemente esté caída. Respuesta cruda: ${rawText.slice(0, 150)}`,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!res.ok) {
      return new Response(JSON.stringify({ error: data }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ translated: data.translatedText }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});