import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Circle, Loader2, RefreshCw } from 'lucide-react'
import { supabase } from './supabaseClient'
import {
  CopyButton,
  Fields,
  Group,
  INPUT_CLASS,
  SaveButton,
  Segmented,
  TextAreaField,
  Toggle,
  type Field,
  type ToggleDef,
  useIntegrationSettings,
} from './settingsUi'

// Pantalla de la IA (Valeria). Todo se guarda en integration_settings; lo leen
// las Edge Functions ai-dispatch (salida hacia Neuralpreneur) y ai-reply
// (entrada desde Neuralpreneur). Ver neuralpreneur.sql y la especificación.

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL ?? ''}/functions/v1`

const MODE_OPTIONS = [
  { value: 'off', label: 'Apagada' },
  { value: 'on_demand', label: 'Solo cuando un humano la pide' },
  { value: 'all', label: 'Responde en todas las conversaciones' },
]

const SCHEDULE_OPTIONS = [
  { value: 'always', label: 'Las 24 horas' },
  { value: 'outside_hours', label: 'Solo fuera del horario de atención' },
]

const LANGUAGE_OPTIONS = [
  { value: 'auto', label: 'Automático (el del cliente)' },
  { value: 'es', label: 'Siempre español' },
  { value: 'en', label: 'Siempre inglés' },
]

const CHANNELS = [
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'sms', label: 'SMS' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'instagram', label: 'Instagram' },
]

const CAPABILITIES: ToggleDef[] = [
  { key: 'NEURAL_CAN_QUOTE', label: 'Puede cotizar una carrera' },
  { key: 'NEURAL_CAN_BOOK', label: 'Puede tomar una reserva', defaultOn: true },
  { key: 'NEURAL_CAN_TRIP_STATUS', label: 'Puede dar el estado de un viaje', defaultOn: true },
  { key: 'NEURAL_CAN_FAQ', label: 'Puede contestar preguntas frecuentes', defaultOn: true },
]

const RULE_FIELDS: Field[] = [
  { key: 'NEURAL_DELAY_MINUTES', label: 'Esperar antes de responder (minutos sin respuesta humana)', placeholder: '0 = enseguida' },
  { key: 'NEURAL_MAX_AUTO_REPLIES', label: 'Máximo de respuestas seguidas de la IA', placeholder: '5' },
]

const LIMIT_FIELD: Field[] = [{ key: 'NEURAL_RATE_LIMIT_PER_MIN', label: 'Pedidos por minuto que puede hacer la IA', placeholder: '30' }]

// Configuración del motor anterior (Claude). Solo se usa si Neuralpreneur está apagada
// (botón "Responder con IA" del superadmin). Las claves siguen siendo las mismas.
const CLAUDE_FIELDS: Field[] = [
  { key: 'CLAUDE_API_KEY', label: 'API Key de Claude', secret: true },
  { key: 'CLAUDE_MODEL', label: 'Modelo', placeholder: 'claude-haiku-4-5' },
]

function randomKey(prefix: string, bytes = 24): string {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  return prefix + [...a].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const features = [
  {
    name: 'Clasificación automática de estado',
    status: 'live' as const,
    detail:
      'Corre en la base cada vez que se guarda un mensaje (trigger sobre "messages"), por palabras clave: no usa IA. Si responde un operador, la conversación pasa a "Esperando cliente". Si escribe el cliente, se marca como Cancelación, Reclamo, Cerrada (gracias / listo / dale, sin pregunta), Esperando información (consulta de precio, tarifa o demora) o, si nada coincide, Esperando operador. Los avisos automáticos de TaxiCaller no se reclasifican.',
  },
  {
    name: 'Traducción de mensajes',
    status: 'live' as const,
    detail: 'Conectada a Google Cloud Translation vía Edge Function.',
  },
  {
    name: 'Resumen de intención del cliente',
    status: 'partial' as const,
    detail:
      'Hoy funciona con reglas simples por palabra clave en el panel de contacto. Pasar a un resumen real con Claude (Haiku, más barato) es el siguiente paso natural.',
  },
  {
    name: 'Sugerencia de respuesta al operador',
    status: 'pending' as const,
    detail: 'No construida todavía. Necesita una Edge Function que le pase el hilo a Claude y proponga una respuesta.',
  },
  {
    name: 'Copiloto conversacional (chat con la IA sobre el caso)',
    status: 'pending' as const,
    detail: 'No construido. Es la pieza más grande de esta sección.',
  },
]

const statusLabel = {
  live: { label: 'En funcionamiento', icon: <CheckCircle2 size={14} className="text-available" />, color: 'text-available' },
  partial: { label: 'Parcial (mock)', icon: <Circle size={14} className="text-warning" />, color: 'text-warning' },
  pending: { label: 'Pendiente', icon: <Circle size={14} className="text-muted" />, color: 'text-muted' },
}


type LogRow = {
  id: string
  created_at: string
  direction: 'out' | 'in'
  conversation_id: string | null
  status: string
  reason: string | null
  http_status: number | null
}

const LOG_STATUS: Record<string, { label: string; color: string }> = {
  sent: { label: 'Enviado', color: 'text-available' },
  replied: { label: 'Respondió', color: 'text-available' },
  escalated: { label: 'Escaló a humano', color: 'text-warning' },
  pending: { label: 'En curso', color: 'text-muted' },
  skipped: { label: 'No se mandó', color: 'text-muted' },
  rejected: { label: 'Rechazado', color: 'text-warning' },
  failed: { label: 'Falló', color: 'text-alert' },
}

function DispatchLog() {
  const [rows, setRows] = useState<LogRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('ai_dispatch_log')
      .select('id, created_at, direction, conversation_id, status, reason, http_status')
      .order('created_at', { ascending: false })
      .limit(15)
    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    setError(null)
    setRows((data as LogRow[]) ?? [])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs text-muted">Últimos movimientos</p>
        <button
          type="button"
          onClick={load}
          aria-label="Actualizar registro"
          title="Actualizar"
          className="flex h-[26px] w-[26px] items-center justify-center rounded-sm border border-panel-light text-muted transition-colors hover:border-mustard hover:text-mustard"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        </button>
      </div>
      {error ? (
        <p className="text-xs text-alert">
          No se pudo leer el registro ({error}). Si es la primera vez, falta correr neuralpreneur.sql.
        </p>
      ) : rows && rows.length === 0 ? (
        <p className="text-xs text-muted">Todavía no hay movimientos.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-muted">
                <th className="py-1 pr-3 font-medium">Hora</th>
                <th className="py-1 pr-3 font-medium">Sentido</th>
                <th className="py-1 pr-3 font-medium">Conversación</th>
                <th className="py-1 pr-3 font-medium">Estado</th>
                <th className="py-1 font-medium">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((r) => {
                const st = LOG_STATUS[r.status] ?? { label: r.status, color: 'text-muted' }
                return (
                  <tr key={r.id} className="border-t border-panel-light">
                    <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums">
                      {new Date(r.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td className="whitespace-nowrap py-1.5 pr-3">{r.direction === 'out' ? 'Qué tal? → IA' : 'IA → Qué tal?'}</td>
                    <td className="py-1.5 pr-3 font-mono">{r.conversation_id ? r.conversation_id.slice(0, 8) : '—'}</td>
                    <td className={`whitespace-nowrap py-1.5 pr-3 ${st.color}`}>{st.label}</td>
                    <td className="py-1.5 text-muted">{[r.reason, r.http_status ? `HTTP ${r.http_status}` : null].filter(Boolean).join(' · ') || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function AISection({ readOnly = false }: { readOnly?: boolean }) {
  const { values, setValues, loading, error, savingKey, savedKey, saveValue, isOn, flip, setAndSave } =
    useIntegrationSettings(readOnly)
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  const [revealKey, setRevealKey] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)

  if (loading) return <p className="text-sm text-muted">Cargando...</p>
  if (error) return <p className="text-sm text-alert">Error: {error}</p>

  const mode = values['NEURAL_MODE'] || 'off'
  const testMode = values['NEURAL_TEST_MODE'] !== 'false'
  const schedule = values['NEURAL_SCHEDULE'] || 'always'
  const language = values['NEURAL_LANGUAGE'] || 'auto'
  const channels = (values['NEURAL_CHANNELS'] ?? 'whatsapp,sms').split(',').map((c) => c.trim()).filter(Boolean)
  const fieldProps = { values, setValues, savingKey, savedKey, saveValue }
  const replyUrl = `${FUNCTIONS_URL}/ai-reply`

  const checklist = [
    { ok: !!values['NEURAL_WEBHOOK_URL'], label: 'URL del webhook' },
    { ok: !!values['NEURAL_WEBHOOK_SECRET'], label: 'Secreto de firma' },
    { ok: !!values['NEURAL_API_KEY'], label: 'API key para la IA' },
    { ok: !testMode || !!values['NEURAL_TEST_NUMBERS']?.trim(), label: testMode ? 'Números de prueba' : 'Modo prueba apagado' },
  ]

  async function generate(key: string, prefix: string) {
    if (values[key] && confirmKey !== key) {
      setConfirmKey(key)
      return
    }
    setConfirmKey(null)
    setRevealKey(key)
    await setAndSave(key, randomKey(prefix))
  }

  async function testConnection() {
    setTesting(true)
    setTestResult(null)
    const { data, error } = await supabase.functions.invoke('ai-dispatch', { body: { test: true } })
    setTesting(false)
    if (error || !data?.ok) {
      setTestResult({ ok: false, text: data?.error ?? error?.message ?? `Falló (HTTP ${data?.httpStatus ?? '?'})` })
    } else {
      setTestResult({ ok: true, text: `Neuralpreneur recibió el evento de prueba (HTTP ${data.httpStatus}).` })
    }
  }

  function secretField(key: string, label: string, prefix: string) {
    const revealed = revealKey === key
    return (
      <div>
        <label htmlFor={key} className="mb-1 block text-xs text-muted">
          {label}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id={key}
            type={revealed ? 'text' : 'password'}
            autoComplete="off"
            value={values[key] ?? ''}
            onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
            className={`${INPUT_CLASS} min-w-0 flex-1`}
          />
          <SaveButton label={label} saving={savingKey === key} saved={savedKey === key} onClick={() => saveValue(key)} />
          <button
            type="button"
            onClick={() => setRevealKey(revealed ? null : key)}
            className="flex h-[30px] shrink-0 items-center rounded-sm border border-panel-light px-2 text-[11px] text-muted transition-colors hover:border-mustard hover:text-mustard"
          >
            {revealed ? 'Ocultar' : 'Mostrar'}
          </button>
          <CopyButton text={values[key] ?? ''} label={label} />
          {!values[key] && (
          <button
            type="button"
            onClick={() => generate(key, prefix)}
            className={`flex h-[30px] shrink-0 items-center rounded-sm border px-2 text-[11px] transition-colors ${
              confirmKey === key
                ? 'border-alert/60 bg-alert/10 text-alert'
                : 'border-panel-light text-muted hover:border-mustard hover:text-mustard'
            }`}
          >
            Generar
          </button>
          )}
        </div>
      </div>
    )
  }

  function toggleChannel(id: string) {
    const next = channels.includes(id) ? channels.filter((c) => c !== id) : [...channels, id]
    setAndSave('NEURAL_CHANNELS', next.join(','))
  }

  return (
    <div className="flex flex-col gap-4">
      <fieldset disabled={readOnly} className={`flex min-w-0 flex-col gap-4 ${readOnly ? 'opacity-60' : ''}`}>
        <Group title="Valeria — Neuralpreneur">
          <Segmented
            label="Modo"
            options={MODE_OPTIONS}
            value={mode}
            onChange={(v) => setAndSave('NEURAL_MODE', v)}
            tone={(v) => (v === 'off' ? 'alert' : 'neutral')}
          />
          <div className="flex flex-wrap gap-2">
            {checklist.map((c) => (
              <span
                key={c.label}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${
                  c.ok ? 'border-available/40 text-available' : 'border-panel-light text-muted'
                }`}
              >
                {c.ok ? <CheckCircle2 size={12} /> : <Circle size={12} />} {c.label}
              </span>
            ))}
          </div>
          {mode !== 'off' && !testMode && (
            <p className="rounded-sm border border-alert/30 bg-alert/10 px-3 py-2 text-xs text-alert">
              Modo prueba apagado: la IA puede contestarle a clientes reales.
            </p>
          )}
        </Group>

        <Group title="Conexión">
          <Fields fields={[{ key: 'NEURAL_WEBHOOK_URL', label: 'URL del webhook de Neuralpreneur (HTTPS)', wide: true }]} {...fieldProps} />
          {secretField('NEURAL_WEBHOOK_SECRET', 'Secreto de firma del webhook (se lo pasás a Neuralpreneur)', 'whsec_')}
          {secretField('NEURAL_API_KEY', 'API key que usa Neuralpreneur para responder', 'nq_live_')}
          <div>
            <label htmlFor="neural-reply-url" className="mb-1 block text-xs text-muted">
              Endpoint donde Neuralpreneur manda la respuesta (se lo pasás a ellos)
            </label>
            <div className="flex items-center gap-2">
              <input id="neural-reply-url" readOnly value={replyUrl} className={INPUT_CLASS} />
              <CopyButton text={replyUrl} label="endpoint de respuesta" />
            </div>
          </div>
          <Fields fields={LIMIT_FIELD} {...fieldProps} />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={testConnection}
              disabled={testing || !values['NEURAL_WEBHOOK_URL']}
              className="flex items-center gap-2 rounded-sm border border-panel-light px-3 py-2 text-xs text-cream transition-colors hover:border-mustard disabled:opacity-50"
            >
              {testing && <Loader2 size={12} className="animate-spin" />} Probar conexión
            </button>
            {testResult && <span className={`text-xs ${testResult.ok ? 'text-available' : 'text-alert'}`}>{testResult.text}</span>}
          </div>
        </Group>

        <Group title="Cuándo responde">
          <Segmented label="Horario" options={SCHEDULE_OPTIONS} value={schedule} onChange={(v) => setAndSave('NEURAL_SCHEDULE', v)} />
          <Fields fields={RULE_FIELDS} {...fieldProps} />
          <p className="text-[11px] text-muted">
            Con una espera mayor a 0 hace falta el programador de cada minuto (sección 6 de neuralpreneur.sql). Si un
            operador responde durante la espera, la IA no contesta. "Solo fuera del horario" usa el horario de
            Integrations.
          </p>
          <div>
            <p className="mb-1 text-xs text-muted">Canales donde puede responder</p>
            <div className="flex flex-wrap gap-2">
              {CHANNELS.map((c) => (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-center gap-2 rounded-sm border border-panel-light px-3 py-2 text-xs text-cream"
                >
                  <input type="checkbox" checked={channels.includes(c.id)} onChange={() => toggleChannel(c.id)} />
                  {c.label}
                </label>
              ))}
            </div>
          </div>
          <Segmented label="Idioma" options={LANGUAGE_OPTIONS} value={language} onChange={(v) => setAndSave('NEURAL_LANGUAGE', v)} />
        </Group>

        <Group title="Qué puede y qué no puede hacer">
          <div className="flex flex-col gap-2">
            {CAPABILITIES.map((t) => (
              <Toggle key={t.key} label={t.label} on={isOn(t)} onClick={() => flip(t)} />
            ))}
          </div>
          <TextAreaField
            id="NEURAL_INSTRUCTIONS"
            label="Instrucciones para la IA (tono, datos de la empresa)"
            value={values['NEURAL_INSTRUCTIONS'] ?? ''}
            onChange={(v) => setValues((prev) => ({ ...prev, NEURAL_INSTRUCTIONS: v }))}
            onSave={() => saveValue('NEURAL_INSTRUCTIONS')}
            saving={savingKey === 'NEURAL_INSTRUCTIONS'}
            saved={savedKey === 'NEURAL_INSTRUCTIONS'}
          />
          <TextAreaField
            id="NEURAL_FORBIDDEN"
            label="Lo que la IA NUNCA debe hacer"
            value={values['NEURAL_FORBIDDEN'] ?? ''}
            onChange={(v) => setValues((prev) => ({ ...prev, NEURAL_FORBIDDEN: v }))}
            onSave={() => saveValue('NEURAL_FORBIDDEN')}
            saving={savingKey === 'NEURAL_FORBIDDEN'}
            saved={savedKey === 'NEURAL_FORBIDDEN'}
            placeholder="Ej: cancelar un viaje, inventar una tarifa, dar datos de otro cliente"
          />
        </Group>

        <Group title="Prueba">
          <Toggle
            label="Modo prueba: solo los números de la lista"
            on={testMode}
            onClick={() => setAndSave('NEURAL_TEST_MODE', testMode ? 'false' : 'true')}
          />
          <TextAreaField
            id="NEURAL_TEST_NUMBERS"
            label="Números de prueba (uno por línea o separados por coma)"
            rows={3}
            value={values['NEURAL_TEST_NUMBERS'] ?? ''}
            onChange={(v) => setValues((prev) => ({ ...prev, NEURAL_TEST_NUMBERS: v }))}
            onSave={() => saveValue('NEURAL_TEST_NUMBERS')}
            saving={savingKey === 'NEURAL_TEST_NUMBERS'}
            saved={savedKey === 'NEURAL_TEST_NUMBERS'}
            placeholder="+14045550123"
          />
        </Group>

        <Group title="Registro">
          <DispatchLog />
        </Group>

        <details className="rounded-sm border border-panel-light bg-panel p-4">
          <summary className="cursor-pointer text-xs font-semibold text-muted">Motor anterior (Claude) — solo con Neuralpreneur apagada</summary>
          <div className="mt-3 flex flex-col gap-3">
            <Toggle label="IA activada" on={isOn({ key: 'AI_ENABLED', label: '' })} onClick={() => flip({ key: 'AI_ENABLED', label: '' })} />
            <Fields fields={CLAUDE_FIELDS} {...fieldProps} />
            <TextAreaField
              id="AI_SYSTEM_PROMPT"
              label="Reglas de la IA (qué sí y qué no puede hacer)"
              rows={8}
              value={values['AI_SYSTEM_PROMPT'] ?? ''}
              onChange={(v) => setValues((prev) => ({ ...prev, AI_SYSTEM_PROMPT: v }))}
              onSave={() => saveValue('AI_SYSTEM_PROMPT')}
              saving={savingKey === 'AI_SYSTEM_PROMPT'}
              saved={savedKey === 'AI_SYSTEM_PROMPT'}
            />
          </div>
        </details>
      </fieldset>

      <div className="flex flex-col gap-3">
        {features.map((f) => (
          <div key={f.name} className="rounded-sm border border-panel-light bg-panel p-4">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium">{f.name}</span>
              <span className={`flex items-center gap-1.5 text-xs ${statusLabel[f.status].color}`}>
                {statusLabel[f.status].icon} {statusLabel[f.status].label}
              </span>
            </div>
            <p className="text-xs text-muted">{f.detail}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
