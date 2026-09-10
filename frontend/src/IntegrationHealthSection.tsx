import { useEffect, useState } from 'react'
import { RefreshCw, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { supabase } from './supabaseClient'

type HealthItem = {
  label: string
  lastEventAt: string | null
}

function statusFor(lastEventAt: string | null): { color: string; Icon: typeof CheckCircle2; label: string } {
  if (!lastEventAt) return { color: 'text-muted', Icon: XCircle, label: 'Sin eventos todavía' }
  const hoursAgo = (Date.now() - new Date(lastEventAt).getTime()) / (1000 * 60 * 60)
  if (hoursAgo < 6) return { color: 'text-available', Icon: CheckCircle2, label: 'Activo' }
  if (hoursAgo < 48) return { color: 'text-warning', Icon: AlertTriangle, label: 'Sin novedades hace un rato' }
  return { color: 'text-alert', Icon: XCircle, label: 'Mucho tiempo sin recibir nada' }
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'nunca'
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'recién'
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours}h`
  const days = Math.floor(hours / 24)
  return `hace ${days}d`
}

export default function IntegrationHealthSection() {
  const [items, setItems] = useState<HealthItem[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)

    const [smsMsg, waMsg, fbMsg, igMsg, rcMissed, waMissed, taxicaller] = await Promise.all([
      supabase
        .from('messages')
        .select('created_at')
        .eq('sender_type', 'contact')
        .eq('sent_via_channel', 'sms')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('messages')
        .select('created_at')
        .eq('sender_type', 'contact')
        .eq('sent_via_channel', 'whatsapp')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('messages')
        .select('created_at')
        .eq('sender_type', 'contact')
        .eq('sent_via_channel', 'facebook')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('messages')
        .select('created_at')
        .eq('sender_type', 'contact')
        .eq('sent_via_channel', 'instagram')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('missed_calls')
        .select('created_at')
        .eq('channel', 'ringcentral')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('missed_calls')
        .select('created_at')
        .eq('channel', 'whatsapp')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('taxicaller_processed_events')
        .select('processed_at')
        .order('processed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    setItems([
      { label: 'SMS entrante (RingCentral)', lastEventAt: smsMsg.data?.created_at ?? null },
      { label: 'Llamadas perdidas (RingCentral)', lastEventAt: rcMissed.data?.created_at ?? null },
      { label: 'WhatsApp entrante', lastEventAt: waMsg.data?.created_at ?? null },
      { label: 'Llamadas perdidas (WhatsApp)', lastEventAt: waMissed.data?.created_at ?? null },
      { label: 'Facebook entrante', lastEventAt: fbMsg.data?.created_at ?? null },
      { label: 'Instagram entrante', lastEventAt: igMsg.data?.created_at ?? null },
      { label: 'Eventos de TaxiCaller', lastEventAt: taxicaller.data?.processed_at ?? null },
    ])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-cream">Salud de integraciones</h2>
          <p className="text-xs text-muted">
            Última vez que llegó un evento real de cada canal — si algo lleva mucho tiempo sin novedades,
            puede ser que se haya caído en silencio sin que nadie lo note.
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1 rounded-sm border border-panel-light px-3 py-1.5 text-xs text-muted hover:border-mustard hover:text-mustard"
        >
          <RefreshCw size={13} /> Refrescar
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-muted">Cargando...</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {items.map((item) => {
            const { color, Icon, label } = statusFor(item.lastEventAt)
            return (
              <div
                key={item.label}
                className="flex items-center justify-between rounded-sm border border-panel-light bg-panel px-3 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <Icon size={15} className={color} />
                  <div>
                    <p className="text-sm text-cream">{item.label}</p>
                    <p className={`text-[11px] ${color}`}>{label}</p>
                  </div>
                </div>
                <span className="font-mono text-xs text-muted">{timeAgo(item.lastEventAt)}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
