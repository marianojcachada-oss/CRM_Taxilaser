import { useEffect, useState } from 'react'
import { Phone, Check, Copy } from 'lucide-react'
import { supabase } from './supabaseClient'

type MissedCall = {
  id: string
  phone: string
  acknowledged: boolean
  created_at: string
  contacts: { full_name: string | null } | null
}

export default function MissedCallsView() {
  const [calls, setCalls] = useState<MissedCall[]>([])
  const [loading, setLoading] = useState(true)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    load()

    const channel = supabase
      .channel('missed-calls-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'missed_calls' }, load)
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  function load() {
    setLoading(true)
    supabase
      .from('missed_calls')
      .select('id, phone, acknowledged, created_at, contacts(full_name)')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setCalls((data as unknown as MissedCall[]) ?? [])
        setLoading(false)
      })
  }

  async function acknowledge(id: string) {
    setCalls((prev) => prev.map((c) => (c.id === id ? { ...c, acknowledged: true } : c)))
    await supabase.from('missed_calls').update({ acknowledged: true }).eq('id', id)
  }

  async function copyPhone(id: string, phone: string) {
    await navigator.clipboard.writeText(phone)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4">
      <p className="mb-4 rounded-sm border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
        El sistema no atiende llamadas — esto solo te avisa cuando alguien te llamó y no contestaste,
        para que lo llames de vuelta por WhatsApp, SMS o el medio que prefieras.
      </p>

      {loading && <p className="text-sm text-muted">Cargando...</p>}
      {!loading && calls.length === 0 && (
        <p className="text-sm text-muted">No hay llamadas perdidas registradas.</p>
      )}

      <div className="flex flex-col gap-2">
        {calls.map((c) => (
          <div
            key={c.id}
            className={`flex items-center justify-between rounded-sm border px-3 py-2.5 ${
              c.acknowledged ? 'border-panel-light bg-panel' : 'border-alert/40 bg-alert/10'
            }`}
          >
            <div className="flex items-center gap-2">
              <Phone size={14} className={c.acknowledged ? 'text-muted' : 'text-alert'} />
              <div>
                <p className="text-sm">{c.contacts?.full_name || 'Sin nombre'}</p>
                <p className="font-mono text-xs text-muted">{c.phone}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-muted">
                {new Date(c.created_at).toLocaleString('es-AR')}
              </span>
              <button
                onClick={() => copyPhone(c.id, c.phone)}
                className="text-muted transition-colors hover:text-mustard"
                title="Copiar teléfono"
              >
                {copiedId === c.id ? <Check size={13} className="text-available" /> : <Copy size={13} />}
              </button>
              {!c.acknowledged && (
                <button
                  onClick={() => acknowledge(c.id)}
                  className="rounded-sm border border-panel-light px-2 py-1 text-[11px] text-muted hover:border-mustard hover:text-mustard"
                >
                  Marcar como vista
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
