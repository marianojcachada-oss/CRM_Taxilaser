# Neuralpreneur — pasos para publicarlo (Joaquín)

Todo viene apagado: modo **Apagada** y modo prueba **encendido**. Subirlo no cambia nada del sistema hasta que lo prendas.

## Orden

1. **SQL:** correr `supabase\neuralpreneur.sql` en Supabase → SQL Editor. Se puede correr más de una vez.
   - **Importante:** esta versión agrega la columna `conversations.ai_assigned` y actualiza el trigger (función "Asignar a Valeria"). Si ya habías corrido una versión anterior, volvé a correrlo; no rompe nada.
   - Si avisa que `pg_net` no se pudo habilitar: Database → Extensions → activar `pg_net` y volver a correr.
   - Después correr también `supabase\neuralpreneur_textos.sql`: carga las instrucciones de Valeria y la reserva prendida, solo en los campos vacíos.
   - Y correr `supabase\neuralpreneur_watchdog.sql` (requiere `pg_cron`): programa cada minuto la revisión de "la IA no contestó". Sin este paso, el pase automático a operador por falta de respuesta no funciona (los otros errores sí).
2. **Edge Functions:** copiar a `supabase\functions\`:
   - `ai-dispatch\` y `ai-reply\` (carpetas nuevas)
   - `_shared\neural.ts` (nuevo)
   - `_shared\businessHours.ts` (cambio de una sola palabra: `export` delante de `isWithinBusinessHours`)
3. **config.toml:** agregar los dos bloques de `config_toml_agregar.txt` (ambas funciones van con `verify_jwt = false`; la seguridad se verifica adentro). Si desplegás con la CLI: `supabase functions deploy ai-dispatch --no-verify-jwt` y lo mismo con `ai-reply`.
4. **Frontend:** copiar `AISection.tsx`, `settingsUi.tsx`, `IntegrationsSection.tsx`, `AdminPanel.tsx`, `ConversationsView.tsx` a `frontend\src`. Probar con `npm run dev` (Ctrl+Shift+R), commit y push.

## Primera prueba (sin tocar clientes)

1. AI (Valeria): cargar la URL del webhook de Neuralpreneur, **Generar** el secreto de firma y la API key, y pasárselos a ellos junto con el endpoint de respuesta (que se copia desde la misma pantalla).
2. En *Prueba*: cargar uno o dos teléfonos tuyos (modo prueba queda encendido).
3. **Probar conexión** → tiene que decir "Neuralpreneur recibió el evento de prueba".
4. Modo **Solo cuando un humano la pide**; escribirle al número de la empresa desde uno de los teléfonos de prueba; en el chat apretar **Pedir respuesta a la IA**.
5. Revisar el **Registro** de la pantalla: tiene que verse "Enviado" y, cuando ellos contesten, "Respondió".
6. Probar el caso humano: contestar vos como operador y confirmar que la IA queda en silencio.
7. Recién después, modo **Responde en todas**, y siempre con modo prueba encendido hasta confirmar.

## Esperas en minutos (opcional)

Solo si usás "Esperar antes de responder" mayor a 0: activar la extensión `pg_cron` y correr la sección 6 de `neuralpreneur.sql`.

## Marcha atrás

- Rápida: AI (Valeria) → Modo **Apagada**. El trigger sale en su primera línea y no hace nada.
- Completa: el final de `neuralpreneur.sql` tiene las líneas para quitar el trigger, las funciones y la tabla.

## Para saber

- Con Neuralpreneur prendida, el botón del chat pasa a pedirle la respuesta a Neuralpreneur. Con la IA apagada vuelve a ser el botón anterior (Claude) y la configuración de Claude queda guardada dentro de AI (Valeria) → "Motor anterior".
- **Asignar a Valeria:** en el chat, "Asignada a" → "Valeria (IA)". Requiere que el modo no sea "Apagada" y, en modo prueba, que el número del cliente esté en la lista. Pasarla a un operador o apretar "Quitar a Valeria" la libera.
- Los operadores comunes ven el control de IA en el chat solo cuando el modo no es "Apagada".
