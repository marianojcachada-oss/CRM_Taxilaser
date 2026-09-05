import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle, RotateCw, PowerOff, Loader2 } from 'lucide-react'
import { supabase } from './supabaseClient'
import { getFunctionErrorMessage } from './functionsError'

type SubscribedApp = { whatsapp_business_api_data?: { name?: string; id?: string } }

export default function MetaStatusCard() {
  const [apps, setApps] = useState<SubscribedApp[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    refresh()
  }, [])

  async function refresh() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase.functions.invoke('setup-meta-subscription', {
      body: { action: 'status' },
    })
    setLoading(false)

    if (error || data?.error) {
      setApps(null)
      setError(await getFunctionErrorMessage(error, data))
      return
    }
    setApps(data.raw?.data ?? [])
  }

  async function activate() {
    setBusy(true)
    setMessage(null)
    const { data, error } = await supabase.functions.invoke('setup-meta-subscription', {
      body: { action: 'activate' },
    })
    setBusy(false)
    if (error || data?.error) {
      setError(await getFunctionErrorMessage(error, data))
      return
    }
    setMessage('Activado — ahora tu app también recibe estos mensajes.')
    refresh()
  }

  async function deactivate() {
    setBusy(true)
    setMessage(null)
    const { data, error } = await supabase.functions.invoke('setup-meta-subscription', {
      body: { action: 'deactivate' },
    })
    setBusy(false)
    if (error || data?.error) {
      setError(await getFunctionErrorMessage(error, data))
      return
    }
    setMessage('Desactivado — tu app ya no recibe estos mensajes (el otro sistema sigue funcionando igual).')
    refresh()
  }

  const ourAppSubscribed = !!apps && apps.length > 0

  return (
    <div className="rounded-sm border border-panel-light bg-panel p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
        WhatsApp / Facebook / Instagram
      </h2>

      {loading && (
        <p className="flex items-center gap-1.5 text-sm text-muted">
          <Loader2 size={13} className="animate-spin" /> Consultando estado...
        </p>
      )}

      {!loading && error && (
        <p className="mb-3 flex items-center gap-1.5 text-sm text-alert">
          <XCircle size={14} /> {error}
        </p>
      )}

      {!loading && !error && (
        <p
          className={`mb-3 flex items-center gap-1.5 text-sm font-medium ${
            ourAppSubscribed ? 'text-available' : 'text-muted'
          }`}
        >
          {ourAppSubscribed ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
          {ourAppSubscribed ? 'Recibiendo mensajes' : 'No suscripto todavía'}
        </p>
      )}

      <p className="mb-3 text-[11px] text-muted">
        Esto solo agrega tu app como receptor adicional — no le saca el acceso a la otra plataforma que ya
        usa este número.
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={activate}
          disabled={busy}
          className="flex items-center gap-1 rounded-sm bg-mustard px-2 py-1 text-xs font-medium text-asphalt hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <RotateCw size={12} />}
          Activar
        </button>
        <button
          onClick={deactivate}
          disabled={busy}
          className="flex items-center gap-1 rounded-sm border border-alert/40 px-2 py-1 text-xs text-alert hover:bg-alert/10 disabled:opacity-50"
        >
          <PowerOff size={12} /> Desactivar
        </button>
        <button
          onClick={refresh}
          className="flex items-center gap-1 rounded-sm border border-panel-light px-2 py-1 text-xs text-muted hover:border-mustard hover:text-mustard"
        >
          <RotateCw size={12} /> Volver a probar
        </button>
      </div>

      {message && <p className="mt-2 text-xs text-cream">{message}</p>}
    </div>
  )
}
