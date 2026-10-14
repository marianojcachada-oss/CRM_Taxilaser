import { useEffect, useState } from 'react'
import { X, LifeBuoy } from 'lucide-react'
import { supabase } from './supabaseClient'
import { useToast } from './Toast'
import { formatMessageDateTimeShort } from './atlantaTime'

type Kind = 'problema' | 'idea' | 'soporte'

type MyReport = {
  id: string
  created_at: string
  kind: Kind
  message: string
  status: 'nuevo' | 'en_revision' | 'resuelto'
  admin_reply: string | null
  replied_at: string | null
}

const KIND_LABEL: Record<Kind, string> = {
  problema: '🐞 Problema',
  idea: '💡 Idea',
  soporte: '🛟 Soporte',
}

const STATUS_LABEL: Record<MyReport['status'], string> = {
  nuevo: 'Enviado',
  en_revision: 'En revisión',
  resuelto: 'Resuelto',
}

const MAX_LEN = 2000

type Props = {
  operatorId: string | null
  operatorName: string
  operatorCode: string | null
  conversationId: string | null
  onClose: () => void
}

// Reporta un problema, idea o pedido de soporte directo al superadmin. Queda
// guardado con quién lo mandó y cuándo (tabla problem_reports) y no se puede
// editar ni borrar desde la app, para que sirva de registro.
export default function ReportProblemModal({ operatorId, operatorName, operatorCode, conversationId, onClose }: Props) {
  const toast = useToast()
  const [kind, setKind] = useState<Kind>('problema')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mine, setMine] = useState<MyReport[]>([])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function loadMine() {
    if (!operatorId) return
    supabase
      .from('problem_reports')
      .select('id, created_at, kind, message, status, admin_reply, replied_at')
      .eq('sender_operator_id', operatorId)
      .order('created_at', { ascending: false })
      .limit(5)
      .then(({ data }) => setMine((data as MyReport[]) ?? []))
  }

  useEffect(loadMine, [operatorId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = message.trim()
    if (!text || !operatorId) return
    setSending(true)
    setError(null)

    const { error: insertError } = await supabase.from('problem_reports').insert({
      kind,
      message: text,
      sender_operator_id: operatorId,
      sender_name: operatorName,
      sender_code: operatorCode,
      page_url: window.location.pathname + window.location.search,
      conversation_id: conversationId,
      user_agent: navigator.userAgent.slice(0, 300),
    })

    setSending(false)
    if (insertError) {
      setError('No se pudo enviar: ' + insertError.message)
      return
    }
    toast.success('Listo, tu mensaje le llegó al administrador.')
    setMessage('')
    loadMine()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-y-auto rounded-sm border border-panel-light bg-panel p-4"
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-sm font-medium text-mustard">
            <LifeBuoy size={14} /> Reportar un problema o idea
          </span>
          <button onClick={onClose} aria-label="Cerrar" className="text-muted hover:text-cream">
            <X size={16} />
          </button>
        </div>

        <p className="mb-3 text-xs text-muted">
          Le llega directo al administrador y queda registrado con tu nombre, la fecha y la hora.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <div className="flex gap-1.5">
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                aria-pressed={kind === k}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  kind === k
                    ? 'border-mustard bg-mustard/15 font-semibold text-mustard'
                    : 'border-panel-light text-muted hover:text-cream'
                }`}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>

          <textarea
            autoFocus
            required
            rows={5}
            maxLength={MAX_LEN}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={
              kind === 'problema'
                ? 'Contá qué pasó: qué estabas haciendo y qué viste en pantalla…'
                : kind === 'idea'
                  ? 'Contá tu idea o sugerencia…'
                  : 'Contá en qué necesitás ayuda…'
            }
            className="w-full resize-none rounded-sm border border-panel-light bg-asphalt px-2.5 py-2 text-sm text-cream placeholder-muted outline-none focus:border-mustard"
          />
          <div className="flex items-center justify-between text-[11px] text-muted">
            <span>Se manda también la pantalla donde estás{conversationId ? ' y la conversación abierta' : ''}.</span>
            <span className="tabular-nums">
              {message.length}/{MAX_LEN}
            </span>
          </div>

          {error && <p className="text-xs text-alert">{error}</p>}

          <button
            type="submit"
            disabled={sending || !message.trim() || !operatorId}
            className="rounded-sm bg-mustard px-3 py-1.5 text-xs font-medium text-asphalt hover:opacity-90 disabled:opacity-50"
          >
            {sending ? 'Enviando...' : 'Enviar al administrador'}
          </button>
        </form>

        {mine.length > 0 && (
          <div className="mt-4 border-t border-panel-light pt-3">
            <p className="mb-2 text-xs font-medium text-muted">Tus últimos mensajes</p>
            <div className="flex flex-col gap-2">
              {mine.map((r) => (
                <div key={r.id} className="rounded-sm border border-panel-light bg-asphalt px-2.5 py-2">
                  <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-muted">
                    <span>
                      {KIND_LABEL[r.kind]} · {formatMessageDateTimeShort(r.created_at)}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 ${
                        r.status === 'resuelto' ? 'border-available/40 text-available' : 'border-panel-light'
                      }`}
                    >
                      {STATUS_LABEL[r.status]}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-xs text-cream">{r.message}</p>
                  {r.admin_reply && (
                    <p className="mt-2 whitespace-pre-wrap break-words border-l-2 border-mustard pl-2 text-xs text-cream">
                      <span className="block text-[10px] uppercase tracking-wide text-mustard">Respuesta del administrador</span>
                      {r.admin_reply}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
