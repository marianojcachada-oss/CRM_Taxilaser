import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-sm border border-panel-light bg-panel p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
      {children}
    </div>
  )
}

function StatRow({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-panel-light/60 py-2 last:border-0">
      <span className="text-sm text-muted">{label}</span>
      <span className={`font-mono text-sm ${alert ? 'text-alert' : 'text-cream'}`}>{value}</span>
    </div>
  )
}

function Bar({ label, value, display }: { label: string; value: number; display: string }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="font-mono text-cream">{display}</span>
      </div>
      <div className="h-1.5 w-full rounded-sm bg-asphalt">
        <div className="h-1.5 rounded-sm bg-mustard" style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

function formatMinutes(mins: number | null): string {
  if (mins === null) return 'Sin datos'
  if (mins < 60) return `${Math.round(mins)}m`
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  return `${h}h ${m}m`
}

const SLA_MINUTES = 30 // umbral de "vencido" — ajustable más adelante desde acá

export default function CommandCenterSection() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [activeCount, setActiveCount] = useState(0)
  const [unansweredCount, setUnansweredCount] = useState(0)
  const [slaOverdueCount, setSlaOverdueCount] = useState(0)
  const [avgResponseMinutes, setAvgResponseMinutes] = useState<number | null>(null)
  const [avgResolutionMinutes, setAvgResolutionMinutes] = useState<number | null>(null)
  const [channelPct, setChannelPct] = useState<Record<string, number>>({})
  const [channelCount, setChannelCount] = useState<Record<string, number>>({})
  const [agentCounts, setAgentCounts] = useState<{ name: string; count: number }[]>([])
  const [totalContacts, setTotalContacts] = useState(0)
  const [vipContacts, setVipContacts] = useState(0)
  const [avgReliability, setAvgReliability] = useState<number | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    setError(null)

    try {
      const [convRes, msgRes, opRes, contactRes] = await Promise.all([
        supabase.from('conversations').select('id, channel, status, unread, created_at, closed_at, last_message_at, assigned_operator_id'),
        supabase.from('messages').select('conversation_id, sender_type, sender_operator_id, created_at').order('created_at', { ascending: true }),
        supabase.from('operators').select('id, full_name'),
        supabase.from('contacts').select('vip, servicios_completados, servicios_cancelados'),
      ])

      if (convRes.error) throw convRes.error
      if (msgRes.error) throw msgRes.error
      if (opRes.error) throw opRes.error
      if (contactRes.error) throw contactRes.error

      const conversations = convRes.data ?? []
      const messages = msgRes.data ?? []
      const operators = opRes.data ?? []
      const contacts = contactRes.data ?? []

      // --- Operations ---
      setActiveCount(conversations.filter((c) => c.status !== 'cerrada').length)
      setUnansweredCount(conversations.filter((c) => c.unread).length)

      const slaThreshold = Date.now() - SLA_MINUTES * 60_000
      setSlaOverdueCount(
        conversations.filter(
          (c) => c.unread && c.last_message_at && new Date(c.last_message_at).getTime() < slaThreshold,
        ).length,
      )

      const resolvedDurations = conversations
        .filter((c) => c.status === 'cerrada' && c.closed_at)
        .map((c) => (new Date(c.closed_at!).getTime() - new Date(c.created_at).getTime()) / 60_000)
      setAvgResolutionMinutes(
        resolvedDurations.length ? resolvedDurations.reduce((a, b) => a + b, 0) / resolvedDurations.length : null,
      )

      // Tiempo de primera respuesta: por cada conversación, el tiempo entre
      // el primer mensaje del contacto y la primera respuesta del operador.
      const byConversation = new Map<string, typeof messages>()
      for (const m of messages) {
        const list = byConversation.get(m.conversation_id) ?? []
        list.push(m)
        byConversation.set(m.conversation_id, list)
      }
      const responseDurations: number[] = []
      for (const list of byConversation.values()) {
        const firstContact = list.find((m) => m.sender_type === 'contact')
        if (!firstContact) continue
        const firstReply = list.find(
          (m) => m.sender_type === 'operator' && new Date(m.created_at) > new Date(firstContact.created_at),
        )
        if (!firstReply) continue
        responseDurations.push(
          (new Date(firstReply.created_at).getTime() - new Date(firstContact.created_at).getTime()) / 60_000,
        )
      }
      setAvgResponseMinutes(
        responseDurations.length ? responseDurations.reduce((a, b) => a + b, 0) / responseDurations.length : null,
      )

      // --- Channels ---
      const channels = ['whatsapp', 'instagram', 'facebook', 'sms']
      const counts: Record<string, number> = {}
      const pcts: Record<string, number> = {}
      for (const ch of channels) {
        const n = conversations.filter((c) => c.channel === ch).length
        counts[ch] = n
        pcts[ch] = conversations.length > 0 ? Math.round((n / conversations.length) * 100) : 0
      }
      setChannelCount(counts)
      setChannelPct(pcts)

      // --- Agents (mensajes enviados por operador) ---
      const operatorMessageCounts = new Map<string, number>()
      for (const m of messages) {
        if (m.sender_type !== 'operator' || !m.sender_operator_id) continue
        operatorMessageCounts.set(m.sender_operator_id, (operatorMessageCounts.get(m.sender_operator_id) ?? 0) + 1)
      }
      const agents = operators
        .map((op) => ({ name: op.full_name, count: operatorMessageCounts.get(op.id) ?? 0 }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6)
      setAgentCounts(agents)

      // --- Business (lo que hoy podemos medir de verdad, sin TaxiCaller) ---
      setTotalContacts(contacts.length)
      setVipContacts(contacts.filter((c) => c.vip).length)
      const reliabilities = contacts
        .filter((c) => c.servicios_completados != null || c.servicios_cancelados != null)
        .map((c) => {
          const completados = c.servicios_completados ?? 0
          const cancelados = c.servicios_cancelados ?? 0
          const t = completados + cancelados
          return t > 0 ? (completados / t) * 100 : null
        })
        .filter((v): v is number => v !== null)
      setAvgReliability(reliabilities.length ? reliabilities.reduce((a, b) => a + b, 0) / reliabilities.length : null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <p className="text-sm text-muted">Cargando...</p>
  if (error) return <p className="text-sm text-alert">Error: {error}</p>

  const maxAgentCount = Math.max(1, ...agentCounts.map((a) => a.count))

  return (
    <div className="grid grid-cols-2 gap-4">
      <Panel title="Operations">
        <StatRow label="Conversaciones activas" value={String(activeCount)} />
        <StatRow label="Sin responder" value={String(unansweredCount)} alert={unansweredCount > 0} />
        <StatRow
          label={`SLA vencidos (>${SLA_MINUTES}m)`}
          value={String(slaOverdueCount)}
          alert={slaOverdueCount > 0}
        />
        <StatRow label="Tiempo de 1ª respuesta (prom.)" value={formatMinutes(avgResponseMinutes)} />
        <StatRow label="Tiempo de resolución (prom.)" value={formatMinutes(avgResolutionMinutes)} />
      </Panel>

      <Panel title="Channels">
        {Object.entries(channelPct).map(([ch, pct]) => (
          <Bar key={ch} label={ch} value={pct} display={`${channelCount[ch] ?? 0} (${pct}%)`} />
        ))}
      </Panel>

      <Panel title="Agents (mensajes enviados)">
        {agentCounts.length === 0 && <p className="text-xs text-muted">Todavía no hay mensajes de operadores.</p>}
        {agentCounts.map((a) => (
          <Bar
            key={a.name}
            label={a.name}
            value={Math.round((a.count / maxAgentCount) * 100)}
            display={String(a.count)}
          />
        ))}
      </Panel>

      <Panel title="Business">
        <StatRow label="Contactos totales" value={String(totalContacts)} />
        <StatRow label="Contactos VIP" value={String(vipContacts)} />
        <StatRow label="Fiabilidad promedio" value={avgReliability !== null ? `${Math.round(avgReliability)}%` : 'Sin datos'} />
        <p className="mt-2 text-[11px] text-muted">
          Leads, ventas y revenue necesitan la integración con TaxiCaller (todavía pendiente) para tener
          datos reales — por eso no aparecen acá en vez de mostrar números inventados.
        </p>
      </Panel>
    </div>
  )
}
