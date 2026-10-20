import { supabase } from './supabaseClient'
import { Fields, Group, Toggle, type Field, type ToggleDef, useIntegrationSettings } from './settingsUi'
import RingCentralStatusCard from './RingCentralStatusCard'
import MetaStatusCard from './MetaStatusCard'

// Credenciales y datos de cada servicio. Los nombres de las claves no cambian
// (las leen las Edge Functions); solo se acortaron los textos.
const FIELDS: Record<string, Field[]> = {
  meta: [
    { key: 'META_ACCESS_TOKEN', label: 'Access Token', secret: true },
    { key: 'META_APP_SECRET', label: 'App Secret', secret: true },
    { key: 'META_VERIFY_TOKEN', label: 'Verify Token' },
    { key: 'META_WABA_ID', label: 'WhatsApp Business Account ID' },
    { key: 'META_PHONE_NUMBER_ID', label: 'Phone Number ID' },
  ],
  ringcentral: [
    { key: 'RINGCENTRAL_SERVER_URL', label: 'Server URL' },
    { key: 'RINGCENTRAL_CLIENT_ID', label: 'Client ID' },
    { key: 'RINGCENTRAL_CLIENT_SECRET', label: 'Client Secret', secret: true },
    { key: 'RINGCENTRAL_JWT', label: 'JWT', secret: true },
    { key: 'RINGCENTRAL_EXTENSION_ID', label: 'Extension ID', placeholder: '~ = tu propia extensión' },
    { key: 'RINGCENTRAL_FROM_NUMBER', label: 'Número que envía SMS', placeholder: '+14045968232' },
    { key: 'RINGCENTRAL_STATUS_WEBHOOK_URL', label: 'Estado de entrega — URL', wide: true },
    { key: 'RINGCENTRAL_STATUS_WEBHOOK_SECRET', label: 'Estado de entrega — secreto', secret: true },
    { key: 'RINGCENTRAL_METRICS_SYNC_SECRET', label: 'Métricas — secreto', secret: true },
  ],
  taxicaller: [
    { key: 'TAXICALLER_BASE_URL', label: 'Base URL' },
    { key: 'TAXICALLER_API_KEY', label: 'API Key', secret: true },
    { key: 'TAXICALLER_WEBHOOK_SECRET', label: 'Secreto del webhook', secret: true },
    {
      key: 'TAXICALLER_PASSENGER_LOOKUP_PATH',
      label: 'Ruta para buscar pasajero',
      placeholder: '/api/v1/passengers/search?phone={phone}',
      wide: true,
    },
  ],
  horario: [
    { key: 'BUSINESS_HOURS_START', label: 'Apertura', placeholder: '08:00' },
    { key: 'BUSINESS_HOURS_END', label: 'Cierre', placeholder: '22:00' },
    { key: 'BUSINESS_HOURS_TIMEZONE', label: 'Zona horaria', placeholder: 'America/New_York' },
    { key: 'BUSINESS_HOURS_MESSAGE', label: 'Mensaje fuera de horario', wide: true },
  ],
  traduccion: [
    { key: 'DEEPL_API_KEY', label: 'DeepL — API Key', secret: true },
    { key: 'AZURE_TRANSLATOR_KEY', label: 'Azure — Key', secret: true },
    { key: 'AZURE_TRANSLATOR_REGION', label: 'Azure — Región', placeholder: 'eastus' },
    { key: 'LIBRETRANSLATE_URL', label: 'LibreTranslate — URL' },
    { key: 'LIBRETRANSLATE_API_KEY', label: 'LibreTranslate — API Key', secret: true },
    { key: 'MYMEMORY_EMAIL', label: 'MyMemory — email' },
  ],
}

// Interruptores.
const TOGGLES: Record<string, ToggleDef[]> = {
  taxicaller: [
    { key: 'TAXICALLER_AUTO_MESSAGE_ENABLED', label: 'Aviso: esperando al pasajero', defaultOn: true },
    { key: 'TAXICALLER_CANCEL_MESSAGE_ENABLED', label: 'Aviso: cancelado por la empresa', defaultOn: true },
    { key: 'TAXICALLER_FINISHED_MESSAGE_ENABLED', label: 'Aviso: servicio terminado', defaultOn: true },
    { key: 'TAXICALLER_ASSIGNED_TRACKING_ENABLED', label: 'Seguimiento "en camino" (sin SMS)', defaultOn: true },
  ],
  horario: [{ key: 'BUSINESS_HOURS_ENABLED', label: 'Aviso fuera de horario' }],
  llamadas: [
    { key: 'MISSED_CALLS_COUNTER_ENABLED', label: 'Contador en el menú', defaultOn: true },
    { key: 'MISSED_CALL_AUTO_REPLY_WHATSAPP_ENABLED', label: 'Respuesta automática por WhatsApp' },
    { key: 'MISSED_CALL_AUTO_REPLY_RINGCENTRAL_ENABLED', label: 'Respuesta automática por SMS' },
  ],
}

type AutomatedMode = 'sms' | 'whatsapp' | 'last_channel' | 'none'

const AUTOMATED_MODE_OPTIONS: { value: AutomatedMode; label: string }[] = [
  { value: 'sms', label: 'SMS' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'last_channel', label: 'Último canal del cliente' },
  { value: 'none', label: 'No enviar' },
]

export default function IntegrationsSection({ readOnly = false }: { readOnly?: boolean }) {
  const { values, setValues, loading, error, savingKey, savedKey, saveValue, isOn, flip } = useIntegrationSettings(readOnly)

  // Por dónde salen los avisos automáticos de TaxiCaller (AUTOMATED_MESSAGES_MODE).
  // Si nunca se eligió, se muestra lo que deducen las Edge Functions de los
  // dos interruptores viejos, así la pantalla refleja lo que realmente pasa.
  function currentAutomatedMode(): AutomatedMode {
    const saved = values['AUTOMATED_MESSAGES_MODE']
    if (saved === 'sms' || saved === 'whatsapp' || saved === 'last_channel' || saved === 'none') return saved
    const smsOff = values['AUTOMATED_MESSAGES_RINGCENTRAL_ENABLED'] === 'false'
    const waOff = values['AUTOMATED_MESSAGES_WHATSAPP_ENABLED'] === 'false'
    if (smsOff && waOff) return 'none'
    if (smsOff) return 'whatsapp'
    if (waOff) return 'sms'
    return 'last_channel'
  }

  async function setAutomatedMode(mode: AutomatedMode) {
    if (readOnly) return
    setValues((prev) => ({ ...prev, AUTOMATED_MESSAGES_MODE: mode }))
    await supabase
      .from('integration_settings')
      .upsert({ key: 'AUTOMATED_MESSAGES_MODE', value: mode, updated_at: new Date().toISOString() })
  }

  function renderToggles(name: string) {
    return (TOGGLES[name] ?? []).map((t) => <Toggle key={t.key} label={t.label} on={isOn(t)} onClick={() => flip(t)} />)
  }

  function renderFields(name: string) {
    return <Fields fields={FIELDS[name]} values={values} setValues={setValues} savingKey={savingKey} savedKey={savedKey} saveValue={saveValue} />
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

      <fieldset disabled={readOnly} className={`flex flex-col gap-4 ${readOnly ? 'opacity-60' : ''}`}>
        <Group title="Meta (WhatsApp / Facebook / Instagram)">
          <MetaStatusCard />
          {renderFields('meta')}
        </Group>

        <Group title="RingCentral (SMS)">
          <RingCentralStatusCard />
          {renderFields('ringcentral')}
        </Group>

        <Group title="TaxiCaller">
          {renderFields('taxicaller')}
          <div className="flex flex-col gap-2">{renderToggles('taxicaller')}</div>
          <div>
            <p className="mb-1 text-xs text-muted">Los avisos salen por</p>
            <div role="radiogroup" aria-label="Canal de los avisos automáticos" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {AUTOMATED_MODE_OPTIONS.map((opt) => {
                const selected = currentAutomatedMode() === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setAutomatedMode(opt.value)}
                    className={`rounded-sm border px-2 py-2 text-xs transition-colors ${
                      selected
                        ? opt.value === 'none'
                          ? 'border-alert/60 bg-alert/10 text-alert'
                          : 'border-available/60 bg-available/10 text-available'
                        : 'border-panel-light text-muted hover:border-mustard hover:text-mustard'
                    }`}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>
        </Group>

        <Group title="Horario de atención">
          {renderToggles('horario')}
          {renderFields('horario')}
        </Group>

        <Group title="Llamadas perdidas">{renderToggles('llamadas')}</Group>

        <Group title="Traducción">{renderFields('traduccion')}</Group>
      </fieldset>
    </div>
  )
}
