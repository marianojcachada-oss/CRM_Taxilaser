import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { supabase } from './supabaseClient'

type Campaign = { id: string; name: string; channel: string; audience_tag: string | null; status: string }
type Template = { id: string; title: string }

const channels = ['whatsapp', 'facebook', 'instagram', 'sms']

export default function CampaignsSection() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [channel, setChannel] = useState('whatsapp')
  const [templateId, setTemplateId] = useState('')
  const [audienceTag, setAudienceTag] = useState('')

  useEffect(() => {
    load()
  }, [])

  function load() {
    setLoading(true)
    Promise.all([
      supabase.from('campaigns').select('id, name, channel, audience_tag, status').order('created_at', { ascending: false }),
      supabase.from('message_templates').select('id, title'),
    ]).then(([campaignsRes, templatesRes]) => {
      if (campaignsRes.error) setError(campaignsRes.error.message)
      else setCampaigns(campaignsRes.data ?? [])
      setTemplates(templatesRes.data ?? [])
      setLoading(false)
    })
  }

  async function createCampaign(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return

    const { data, error } = await supabase
      .from('campaigns')
      .insert({
        name,
        channel,
        template_id: templateId || null,
        audience_tag: audienceTag || null,
      })
      .select('id, name, channel, audience_tag, status')
      .single()

    if (error) {
      alert('No se pudo crear la campaña: ' + error.message)
      return
    }
    setCampaigns((prev) => [data, ...prev])
    setName('')
    setAudienceTag('')
  }

  async function deleteCampaign(id: string) {
    const { error } = await supabase.from('campaigns').delete().eq('id', id)
    if (error) return alert('No se pudo borrar: ' + error.message)
    setCampaigns((prev) => prev.filter((c) => c.id !== id))
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-sm border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
        Esto arma y guarda campañas como borrador. El motor que efectivamente <strong>envía</strong> los
        mensajes masivos (respetando límites de WhatsApp/Meta y horarios) todavía no está construido — es
        el paso que sigue después de esto.
      </p>

      <form onSubmit={createCampaign} className="rounded-sm border border-panel-light bg-panel p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Nueva campaña</h2>
        <div className="mb-2">
          <label className="mb-1 block text-xs text-muted">Nombre</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-sm border border-panel-light bg-asphalt px-2 py-1.5 text-sm text-cream outline-none focus:border-mustard"
          />
        </div>
        <div className="mb-2 grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs text-muted">Canal</label>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="w-full rounded-sm border border-panel-light bg-asphalt px-2 py-1.5 text-sm text-cream outline-none focus:border-mustard"
            >
              {channels.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Macro (opcional)</label>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-full rounded-sm border border-panel-light bg-asphalt px-2 py-1.5 text-sm text-cream outline-none focus:border-mustard"
            >
              <option value="">Sin macro</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mb-3">
          <label className="mb-1 block text-xs text-muted">Audiencia (tag)</label>
          <input
            type="text"
            value={audienceTag}
            onChange={(e) => setAudienceTag(e.target.value)}
            placeholder="Ej: VIP"
            className="w-full rounded-sm border border-panel-light bg-asphalt px-2 py-1.5 text-sm text-cream outline-none focus:border-mustard"
          />
        </div>
        <button
          type="submit"
          className="flex items-center gap-1 rounded-sm bg-mustard px-3 py-1.5 text-xs font-medium text-asphalt hover:opacity-90"
        >
          <Plus size={13} /> Guardar como borrador
        </button>
      </form>

      <div className="rounded-sm border border-panel-light bg-panel p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Campañas</h2>
        {loading && <p className="text-sm text-muted">Cargando...</p>}
        {error && <p className="text-sm text-alert">Error: {error}</p>}
        {!loading && !error && campaigns.length === 0 && (
          <p className="text-sm text-muted">Todavía no hay campañas.</p>
        )}
        <div className="flex flex-col gap-2">
          {campaigns.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-sm border border-panel-light px-3 py-2">
              <div>
                <p className="text-sm font-medium">{c.name}</p>
                <p className="text-xs text-muted">
                  {c.channel} {c.audience_tag && `· ${c.audience_tag}`} ·{' '}
                  <span className="text-warning">{c.status}</span>
                </p>
              </div>
              <button onClick={() => deleteCampaign(c.id)} className="text-muted hover:text-alert">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
