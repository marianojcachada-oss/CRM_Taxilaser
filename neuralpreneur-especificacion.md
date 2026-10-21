# Integración Qué tal? ↔ Neuralpreneur — especificación

Taxi Laser Service · Qué tal? (CRM de mensajería: WhatsApp, SMS, Facebook, Instagram)
Versión 1 · 20/10/2026

Este documento responde, punto por punto, la lista "Lo que necesitamos de ustedes". Todo lo que figura como *configurable* se maneja desde la sección **AI (Valeria)** del panel de administración de Qué tal?.


---

## 0. Cómo funciona (resumen)

```
Cliente escribe ──► Qué tal? ──(1) webhook firmado──► Neuralpreneur
                                                         │ decide y arma la respuesta
Cliente recibe ◄── Qué tal? ◄──(2) POST /ai-reply ───────┘
                       │
                       └─ un operador humano puede entrar en cualquier momento:
                          la IA se calla (409) y no puede volver a escribir hasta que se la reactive.
```

Modos (se elige en el panel):

| Modo | Qué hace |
|---|---|
| Apagada | No se manda nada a Neuralpreneur. |
| Solo cuando un humano la pide | El webhook sale únicamente cuando un operador aprieta "Pedir respuesta a la IA" en una conversación. |
| Responde en todas las conversaciones | El webhook sale con cada mensaje entrante que cumpla las reglas (horario, espera, canal, humano ausente). |

---

## 1. Webhook de entrada (Qué tal? → Neuralpreneur)

- **Método:** `POST`, `Content-Type: application/json`, HTTPS.
- **URL:** la que ustedes nos den (se carga en el panel).
- **Tiempo real:** sale apenas se guarda el mensaje del cliente (no hay lotes). Si se configura una espera (ver punto 7), sale cuando se cumple.
- **Timeout y reintentos:** esperamos respuesta `2xx` en **8 segundos**. Ante un error de red o `5xx` reintentamos **una vez** (a los 0,5 s). Ante un `4xx` no reintentamos. Respondan `2xx` enseguida y procesen aparte.
- **Un mismo mensaje se manda una sola vez** (salvo que un operador lo vuelva a pedir a mano). Cada envío tiene su `event_id`; si igual lo reciben repetido, deduplicar por ese id.

### Encabezados

| Encabezado | Contenido |
|---|---|
| `X-QueTal-Event` | `message.inbound` o `ping` |
| `X-QueTal-Event-Id` | id único del evento |
| `X-QueTal-Signature` | `t=<unix>,v1=<hmac>` (ver punto 3) |
| `User-Agent` | `QueTal-Webhook/1.0` |

### Payload (`message.inbound`)

```json
{
  "event": "message.inbound",
  "event_id": "5d0c6f0e-6d0e-4d57-8a0c-7a4a0f2b9c11",
  "sent_at": "2026-10-20T14:03:11.482Z",
  "trigger": "inbound",
  "test_mode": true,
  "conversation": {
    "id": "3f2a91bc-....",
    "status": "esperando_operador",
    "created_at": "2026-10-20T14:03:10.100Z",
    "channels_available": ["whatsapp"],
    "assigned_to_ai": false
  },
  "contact": {
    "id": "b1c2....",
    "phone": "+14045550123",
    "name": "Carlos",
    "has_active_ride": true,
    "active_ride": { "unit": "132", "color": "amarillo", "plate": "ABC1234", "eta_minutes": 6, "status": "en camino" }
  },
  "message": {
    "id": "9e11....",
    "text": "¿Cuánto falta para que llegue el taxi?",
    "channel": "whatsapp",
    "direction": "inbound",
    "timestamp": "2026-10-20T14:03:10.100Z",
    "has_attachment": false,
    "attachment_kind": null
  },
  "human": {
    "assigned": true,
    "assigned_operator": { "id": "a7f0....", "name": "María" },
    "has_replied": false,
    "last_human_reply_at": null,
    "ai_paused": false,
    "ai_must_stay_silent": false
  },
  "history": [
    { "id": "…", "role": "customer", "text": "Hola", "channel": "whatsapp", "timestamp": "…" },
    { "id": "…", "role": "ai", "text": "¡Hola! ¿En qué te ayudo?", "channel": "whatsapp", "timestamp": "…" }
  ],
  "policy": {
    "language": "auto",
    "languages": ["es", "en"],
    "capabilities": { "quote_ride": false, "book_ride": true, "trip_status": true, "faq": true },
    "instructions": "…texto configurable…",
    "forbidden": "…texto configurable…",
    "schedule": "always"
  },
  "reply": {
    "url": "https://<proyecto>.supabase.co/functions/v1/ai-reply",
    "auth": "Authorization: Bearer <API key que te dimos>",
    "rate_limit_per_minute": 120
  }
}
```

Notas:

- `message.channel`: `whatsapp`, `sms`, `facebook` o `instagram`. El chat propio de la app no existe hoy como canal.
- `message.direction` es siempre `inbound` en este evento; los mensajes salientes aparecen en `history` con `role` = `agent` (humano), `ai` o `system` (avisos automáticos).
- `trigger`: `inbound` (mensaje nuevo), `sweep` (se cumplió la espera configurada), `operator_request` (un operador pidió la respuesta) o `assigned_to_ai` (un operador asignó la conversación a Valeria desde su bandeja; el mensaje es el último del cliente que estaba sin responder).
- `conversation.assigned_to_ai`: `true` si la conversación fue asignada a Valeria. En ese caso la IA debe atenderla aunque el modo general sea "solo cuando un humano lo pide", sin respetar horario ni espera, hasta que un operador la retome.
- El mensaje de texto puede venir vacío si el cliente mandó solo un adjunto (`has_attachment: true`).
- `history` trae hasta los últimos 10 mensajes con texto.
- Evento `ping` (prueba de conexión desde el panel): trae solo `event`, `event_id`, `sent_at`, `trigger: "test"`, `test_mode` y `message`. No tiene conversación.

---

## 2. Endpoint de salida (Neuralpreneur → Qué tal?)

**`POST https://<proyecto>.supabase.co/functions/v1/ai-reply`** (la URL exacta se copia del panel)

Encabezados: `Authorization: Bearer <API key>` (o `X-API-Key: <API key>`) y `Content-Type: application/json`.

### Responder

```json
{
  "conversation_id": "3f2a91bc-....",
  "text": "Tu taxi llega en unos 6 minutos (unidad 132, amarillo).",
  "idempotency_key": "resp-9e11-1",
  "in_reply_to": "9e11...."
}
```

| Campo | Obligatorio | Descripción |
|---|---|---|
| `conversation_id` | sí* | Id de la conversación del evento. |
| `phone` | sí* | Alternativa a `conversation_id`: teléfono del cliente (se toma su conversación más reciente). |
| `text` | sí | Texto a enviar (hasta 4000 caracteres). |
| `idempotency_key` | recomendado | Hace seguros los reintentos: la misma clave no manda dos veces. |
| `in_reply_to` | opcional | `message.id` al que responde; define el canal. Si falta, se usa el canal del último mensaje del cliente. |

\* uno de los dos.

El mensaje sale por el **mismo canal** por el que escribió el cliente (WhatsApp, SMS, Facebook o Instagram) y queda guardado en el historial como mensaje de IA, visible para los operadores.

### Escalar a un humano

```json
{ "action": "escalate", "conversation_id": "3f2a91bc-....", "reason": "el cliente pidió hablar con una persona" }
```

Pausa la IA en esa conversación, la marca como "esperando operador" y la deja sin leer para que un humano la tome.

### Respuestas

Éxito (`200`):

```json
{ "ok": true, "status": "sent", "message_id": "…", "channel": "whatsapp", "conversation_id": "…" }
{ "ok": true, "status": "escalated", "conversation_id": "…" }
{ "ok": true, "status": "duplicate" }
```

Error (`4xx`/`5xx`):

```json
{ "ok": false, "error": { "code": "human_active", "message": "Un operador ya respondió en esta conversación: la IA no puede responder." } }
```

| HTTP | `code` | Significa | Qué hacer |
|---|---|---|---|
| 400 | `bad_request` | Falta un campo o el JSON es inválido | Corregir el pedido |
| 401 | `unauthorized` | API key inválida o ausente | Revisar la clave |
| 403 | `contact_blocked` | Cliente bloqueado o dado de baja (STOP) | No reintentar |
| 403 | `test_mode_blocked` | Modo prueba: número fuera de la lista | No reintentar |
| 404 | `conversation_not_found` | No existe esa conversación | Revisar el id |
| 409 | `human_active` | Un operador ya respondió | **Callarse.** No reintentar |
| 409 | `ai_paused` | Conversación pausada o escalada | **Callarse.** No reintentar |
| 409 | `max_auto_replies` | Tope de respuestas seguidas de la IA sin mensaje nuevo del cliente | Escalar a un humano |
| 409 | `mode_off` | La IA está apagada en Qué tal? | No reintentar |
| 422 | `channel_disabled` | Canal no habilitado para la IA | No reintentar |
| 429 | `rate_limited` | Superó el límite por minuto (`Retry-After` en segundos) | Esperar y reintentar |
| 502 | `send_failed` | El canal (WhatsApp/SMS/…) rechazó el envío | Se puede reintentar con la misma `idempotency_key` |

### Límite de pedidos

**120 pedidos por minuto** por defecto (configurable en el panel). Al superarlo respondemos `429` con `Retry-After`.

### Detalles del canal que conviene conocer

- **WhatsApp:** solo se puede responder texto libre dentro de las 24 h posteriores al último mensaje del cliente. Fuera de esa ventana el envío falla (`send_failed`). Hoy no se mandan plantillas desde la IA.
- **SMS:** 10DLC / carrier de EE. UU.; mensajes largos se parten en varios SMS.

---

## 3. Autenticación

| Dirección | Mecanismo |
|---|---|
| Neuralpreneur → Qué tal? | **API key** en `Authorization: Bearer …`. La genera Taxi Laser una sola vez desde el panel (botón *Generar*) y se la pasa a ustedes por un canal seguro. |
| Qué tal? → Neuralpreneur | **Webhook firmado** con HMAC-SHA256 y un secreto compartido (botón *Generar* en el panel). |

**Vigencia:** la API key y el secreto de firma son **permanentes**: no vencen ni se rotan de forma periódica. Solo se reemplazan si Taxi Laser sospecha que se filtraron, y en ese caso se avisa a Neuralpreneur antes del cambio.

### Firma del webhook

Encabezado: `X-QueTal-Signature: t=<unix_segundos>,v1=<hex>`
`v1 = HMAC-SHA256(secreto, "<t>.<cuerpo_crudo>")` en hexadecimal. El cuerpo es el texto JSON **tal cual llegó**, sin reformatear.

Verificación de ejemplo (Node.js):

```js
import crypto from 'node:crypto'

function verificar(header, cuerpoCrudo, secreto, toleranciaSeg = 300) {
  const p = Object.fromEntries(header.split(',').map((x) => x.split('=')))
  if (Math.abs(Date.now() / 1000 - Number(p.t)) > toleranciaSeg) return false   // vencida
  const esperado = crypto.createHmac('sha256', secreto).update(`${p.t}.${cuerpoCrudo}`).digest('hex')
  const a = Buffer.from(esperado), b = Buffer.from(p.v1 ?? '')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
```

Recomendamos rechazar firmas con más de 5 minutos de antigüedad.

---

## 4. Ambiente de prueba

No hay un sandbox separado: Qué tal? es una sola instalación. En su lugar existe el **modo prueba**, que viene **encendido por defecto**:

- Con el modo prueba encendido, solo las conversaciones de los **números de la lista de prueba** (se carga en el panel) se mandan a Neuralpreneur, y `ai-reply` rechaza (`test_mode_blocked`) cualquier otro número.
- Los mensajes a esos números **salen de verdad** por WhatsApp/SMS, pero a teléfonos de Taxi Laser, no a clientes.
- Cada evento trae `"test_mode": true|false`.
- El botón **Probar conexión** del panel manda un evento `ping` a su URL sin tocar ninguna conversación.
- El panel tiene un **Registro** con los últimos movimientos (enviado, respondió, rechazado y motivo).

Para probar sin molestar a nadie, Taxi Laser carga uno o dos teléfonos propios y se escribe desde ahí.

---

## 5. Control humano vs. bot

**Cómo se entera la IA de que entró un humano**

Cada evento trae el bloque `human`:

- `has_replied`: **un operador ya escribió** en la conversación. Es la señal que importa.
- `ai_paused`: la conversación fue pausada o escalada.
- `ai_must_stay_silent`: `true` si cualquiera de las dos anteriores es cierta → **no contestar**.
- `assigned` / `assigned_operator`: es solo el reparto automático (cada conversación se asigna a un operador apenas entra). **No significa que el humano esté atendiendo**; por eso no hay que usarlo para decidir.

**Cómo marca la IA que quiere escalar**

`POST /ai-reply` con `{"action":"escalate", ...}` (punto 2).

**Quién manda si escriben a la vez**

**El humano, siempre.** Qué tal? lo hace cumplir del lado nuestro: antes de enviar cada respuesta de la IA vuelve a verificar. Si un operador respondió (o la conversación se pausó) entre el webhook y la respuesta, `ai-reply` devuelve `409 human_active` / `ai_paused` y **no se envía nada**.

- Después de que un operador responde, la IA queda en silencio en esa conversación hasta que un operador aprieta **"Devolver a la IA"** o le **pide una respuesta** (eso también la reactiva).
- Un operador puede **pausar** la IA o **pedirle** una respuesta puntual desde el chat.
- **Asignar a Valeria:** un operador puede elegir "Valeria (IA)" en el menú "Asignada a" del chat. Desde ese momento la IA responde cada mensaje nuevo del cliente (y el que ya estaba pendiente) sin importar el horario ni la espera configurada, hasta que un operador la retome. Si el operador **le pasa la conversación a una persona** ("Asignada a" otro operador) o aprieta **"Quitar a Valeria"**, la IA deja de atenderla. Si un operador escribe en la conversación, la IA vuelve a quedar en silencio (el humano siempre manda).
- **Si la IA no contesta (red de seguridad de Qué tal?):** cada evento que Neuralpreneur recibe tiene que terminar en una llamada a `ai-reply`, con `reply` o con `escalate`. Si pasan **60 segundos** (configurable) sin ninguna de las dos y sin que un operador haya escrito, Qué tal? devuelve la conversación a la cola de operadores y deja un aviso rojo con el motivo en el chat. Lo mismo ocurre si el evento no pudo entregarse (Neuralpreneur respondió error o no respondió) o si el envío de una respuesta falla. Después de eso la IA queda en silencio en esa conversación hasta que un operador la devuelve a la IA. Si Neuralpreneur decide no responder un mensaje, debe llamar a `escalate` para no activar este aviso.
- **Tope anti-bucle:** la IA no puede mandar más de N respuestas seguidas (5 por defecto) sin que el cliente escriba de nuevo. Cada mensaje nuevo del cliente reinicia la cuenta, y también la reinicia un humano que responde. Se puede ajustar en el panel (0 = sin límite). Al llegar al tope hay que escalar.

---

## 6. Documentación y contacto

- Documentación: este documento. Cualquier cambio del contrato se avisa por adelantado.
- Contacto en Taxi Laser si algo se rompe: **Mariano Joaquín Cachada** · 05_mariano@taxilaserllc.com · +54 9 11 4199-7551
- Lo que Taxi Laser necesita de Neuralpreneur: la documentación de su API (aunque esté a medias), un contacto técnico y su tiempo de respuesta ante un problema.

---

## 7. Qué resuelve la IA sola y qué no

Se controla desde **AI (Valeria) → Qué puede y qué no puede hacer**, y viaja en cada evento dentro de `policy`:

| Tarea | `capabilities` | Valor inicial |
|---|---|---|
| Tomar una reserva (juntar los datos del viaje; **la confirma siempre un operador**) | `book_ride` | Sí |
| Dar el estado de un viaje (con los datos reales de `active_ride`) | `trip_status` | Sí |
| Contestar preguntas frecuentes | `faq` | Sí |
| Cotizar una carrera | `quote_ride` | **No** (Taxi Laser la prende desde el panel cuando quiera; llega como `true` en cada evento) |

Más dos textos editables por Taxi Laser: `policy.instructions` (tono, zona de cobertura y flujo de cada caso) y `policy.forbidden` (lo que **nunca** debe hacer). Neuralpreneur debe seguir ambos.

**La IA nunca debe:**

- Prometer ni confirmar en firme un precio, una unidad, una patente o una hora exacta de llegada. Cualquier cifra o dato que no venga en el evento (`active_ride`) no se inventa.
- Cancelar un viaje ni decir que quedó cancelado. Ante un pedido de cancelación, agradece, anota el motivo y **deriva a un operador**, que es quien cancela.
- Brindar datos de clientes (de otros clientes ni de conductores).
- Presentarse como una inteligencia artificial ni decir que es un bot. Escribe como un operador de Taxi Laser. Si el cliente pregunta de buena fe si habla con una persona, no lo niega: deriva a un operador.
- Seguir contestando si `ai_must_stay_silent` es `true`.

**Qué deriva siempre a un operador** (`action: "escalate"`): cancelaciones, objetos perdidos, delivery o encomiendas, pedido explícito de hablar con una persona, pedidos que no encajan o con dudas, direcciones fuera de la zona de cobertura y, mientras `quote_ride` sea `false`, las cotizaciones.

**Flujo de una reserva o un taxi:** la IA pide la dirección de recogida y, si la hay, la de destino (preguntando la ciudad si el lugar puede estar en más de una); después pregunta si es para ahora o para programar. Si es programado, resuelve la próxima ocurrencia lógica de la hora con la hora actual de Atlanta, la repite con AM/PM y pide una confirmación breve. En ambos casos dice que un operador confirma la unidad, el tiempo y la reserva. **No** pregunta por defecto cantidad de pasajeros ni pedidos especiales.

**Zona de cobertura:** Norcross, Peachtree Corners, Duluth, Lawrenceville, Suwanee, Tucker y Chamblee (Georgia) y alrededores. Una ciudad fuera de esa zona se deriva a un operador para confirmar.

Cuando la IA no esté segura o el pedido no encaje: **escalar a un humano** en lugar de improvisar.

Qué tal? hoy **no tiene** operaciones para crear, cancelar ni cotizar viajes de forma automática desde la IA: la IA conversa y junta los datos, y todo lo que compromete a la empresa lo cierra un operador.

---

## 8. Idioma

Español e inglés. Por defecto `policy.language = "auto"`: **la IA debe responder en el idioma en que escribió el cliente** y cambiar sola si el cliente cambia. Taxi Laser puede forzar "siempre español" o "siempre inglés" desde el panel (`"es"` / `"en"`).

---

## 9. Horario

Configurable: `policy.schedule`

- `"always"`: la IA contesta las 24 horas.
- `"outside_hours"`: solo fuera del horario de atención de Taxi Laser (zona horaria America/New_York por defecto, el rango se define en el panel).

Además se puede definir una **espera**: la IA solo contesta si pasaron N minutos desde el mensaje del cliente sin que un operador responda (0 = enseguida). Si un operador responde durante la espera, la IA no contesta.

Otros filtros del panel: canales donde puede responder (WhatsApp, SMS, Facebook, Instagram) y el tope de respuestas seguidas (se reinicia con cada mensaje del cliente).

---

## Ejemplos rápidos

Responder:

```bash
curl -X POST "https://<proyecto>.supabase.co/functions/v1/ai-reply" \
  -H "Authorization: Bearer $QUETAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"conversation_id":"3f2a91bc-....","text":"Tu taxi llega en unos 6 minutos.","idempotency_key":"resp-9e11-1"}'
```

Escalar:

```bash
curl -X POST "https://<proyecto>.supabase.co/functions/v1/ai-reply" \
  -H "Authorization: Bearer $QUETAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"escalate","conversation_id":"3f2a91bc-....","reason":"pidió hablar con una persona"}'
```
