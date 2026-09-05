import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

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

  return (
    <div className="flex flex-col gap-2">
      {events.map((e) => (
        <div key={e.id} className="flex items-start gap-2 text-xs">
          <span className="font-mono text-muted">
            {new Date(e.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
          </span>
          <span>{eventEmoji[e.event_type] ?? '•'}</span>
          <span className="text-cream">{e.description}</span>
        </div>
      ))}
    </div>
  )
}
