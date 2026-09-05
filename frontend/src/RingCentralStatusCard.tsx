import { useEffect, useState } from 'react'
import { CheckCircle2, AlertTriangle, XCircle, Wrench, RotateCw, PowerOff, Loader2 } from 'lucide-react'
import { supabase } from './supabaseClient'
import { getFunctionErrorMessage } from './functionsError'

type Status = {
  connected: boolean
  subscriptionActive: boolean
  smsEventsEnabled: boolean
  expirationTime: string | null
  problem: string | null
}

export default function RingCentralStatusCard() {
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [renewing, setRenewing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    refresh()
  }, [])

  async function refresh() {
    setLoading(true)
    setError(null)

    const { data, error } = await supabase.functions.invoke('setup-ringcentral-subscription', {
      body: { action: 'status' },
    })

    setLoading(false)

    if (error || data?.error) {
      setStatus(null)
      setError(await getFunctionErrorMessage(error, data))
      return
    }

    const raw = data.raw
    const disabled = raw.disabledFilters?.[0]

    setStatus({
      connected: true,
      subscriptionActive: raw.status === 'Active',
      smsEventsEnabled: !disabled,
      expirationTime: raw.expirationTime,
      problem: disabled?.message ?? null,
    })
  }

  async function renew() {
    setRenewing(true)
    const { data, error } = await supabase.functions.invoke('setup-ringcentral-subscription', {
      body: { action: 'activate' },
    })
    setRenewing(false)

    if (error || data?.error) {
      setError(await getFunctionErrorMessage(error, data))
      return
    }
    refresh()
  }

  async function deactivate() {
    setRenewing(true)
    const { data, error } = await supabase.functions.invoke('setup-ringcentral-subscription', {
      body: { action: 'deactivate' },
    })
    setRenewing(false)

    if (error || data?.error) {
      setError(await getFunctionErrorMessage(error, data))
      return
    }
    refresh()
  }

  function openDevConsole() {
    window.open('https://developers.ringcentral.com/my-account.html#/applications', '_blank')
  }

  const allGood = status?.connected && status.subscriptionActive && status.smsEventsEnabled

  return (
    <div className="rounded-sm border border-panel-light bg-panel p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">RingCentral SMS</h2>

      {loading && (
        <p className="flex items-center gap-1.5 text-sm text-muted">
          <Loader2 size={13} className="animate-spin" /> Consultando estado...
        </p>
      )}

      {!loading && error && (
        <>
          <p className="mb-3 flex items-center gap-1.5 text-sm text-alert">
            <XCircle size={14} /> No conectado — {error}
          </p>
          <button
            onClick={renew}
            disabled={renewing}
            className="flex items-center gap-1 rounded-sm bg-mustard px-2 py-1 text-xs font-medium text-asphalt hover:opacity-90 disabled:opacity-50"
          >
            {renewing ? <Loader2 size={12} className="animate-spin" /> : <RotateCw size={12} />}
            Activar
          </button>
        </>
      )}

      {!loading && status && (
        <>
          <p
            className={`mb-3 flex items-center gap-1.5 text-sm font-medium ${
              allGood ? 'text-available' : 'text-warning'
            }`}
          >
            {allGood ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
            {allGood ? 'Conectado' : 'Conectado, con problemas'}
          </p>

          <div className="mb-3 flex flex-col gap-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted">Webhook</span>
              <span className="text-available">Conectado</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Suscripción</span>
              <span className={status.subscriptionActive ? 'text-available' : 'text-alert'}>
                {status.subscriptionActive ? 'Activa' : 'Inactiva'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Eventos SMS</span>
              <span className={status.smsEventsEnabled ? 'text-available' : 'text-warning'}>
                {status.smsEventsEnabled ? 'Habilitados' : '⚠️ Deshabilitados'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Vencimiento</span>
              <span className="text-cream">
                {status.expirationTime ? new Date(status.expirationTime).toLocaleDateString('es-AR') : '—'}
              </span>
            </div>
          </div>

          {status.problem && (
            <div className="mb-3 rounded-sm border border-warning/40 bg-warning/10 px-2.5 py-2 text-xs text-warning">
              <strong>Problema:</strong> {status.problem}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {status.problem && (
              <button
                onClick={openDevConsole}
                className="flex items-center gap-1 rounded-sm border border-panel-light px-2 py-1 text-xs text-muted hover:border-mustard hover:text-mustard"
              >
                <Wrench size={12} /> Corregir permisos
              </button>
            )}
            <button
              onClick={renew}
              disabled={renewing}
              className="flex items-center gap-1 rounded-sm border border-panel-light px-2 py-1 text-xs text-muted hover:border-mustard hover:text-mustard disabled:opacity-50"
            >
              {renewing ? <Loader2 size={12} className="animate-spin" /> : <RotateCw size={12} />}
              Renovar suscripción
            </button>
            {status.subscriptionActive && (
              <button
                onClick={deactivate}
                disabled={renewing}
                className="flex items-center gap-1 rounded-sm border border-alert/40 px-2 py-1 text-xs text-alert hover:bg-alert/10 disabled:opacity-50"
              >
                <PowerOff size={12} /> Desactivar
              </button>
            )}
            <button
              onClick={refresh}
              className="flex items-center gap-1 rounded-sm border border-panel-light px-2 py-1 text-xs text-muted hover:border-mustard hover:text-mustard"
            >
              <RotateCw size={12} /> Volver a probar
            </button>
          </div>
        </>
      )}
    </div>
  )
}
