import { CheckCircle2, Circle } from 'lucide-react'
import { Fields, Group, INPUT_CLASS, SaveButton, Toggle, type Field, useIntegrationSettings } from './settingsUi'

// Configuración del motor de IA (Claude). Las claves siguen siendo las mismas
// de integration_settings; solo cambió de pantalla (antes estaba en Integrations).
const FIELDS: Field[] = [
  { key: 'CLAUDE_API_KEY', label: 'API Key de Claude', secret: true },
  { key: 'CLAUDE_MODEL', label: 'Modelo', placeholder: 'claude-haiku-4-5' },
]

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

export default function AISection({ readOnly = false }: { readOnly?: boolean }) {
  const { values, setValues, loading, error, savingKey, savedKey, saveValue, isOn, flip } = useIntegrationSettings(readOnly)
  const aiToggle = { key: 'AI_ENABLED', label: 'IA activada' }

  if (loading) return <p className="text-sm text-muted">Cargando...</p>
  if (error) return <p className="text-sm text-alert">Error: {error}</p>

  return (
    <div className="flex flex-col gap-4">
      <fieldset disabled={readOnly} className={readOnly ? 'opacity-60' : ''}>
        <Group title="Valeria — configuración">
          <Toggle label={aiToggle.label} on={isOn(aiToggle)} onClick={() => flip(aiToggle)} />
          <Fields fields={FIELDS} values={values} setValues={setValues} savingKey={savingKey} savedKey={savedKey} saveValue={saveValue} />
          <div>
            <label htmlFor="AI_SYSTEM_PROMPT" className="mb-1 block text-xs text-muted">
              Reglas de la IA (qué sí y qué no puede hacer)
            </label>
            <textarea
              id="AI_SYSTEM_PROMPT"
              value={values['AI_SYSTEM_PROMPT'] ?? ''}
              onChange={(e) => setValues((prev) => ({ ...prev, AI_SYSTEM_PROMPT: e.target.value }))}
              rows={8}
              className={`${INPUT_CLASS} mb-2`}
            />
            <div className="flex items-center gap-2">
              <SaveButton
                label="reglas de la IA"
                saving={savingKey === 'AI_SYSTEM_PROMPT'}
                saved={savedKey === 'AI_SYSTEM_PROMPT'}
                onClick={() => saveValue('AI_SYSTEM_PROMPT')}
              />
            </div>
          </div>
        </Group>
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
