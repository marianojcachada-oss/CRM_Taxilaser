import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'
import type { Conversation } from './ConversationsView'
import { statusConfig } from './ConversationsView'

function Bar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="font-mono text-cream">{count}</span>
      </div>
      <div className="h-1.5 w-full rounded-sm bg-asphalt">
        <div className={`h-1.5 rounded-sm ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-sm border border-panel-light bg-panel p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
      {children}
    </div>
  )
}

type Props = { conversations: Conversation[] }

function toDateInputValue(d: Date) {
  return d.toISOString().slice(0, 10)
}

// Heurística por palabras clave — no es un modelo de lenguaje real, es el
// mismo tipo de enfoque que usamos para clasificar el estado automático
// de las conversaciones. Suficiente para una idea general, no perfecto.
const POSITIVE_RE = /gracias|perfecto|excelente|genial|buen[ií]simo|joya|encantad|feliz|s[uú]per|buena onda/i
const NEGATIVE_RE = /reclamo|terrible|p[eé]simo|horrible|nunca|mal servicio|enojad|molest|indignante|desastre|denuncia|asco|fatal/i

function classifySentiment(text: string): 'positive' | 'neutral' | 'negative' {
  if (NEGATIVE_RE.test(text)) return 'negative'
  if (POSITIVE_RE.test(text)) return 'positive'
  return 'neutral'
}

export default function AnalyticsSection({ conversations }: Props) {
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return toDateInputValue(d)
  })
  const [dateTo, setDateTo] = useState(() => toDateInputValue(new Date()))
  const [contactMessages, setContactMessages] = useState<{ content: string; created_at: string }[]>([])

  useEffect(() => {
    supabase
      .from('messages')
      .select('content, created_at')
      .eq('sender_type', 'contact')
      .not('content', 'is', null)
      .then(({ data }) => setContactMessages(data ?? []))
  }, [])

  const filtered = useMemo(() => {
    const from = new Date(dateFrom + 'T00:00:00')
    const to = new Date(dateTo + 'T23:59:59')
    return conversations.filter((c) => {
      const created = new Date(c.createdAt)
      return created >= from && created <= to
    })
  }, [conversations, dateFrom, dateTo])

  const total = filtered.length

  const sentimentCounts = useMemo(() => {
    const from = new Date(dateFrom + 'T00:00:00')
    const to = new Date(dateTo + 'T23:59:59')
    const inRange = contactMessages.filter((m) => {
      const created = new Date(m.created_at)
      return created >= from && created <= to
    })
    const counts = { positive: 0, neutral: 0, negative: 0 }
    for (const m of inRange) counts[classifySentiment(m.content)]++
    return { ...counts, total: inRange.length }
  }, [contactMessages, dateFrom, dateTo])

  const byChannel = ['whatsapp', 'instagram', 'facebook', 'sms'] as const
  const byStatus = Object.keys(statusConfig) as (keyof typeof statusConfig)[]
  const byTeam = Array.from(new Set(filtered.map((c) => c.team).filter(Boolean)))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3 rounded-sm border border-panel-light bg-panel p-3">
        <div>
          <label className="mb-1 block text-xs text-muted">Desde</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-sm border border-panel-light bg-asphalt px-2 py-1.5 text-sm text-cream outline-none focus:border-mustard"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">Hasta</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-sm border border-panel-light bg-asphalt px-2 py-1.5 text-sm text-cream outline-none focus:border-mustard"
          />
        </div>
        <span className="pb-1.5 text-xs text-muted">{total} conversaciones en este rango</span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Panel title="Por canal">
          {byChannel.map((ch) => (
            <Bar
              key={ch}
              label={ch}
              count={filtered.filter((c) => c.channel === ch).length}
              total={total}
              color="bg-mustard"
            />
          ))}
        </Panel>

        <Panel title="Por estado">
          {byStatus.map((st) => (
            <Bar
              key={st}
              label={`${statusConfig[st].emoji} ${statusConfig[st].label}`}
              count={filtered.filter((c) => c.status === st).length}
              total={total}
              color="bg-info"
            />
          ))}
        </Panel>

        <Panel title="Por equipo">
          {byTeam.length === 0 && <p className="text-xs text-muted">Sin datos en este rango.</p>}
          {byTeam.map((team) => (
            <Bar
              key={team}
              label={team as string}
              count={filtered.filter((c) => c.team === team).length}
              total={total}
              color="bg-available"
            />
          ))}
        </Panel>

        <Panel title="Sentimiento (por palabras clave)">
          {sentimentCounts.total === 0 && <p className="text-xs text-muted">Sin mensajes de clientes en este rango.</p>}
          {sentimentCounts.total > 0 && (
            <>
              <Bar
                label="😊 Positivo"
                count={sentimentCounts.positive}
                total={sentimentCounts.total}
                color="bg-available"
              />
              <Bar
                label="😐 Neutral"
                count={sentimentCounts.neutral}
                total={sentimentCounts.total}
                color="bg-muted"
              />
              <Bar
                label="😠 Negativo"
                count={sentimentCounts.negative}
                total={sentimentCounts.total}
                color="bg-alert"
              />
              <p className="mt-2 text-[10px] text-muted">
                Estimado por palabras clave, no por un modelo de lenguaje real — sirve como idea general.
              </p>
            </>
          )}
        </Panel>

        <Panel title="Resumen">
          <div className="flex items-center justify-between border-b border-panel-light/60 py-2">
            <span className="text-sm text-muted">Total conversaciones</span>
            <span className="font-mono text-sm text-cream">{total}</span>
          </div>
          <div className="flex items-center justify-between border-b border-panel-light/60 py-2">
            <span className="text-sm text-muted">Sin leer</span>
            <span className="font-mono text-sm text-alert">{filtered.filter((c) => c.unread).length}</span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-muted">Clientes VIP</span>
            <span className="font-mono text-sm text-mustard">{filtered.filter((c) => c.vip).length}</span>
          </div>
        </Panel>
      </div>
    </div>
  )
}
