import { useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw, Trash2 } from 'lucide-react'
import { supabase } from './supabaseClient'

type AppError = {
  id: string
  created_at: string
  context: string | null
  message: string
  stack: string | null
  url: string | null
  user_agent: string | null
  operator_id: string | null
}

export default function ErrorLogsSection() {
  const [errors, setErrors] = useState<AppError[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('app_errors')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200)
    setErrors(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function clearAll() {
    if (!confirm('¿Borrar todos los errores registrados?')) return
    await supabase.from('app_errors').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    load()
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-cream">Errores del navegador</h2>
          <p className="text-xs text-muted">
            Excepciones que le pasaron a algún operador en pantalla. Para errores del servidor
            (Edge Functions: envío de mensajes, webhooks, etc.) mirá los Logs en el dashboard de
            Supabase — esto solo cubre el lado del navegador.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="flex items-center gap-1 rounded-sm border border-panel-light px-3 py-1.5 text-xs text-muted hover:border-mustard hover:text-mustard"
          >
            <RefreshCw size={13} /> Refrescar
          </button>
          <button
            onClick={clearAll}
            className="flex items-center gap-1 rounded-sm border border-panel-light px-3 py-1.5 text-xs text-muted hover:border-alert hover:text-alert"
          >
            <Trash2 size={13} /> Borrar todo
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted">Cargando...</p>
      ) : errors.length === 0 ? (
        <p className="text-sm text-muted">Sin errores registrados en los últimos 30 días. 🎉</p>
      ) : (
        <div className="flex flex-col gap-2">
          {errors.map((e) => (
            <div key={e.id} className="rounded-sm border border-panel-light bg-panel px-3 py-2.5">
              <button
                onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
                className="flex w-full items-start gap-2 text-left"
              >
                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-alert" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-cream">{e.message}</p>
                  <p className="text-[11px] text-muted">
                    {new Date(e.created_at).toLocaleString('es-AR')} · {e.context ?? 'sin contexto'}
                  </p>
                </div>
              </button>
              {expandedId === e.id && (
                <div className="mt-2 space-y-1 border-t border-panel-light pt-2 text-[11px] text-muted">
                  {e.url && <p>URL: {e.url}</p>}
                  {e.user_agent && <p>Navegador: {e.user_agent}</p>}
                  {e.stack && (
                    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-sm bg-asphalt p-2 text-[10px]">
                      {e.stack}
                    </pre>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
