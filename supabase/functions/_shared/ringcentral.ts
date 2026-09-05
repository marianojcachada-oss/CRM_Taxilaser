// supabase/functions/_shared/ringcentral.ts
//
// Intercambia el JWT credential por un token de acceso real de RingCentral,
// con cache. Trae todas las claves que necesita en una sola consulta en
// vez de una por una, para achicar la cantidad de viajes de red.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSettings } from "./settings.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

export async function getRingCentralAccessToken(): Promise<string> {
  const cache = await getSettings(["RINGCENTRAL_ACCESS_TOKEN_CACHE", "RINGCENTRAL_ACCESS_TOKEN_EXPIRES_AT"]);

  const cachedToken = cache.RINGCENTRAL_ACCESS_TOKEN_CACHE;
  const cachedExpiry = cache.RINGCENTRAL_ACCESS_TOKEN_EXPIRES_AT;

  if (cachedToken && cachedExpiry && new Date(cachedExpiry).getTime() > Date.now() + 60_000) {
    return cachedToken;
  }

  const creds = await getSettings([
    "RINGCENTRAL_SERVER_URL",
    "RINGCENTRAL_CLIENT_ID",
    "RINGCENTRAL_CLIENT_SECRET",
    "RINGCENTRAL_JWT",
  ]);

  const serverUrl = creds.RINGCENTRAL_SERVER_URL ?? "https://platform.ringcentral.com";
  const clientId = creds.RINGCENTRAL_CLIENT_ID;
  const clientSecret = creds.RINGCENTRAL_CLIENT_SECRET;
  const jwt = creds.RINGCENTRAL_JWT;

  if (!clientId || !clientSecret || !jwt) {
    throw new Error(
      "Faltan credenciales de RingCentral en Integrations (Client ID, Client Secret o JWT).",
    );
  }

  const basicAuth = btoa(`${clientId}:${clientSecret}`);

  const res = await fetch(`${serverUrl}/restapi/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`RingCentral auth falló: ${JSON.stringify(data)}`);
  }

  const expiresAt = new Date(Date.now() + (Number(data.expires_in ?? 3600) - 60) * 1000).toISOString();

  // No hace falta esperar a que termine de guardarse el cache para
  // devolver el token — que se guarde en paralelo, de fondo.
  supabase
    .from("integration_settings")
    .upsert([
      { key: "RINGCENTRAL_ACCESS_TOKEN_CACHE", value: data.access_token, updated_at: new Date().toISOString() },
      { key: "RINGCENTRAL_ACCESS_TOKEN_EXPIRES_AT", value: expiresAt, updated_at: new Date().toISOString() },
    ])
    .then(() => {});

  return data.access_token as string;
}

// Envío de SMS real, reutilizable desde cualquier función (send-message,
// el webhook de TaxiCaller, etc.) — no duplica la lógica de armar el
// pedido a la API de RingCentral en cada lugar que necesita mandar un SMS.
export async function sendSms(phone: string, text: string): Promise<void> {
  const settings = await getSettings(["RINGCENTRAL_SERVER_URL", "RINGCENTRAL_EXTENSION_ID", "RINGCENTRAL_FROM_NUMBER"]);
  const rcServer = settings.RINGCENTRAL_SERVER_URL ?? "https://platform.ringcentral.com";
  const extensionId = settings.RINGCENTRAL_EXTENSION_ID || "~";
  const fromNumber = settings.RINGCENTRAL_FROM_NUMBER;

  if (!fromNumber) {
    throw new Error("Falta cargar RINGCENTRAL_FROM_NUMBER en Integrations.");
  }

  const accessToken = await getRingCentralAccessToken();

  const res = await fetch(`${rcServer}/restapi/v1.0/account/~/extension/${extensionId}/sms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      from: { phoneNumber: fromNumber },
      to: [{ phoneNumber: phone }],
      text,
    }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(`RingCentral rechazó el envío: ${JSON.stringify(errData)}`);
  }
}