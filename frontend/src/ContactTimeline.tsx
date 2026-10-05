import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { formatMessageTime } from './atlantaTime'

type TimelineEvent = {
  id: string
  event_type: string
  description: string
  created_at: string
}

const eventEmoji: Record<string, string> = {
  message: '💬',
  assigned: '👤',
  tag_added: '🏷️',
  ride_created: '🚕',
  driver_arrived: '📍',
  ride_cancelled: '❌',
  ride_completed: '🏁',
  automation: '🤖',
  closed: '✅',
  reopened: '🔄',
  blocked: '🚫',
  unblocked: '✅',
}

type Props = { contactId: string }

export default function ContactTimeline({ contactId }: Props) {
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    supabase
      .from('contact_timeline')
      .select('id, event_type, description, created_at')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(30)
      .then(({ data }) => {
        if (cancelled) return
        setEvents(data ?? [])
        setLoading(false)
      })

    const channel = supabase
      .channel(`timeline_${contactId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'contact_timeline', filter: `contact_id=eq.${contactId}` },
        (payload) => {
          setEvents((prev) => [payload.new as TimelineEvent, ...prev])
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [contactId])

  if (loading) return <p className="text-xs text-muted">Cargando...</p>
  if (events.length === 0) return <p className="text-xs text-muted">Todavía no hay actividad registrada.</p>

  // Agrupa mensajes seguidos ("9 mensajes de 1:22 a 1:28") — es solo
  // presentación, los eventos de la base no se tocan. Los eventos vienen del
  // más nuevo al más viejo.
  type Row = { id: string; type: string; text: string; time: string; count: number; oldest: string }
  const rows: Row[] = []
  for (const e of events) {
    const last = rows[rows.length - 1]
    if (e.event_type === 'message' && last && last.type === 'message') {
      last.count += 1
      last.oldest = e.created_at
      last.text = `${last.count} mensajes`
      continue
    }
    rows.push({ id: e.id, type: e.event_type, text: e.description, time: e.created_at, count: 1, oldest: e.created_at })
  }
  const timeLabel = (r: Row) =>
    r.count > 1 ? `${formatMessageTime(r.oldest)} – ${formatMessageTime(r.time)}` : formatMessageTime(r.time)

  const visible = showAll ? rows : rows.slice(0, 8)

  return (
    <div className="flex flex-col gap-2">
      {visible.map((r) => (
        <div key={r.id} className="flex items-start gap-2 text-xs">
          <span className="w-24 shrink-0 font-mono text-muted">{timeLabel(r)}</span>
          <span aria-hidden="true">{eventEmoji[r.type] ?? '•'}</span>
          <span className="text-cream">{r.text}</span>
        </div>
      ))}
      {rows.length > 8 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="self-start rounded-sm border border-panel-light px-2 py-1 text-xs text-muted hover:border-mustard hover:text-mustard"
        >
          {showAll ? 'Ver menos' : `Ver todos los eventos (${rows.length})`}
        </button>
      )}
    </div>
  )
}
