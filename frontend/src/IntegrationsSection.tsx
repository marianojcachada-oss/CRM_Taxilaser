import { useEffect, useState } from 'react'
import { Save, Check, Power } from 'lucide-react'
import { supabase } from './supabaseClient'
import { useToast } from './Toast'
import RingCentralStatusCard from './RingCentralStatusCard'
import MetaStatusCard from './MetaStatusCard'

type Setting = { key: string; value: string | null; updated_at: string }

const groups: { title: string; keys: { key: string; label: string; secret?: boolean }[] }[] = [
  {
    title: 'Meta (WhatsApp / Facebook / Instagram)',
    keys: [
      { key: 'META_VERIFY_TOKEN', label: 'Verify Token del webhook' },
      { key: 'META_APP_SECRET', label: 'App Secret (verifica que el webhook venga de Meta)', secret: true },
      { key: 'META_WABA_ID', label: 'WhatsApp Business Account ID' },
      { key: 'META_PHONE_NUMBER_ID', label: 'Phone Number ID (para enviar)' },
      { key: 'META_ACCESS_TOKEN', label: 'Access Token (System User — cubre WhatsApp, Facebook e Instagram)', secret: true },
    ],
  },
  {
    title: 'RingCentral (SMS)',
    keys: [
      { key: 'RINGCENTRAL_SERVER_URL', label: 'Server URL' },
      { key: 'RINGCENTRAL_CLIENT_ID', label: 'Client ID' },
      { key: 'RINGCENTRAL_CLIENT_SECRET', label: 'Client Secret', secret: true },
      { key: 'RINGCENTRAL_JWT', label: 'JWT Credential', secret: true },
      { key: 'RINGCENTRAL_EXTENSION_ID', label: 'Extension ID (la que recibe los SMS de clientes; "~" = tu propia extensión)' },
      { key: 'RINGCENTRAL_FROM_NUMBER', label: 'Número de teléfono para ENVIAR SMS (ej: +14045968232)' },
    ],
  },
  {
    title: 'TaxiCaller',
    keys: [
      { key: 'TAXICALLER_BASE_URL', label: 'Base URL de la API' },
      { key: 'TAXICALLER_API_KEY', label: 'API Key', secret: true },
      {
        key: 'TAXICALLER_PASSENGER_LOOKUP_PATH',
        label: 'Path para buscar pasajero por teléfono (usá {phone} donde va el número — ej: /api/v1/passengers/search?phone={phone})',
      },
      { key: 'TAXICALLER_WEBHOOK_SECRET', label: 'Secreto del webhook (elegís vos un valor, va también como header en TaxiCaller)', secret: true },
    ],
  },
  {
    title: 'Horario de atención',
    keys: [
      { key: 'BUSINESS_HOURS_START', label: 'Hora de apertura (formato 24hs, ej: 08:00)' },
      { key: 'BUSINESS_HOURS_END', label: 'Hora de cierre (formato 24hs, ej: 22:00)' },
      { key: 'BUSINESS_HOURS_TIMEZONE', label: 'Zona horaria (ej: America/New_York)' },
      { key: 'BUSINESS_HOURS_MESSAGE', label: 'Mensaje automático fuera de horario' },
    ],
  },
  {
    title: 'Llamadas perdidas — respuesta automática',
    keys: [],
  },
  {
    title: 'Traducción',
    keys: [
      {
        key: 'DEEPL_API_KEY',
        label: 'DeepL API Key (mejor calidad, pero el gratis es 1M de caracteres ÚNICA VEZ, no por mes)',
        secret: true,
      },
      { key: 'AZURE_TRANSLATOR_KEY', label: 'Azure Translator — Key (2M caracteres/mes gratis, se renueva)', secret: true },
      { key: 'AZURE_TRANSLATOR_REGION', label: 'Azure Translator — Región (ej: eastus)' },
      { key: 'LIBRETRANSLATE_URL', label: 'LibreTranslate — URL de la instancia (opcional)' },
      { key: 'LIBRETRANSLATE_API_KEY', label: 'LibreTranslate — API Key (si la instancia la pide)', secret: true },
      { key: 'MYMEMORY_EMAIL', label: 'MyMemory — tu email (gratis, sube el límite de 5k a 50k palabras/día)' },
    ],
  },
]

export default function IntegrationsSection({ readOnly = false }: { readOnly?: boolean }) {
  const toast = useToast()
  const [values, setValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [savedKey, setSavedKey] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('integration_settings')
      .select('key, value')
      .then(({ data, error }) => {
        if (error) {
          setError(error.message)
        } else {
          const map: Record<string, string> = {}
          for (const row of (data as Setting[]) ?? []) map[row.key] = row.value ?? ''
          setValues(map)
        }
        setLoading(false)
      })
  }, [])

  async function saveValue(key: string) {
    if (readOnly) return
    setSavingKey(key)
    const { error } = await supabase
      .from('integration_settings')
      .upsert({ key, value: values[key] ?? '', updated_at: new Date().toISOString() })

    setSavingKey(null)
    if (error) {
      toast.error('No se pudo guardar: ' + error.message)
      return
    }
    setSavedKey(key)
    setTimeout(() => setSavedKey(null), 1500)
  }

  async function toggleTaxiCallerMessages() {
    if (readOnly) return
    const current = values['TAXICALLER_AUTO_MESSAGE_ENABLED']
    const next = current === 'false' ? 'true' : 'false'
    setValues((prev) => ({ ...prev, TAXICALLER_AUTO_MESSAGE_ENABLED: next }))
    await supabase
      .from('integration_settings')
      .upsert({ key: 'TAXICALLER_AUTO_MESSAGE_ENABLED', value: next, updated_at: new Date().toISOString() })
  }

  async function toggleTaxiCallerCancelMessages() {
    if (readOnly) return
    const current = values['TAXICALLER_CANCEL_MESSAGE_ENABLED']
    const next = current === 'false' ? 'true' : 'false'
    setValues((prev) => ({ ...prev, TAXICALLER_CANCEL_MESSAGE_ENABLED: next }))
    await supabase
      .from('integration_settings')
      .upsert({ key: 'TAXICALLER_CANCEL_MESSAGE_ENABLED', value: next, updated_at: new Date().toISOString() })
  }

  async function toggleTaxiCallerFinishedMessages() {
    if (readOnly) return
    const current = values['TAXICALLER_FINISHED_MESSAGE_ENABLED']
    const next = current === 'false' ? 'true' : 'false'
    setValues((prev) => ({ ...prev, TAXICALLER_FINISHED_MESSAGE_ENABLED: next }))
    await supabase
      .from('integration_settings')
      .upsert({ key: 'TAXICALLER_FINISHED_MESSAGE_ENABLED', value: next, updated_at: new Date().toISOString() })
  }

  async function toggleTaxiCallerAssignedTracking() {
    if (readOnly) return
    const current = values['TAXICALLER_ASSIGNED_TRACKING_ENABLED']
    const next = current === 'false' ? 'true' : 'false'
    setValues((prev) => ({ ...prev, TAXICALLER_ASSIGNED_TRACKING_ENABLED: next }))
    await supabase
      .from('integration_settings')
      .upsert({ key: 'TAXICALLER_ASSIGNED_TRACKING_ENABLED', value: next, updated_at: new Date().toISOString() })
  }

  async function toggleBusinessHours() {
    if (readOnly) return
    const current = values['BUSINESS_HOURS_ENABLED']
    const next = current === 'true' ? 'false' : 'true'
    setValues((prev) => ({ ...prev, BUSINESS_HOURS_ENABLED: next }))
    await supabase.from('integration_settings').upsert({
      key: 'BUSINESS_HOURS_ENABLED',
      value: next,
      updated_at: new Date().toISOString(),
    })
  }

  async function toggleMissedCallAutoReply(channel: 'WHATSAPP' | 'RINGCENTRAL') {
    if (readOnly) return
    const key = `MISSED_CALL_AUTO_REPLY_${channel}_ENABLED`
    const current = values[key]
    const next = current === 'true' ? 'false' : 'true'
    setValues((prev) => ({ ...prev, [key]: next }))
    await supabase.from('integration_settings').upsert({ key, value: next, updated_at: new Date().toISOString() })
  }

  if (loading) return <p className="text-sm text-muted">Cargando...</p>
  if (error) return <p className="text-sm text-alert">Error: {error}</p>

  return (
    <div className="flex flex-col gap-4">
      {readOnly && (
        <p className="rounded-sm border border-alert/30 bg-alert/10 px-3 py-2 text-xs text-alert">
          Solo lectura — pedile a un Superadmin que edite Integraciones.
        </p>
      )}
      <p className="rounded-sm border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
        Lo que guardes acá lo leen las Edge Functions directamente (con respaldo en los secrets de la CLI
        si dejás algo vacío) — no hace falta redesplegar nada para que tome un valor nuevo.
      </p>

      <fieldset disabled={readOnly} className={readOnly ? 'opacity-60' : ''}>
      {groups.map((group) => (
        <div key={group.title} className="rounded-sm border border-panel-light bg-panel p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">{group.title}</h2>

          {group.title === 'RingCentral (SMS)' && (
            <div className="mb-4">
              <RingCentralStatusCard />
            </div>
          )}

          {group.title === 'Meta (WhatsApp / Facebook / Instagram)' && (
            <div className="mb-4">
              <MetaStatusCard />
            </div>
          )}

          {group.title === 'Horario de atención' && (
            <>
              <button
                onClick={toggleBusinessHours}
                className={`mb-3 flex items-center gap-2 rounded-sm border px-3 py-2 text-xs transition-colors ${
                  values['BUSINESS_HOURS_ENABLED'] === 'true'
                    ? 'border-available/40 text-available hover:bg-available/10'
                    : 'border-alert/40 text-alert hover:bg-alert/10'
                }`}
              >
                <Power size={13} />
                {values['BUSINESS_HOURS_ENABLED'] === 'true'
                  ? 'Aviso fuera de horario: Activado'
                  : 'Aviso fuera de horario: Desactivado'}
              </button>
              <p className="mb-3 text-[11px] text-muted">
                Cuando está activado, un cliente que escribe fuera del rango de abajo recibe el mensaje
                automático una sola vez cada 6 horas (no se repite si sigue escribiendo).
              </p>
            </>
          )}

          {group.title === 'Llamadas perdidas — respuesta automática' && (
            <>
              <p className="mb-3 rounded-sm border border-panel-light bg-asphalt px-3 py-2 text-[11px] text-muted">
                Solo lo puede prender/apagar un admin (esta pantalla ya es admin-only). Al detectar una
                llamada perdida, si está activado, se manda el mensaje preseteado y el chat se asigna
                directo a un operador disponible. Cooldown de 30 min por número — no se repite si la
                misma persona llama varias veces seguidas.
              </p>
              <button
                onClick={() => toggleMissedCallAutoReply('WHATSAPP')}
                className={`mb-2 flex items-center gap-2 rounded-sm border px-3 py-2 text-xs transition-colors ${
                  values['MISSED_CALL_AUTO_REPLY_WHATSAPP_ENABLED'] === 'true'
                    ? 'border-available/40 text-available hover:bg-available/10'
                    : 'border-alert/40 text-alert hover:bg-alert/10'
                }`}
              >
                <Power size={13} />
                {values['MISSED_CALL_AUTO_REPLY_WHATSAPP_ENABLED'] === 'true'
                  ? 'Auto-reply de llamada perdida (WhatsApp): Activado'
                  : 'Auto-reply de llamada perdida (WhatsApp): Desactivado'}
              </button>
              <button
                onClick={() => toggleMissedCallAutoReply('RINGCENTRAL')}
                className={`mb-4 flex items-center gap-2 rounded-sm border px-3 py-2 text-xs transition-colors ${
                  values['MISSED_CALL_AUTO_REPLY_RINGCENTRAL_ENABLED'] === 'true'
                    ? 'border-available/40 text-available hover:bg-available/10'
                    : 'border-alert/40 text-alert hover:bg-alert/10'
                }`}
              >
                <Power size={13} />
                {values['MISSED_CALL_AUTO_REPLY_RINGCENTRAL_ENABLED'] === 'true'
                  ? 'Auto-reply de llamada perdida (RingCentral): Activado'
                  : 'Auto-reply de llamada perdida (RingCentral): Desactivado'}
              </button>
            </>
          )}

          {group.title === 'TaxiCaller' && (
            <>
              <button
                onClick={toggleTaxiCallerMessages}
                className={`mb-2 flex items-center gap-2 rounded-sm border px-3 py-2 text-xs transition-colors ${
                  values['TAXICALLER_AUTO_MESSAGE_ENABLED'] === 'false'
                    ? 'border-alert/40 text-alert hover:bg-alert/10'
                    : 'border-available/40 text-available hover:bg-available/10'
                }`}
              >
                <Power size={13} />
                {values['TAXICALLER_AUTO_MESSAGE_ENABLED'] === 'false'
                  ? 'SMS automático de "Esperando al pasajero": Desactivado'
                  : 'SMS automático de "Esperando al pasajero": Activado'}
              </button>
              <button
                onClick={toggleTaxiCallerCancelMessages}
                className={`mb-2 flex items-center gap-2 rounded-sm border px-3 py-2 text-xs transition-colors ${
                  values['TAXICALLER_CANCEL_MESSAGE_ENABLED'] === 'false'
                    ? 'border-alert/40 text-alert hover:bg-alert/10'
                    : 'border-available/40 text-available hover:bg-available/10'
                }`}
              >
                <Power size={13} />
                {values['TAXICALLER_CANCEL_MESSAGE_ENABLED'] === 'false'
                  ? 'SMS automático de "Cancelado por la empresa": Desactivado'
                  : 'SMS automático de "Cancelado por la empresa": Activado'}
              </button>
              <button
                onClick={toggleTaxiCallerFinishedMessages}
                className={`mb-4 flex items-center gap-2 rounded-sm border px-3 py-2 text-xs transition-colors ${
                  values['TAXICALLER_FINISHED_MESSAGE_ENABLED'] === 'false'
                    ? 'border-alert/40 text-alert hover:bg-alert/10'
                    : 'border-available/40 text-available hover:bg-available/10'
                }`}
              >
                <Power size={13} />
                {values['TAXICALLER_FINISHED_MESSAGE_ENABLED'] === 'false'
                  ? 'SMS automático de "Servicio terminado": Desactivado'
                  : 'SMS automático de "Servicio terminado": Activado'}
              </button>
              <button
                onClick={toggleTaxiCallerAssignedTracking}
                className={`mb-4 flex items-center gap-2 rounded-sm border px-3 py-2 text-xs transition-colors ${
                  values['TAXICALLER_ASSIGNED_TRACKING_ENABLED'] === 'false'
                    ? 'border-alert/40 text-alert hover:bg-alert/10'
                    : 'border-available/40 text-available hover:bg-available/10'
                }`}
              >
                <Power size={13} />
                {values['TAXICALLER_ASSIGNED_TRACKING_ENABLED'] === 'false'
                  ? 'Seguimiento de "Servicio en camino" (ETA, sin SMS): Desactivado'
                  : 'Seguimiento de "Servicio en camino" (ETA, sin SMS): Activado'}
              </button>
            </>
          )}

          <div className="flex flex-col gap-2">
            {group.keys.map(({ key, label, secret }) => (
              <div key={key} className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-muted">{label}</label>
                  <input
                    type={secret ? 'password' : 'text'}
                    value={values[key] ?? ''}
                    onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
                    className="w-full rounded-sm border border-panel-light bg-asphalt px-2 py-1.5 font-mono text-xs text-cream outline-none focus:border-mustard"
                  />
                </div>
                <button
                  onClick={() => saveValue(key)}
                  disabled={savingKey === key}
                  className="flex items-center gap-1 rounded-sm border border-panel-light px-2 py-1.5 text-xs text-muted transition-colors hover:border-mustard hover:text-mustard disabled:opacity-50"
                >
                  {savedKey === key ? (
                    <Check size={12} className="text-available" />
                  ) : (
                    <Save size={12} />
                  )}
                  {savingKey === key ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
      </fieldset>
    </div>
  )
}
