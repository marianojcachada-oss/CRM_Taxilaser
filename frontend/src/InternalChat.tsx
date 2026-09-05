import { useEffect, useRef, useState } from 'react'
import { Send } from 'lucide-react'
import { supabase } from './supabaseClient'

type InternalMessage = {
  id: string
  content: string
  created_at: string
  sender_operator_id: string
  operators: { full_name: string } | null
}

type Props = {
  channelName: string
  operatorId: string | null
  operatorName: string
}

export default function InternalChat({ channelName, operatorId, operatorName }: Props) {
  const [channelId, setChannelId] = useState<string | null>(null)
  const [messages, setMessages] = useState<InternalMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const bottomRef = useRef<HTMLDivElement>(null)

  // Cargar el canal y su historial cuando cambia de equipo
  useEffect(() => {
    let cancelled = false
    setLoading(true)

    supabase
      .from('internal_channels')
      .select('id')
      .eq('name', channelName)
      .single()
      .then(async ({ data, error }) => {
        if (cancelled) return
        if (error || !data) {
          setError(error?.message ?? 'Canal no encontrado')
          setLoading(false)
          return
        }
        setChannelId(data.id)

        const { data: history, error: historyError } = await supabase
          .from('internal_messages')
          .select('id, content, created_at, sender_operator_id, operators(full_name)')
          .eq('channel_id', data.id)
          .order('created_at', { ascending: true })

        if (cancelled) return
        if (historyError) setError(historyError.message)
        else setMessages((history as unknown as InternalMessage[]) ?? [])
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [channelName])

  // Suscripción en tiempo real a mensajes nuevos de este canal
  useEffect(() => {
    if (!channelId) return

    const subscription = supabase
      .channel(`internal_messages_${channelId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'internal_messages', filter: `channel_id=eq.${channelId}` },
        async (payload) => {
          const { data: sender } = await supabase
            .from('operators')
            .select('full_name')
            .eq('id', payload.new.sender_operator_id)
            .single()

          setMessages((prev) => [
            ...prev,
            {
              id: payload.new.id,
              content: payload.new.content,
              created_at: payload.new.created_at,
              sender_operator_id: payload.new.sender_operator_id,
              operators: sender ? { full_name: sender.full_name } : null,
            },
          ])
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(subscription)
    }
  }, [channelId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!draft.trim() || !channelId || !operatorId) return

    const { error } = await supabase.from('internal_messages').insert({
      channel_id: channelId,
      sender_operator_id: operatorId,
      content: draft.trim(),
    })

    if (error) {
      alert('No se pudo enviar: ' + error.message)
      return
    }
    setDraft('')
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b border-panel-light bg-panel px-4 py-2.5">
        <span className="text-sm font-medium text-cream">💬 {channelName} · chat interno</span>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading && <p className="text-sm text-muted">Cargando...</p>}
        {error && <p className="text-sm text-alert">Error: {error}</p>}
        {!loading && !error && messages.length === 0 && (
          <p className="text-sm text-muted">Todavía no hay mensajes en este canal. Arrancá la charla.</p>
        )}

        {messages.map((m) => {
          const isMine = m.sender_operator_id === operatorId
          return (
            <div key={m.id} className={`mb-3 flex ${isMine ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-md px-3 py-2 text-sm ${
                  isMine
                    ? 'rounded-lg rounded-tr-none bg-mustard text-asphalt'
                    : 'rounded-lg rounded-tl-none bg-panel-light text-cream'
                }`}
              >
                {!isMine && (
                  <p className="mb-0.5 text-[10px] font-semibold opacity-70">
                    {m.operators?.full_name ?? 'Operador'}
                  </p>
                )}
                <p>{m.content}</p>
                <p className="mt-1 font-mono text-[10px] opacity-60">
                  {new Date(m.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="flex items-center gap-2 border-t border-panel-light bg-panel px-4 py-3">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Mensaje para ${channelName}...`}
          className="w-full rounded-sm border border-panel-light bg-asphalt px-3 py-2 text-sm text-cream placeholder-muted outline-none focus:border-mustard"
        />
        <button
          type="submit"
          className="flex shrink-0 items-center justify-center rounded-sm bg-mustard p-2 text-asphalt transition-opacity hover:opacity-90"
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  )
}
