import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'

type Granularity = 'hour' | 'day' | 'week' | 'month'

type Row = {
  conversation_id: string
  sender_type: string
  sender_operator_id: string | null
  sent_via_channel: string | null
  automation_type: string | null
  created_at: string
}

type WaitingConversation = {
  id: string
  contactName: string | null
  phone: string | null
  lastContactMessageAt: string
  assignedOperatorId: string | null
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-sm border border-panel-light bg-panel p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
      {children}
    </div>
  )
}

function Bar({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0
  return (
    <div className="mb-2 last:mb-0">
      <div className="mb-0.5 flex items-center justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="font-mono text-cream">{count}</span>
      </div>
      <div className="h-1.5 w-full rounded-sm bg-asphalt">
        <div className="h-1.5 rounded-sm bg-mustard" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function toDateInputValue(d: Date) {
  return d.toISOString().slice(0, 10)
}

function getBucketKey(date: Date, granularity: Granularity): string {
  if (granularity === 'hour') {
    return String(date.getHours()).padStart(2, '0') + ':00'
  }
  if (granularity === 'day') {
    return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
  }
  if (granularity === 'week') {
    const firstDay = new Date(date)
    firstDay.setDate(date.getDate() - date.getDay())
    return `Semana del ${firstDay.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}`
  }
  // month
  return date.toLocaleDateString('es-AR', { month: 'short', year: 'numeric' })
}

function minutesLabel(minutes: number): string {
  if (minutes < 1) return '<1 min'
  if (minutes < 60) return `${Math.round(minutes)} min`
  const hours = minutes / 60
  if (hours < 24) return `${hours.toFixed(1)} h`
  return `${(hours / 24).toFixed(1)} d`
}

function elapsedSince(iso: string): string {
  const minutes = (Date.now() - new Date(iso).getTime()) / 60000
  return minutesLabel(minutes)
}

export default function MessageMetricsSection() {
  const [granularity, setGranularity] = useState<Granularity>('hour')
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return toDateInputValue(d)
  })
  const [dateTo, setDateTo] = useState(() => toDateInputValue(new Date()))
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [operators, setOperators] = useState<{ id: string; full_name: string }[]>([])
  const [waiting, setWaiting] = useState<WaitingConversation[]>([])
  const [waitingLoading, setWaitingLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('operators')
      .select('id, full_name')
      .then(({ data }) => setOperators(data ?? []))
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadAllRows() {
      setLoading(true)
      // Supabase (PostgREST) corta cada consulta en 1000 filas por
      // defecto — con volumen real, un rango de fechas amplio pisa ese
      // techo fácil. Pedimos de a 1000 con .range() hasta que la
      // página vuelva incompleta (esa es la señal de que ya no hay más).
      const pageSize = 1000
      let page = 0
      let all: Row[] = []

      while (true) {
        const { data, error } = await supabase
          .from('messages')
          .select('conversation_id, sender_type, sender_operator_id, sent_via_channel, automation_type, created_at')
          .gte('created_at', `${dateFrom}T00:00:00`)
          .lte('created_at', `${dateTo}T23:59:59`)
          .order('created_at', { ascending: true })
          .range(page * pageSize, page * pageSize + pageSize - 1)

        if (error || !data) break
        all = all.concat(data)
        if (data.length < pageSize) break // última página, no hace falta pedir más
        page++
      }

      if (!cancelled) {
        setRows(all)
        setLoading(false)
      }
    }

    loadAllRows()
    return () => {
      cancelled = true
    }
  }, [dateFrom, dateTo])

  async function loadWaiting() {
    setWaitingLoading(true)
    const { data } = await supabase
      .from('conversations')
      .select('id, last_contact_message_at, assigned_operator_id, contacts(full_name, phone)')
      .eq('unread', true)
      .eq('needs_assignment', true)
      .neq('status', 'cerrada')
      .not('last_contact_message_at', 'is', null)
      .order('last_contact_message_at', { ascending: true })
      .limit(20)

    setWaiting(
      (data ?? []).map((c: any) => ({
        id: c.id,
        contactName: c.contacts?.full_name ?? null,
        phone: c.contacts?.phone ?? null,
        lastContactMessageAt: c.last_contact_message_at,
        assignedOperatorId: c.assigned_operator_id,
      })),
    )
    setWaitingLoading(false)
  }

  useEffect(() => {
    loadWaiting()
    const interval = setInterval(loadWaiting, 60_000) // se refresca solo cada minuto
    return () => clearInterval(interval)
  }, [])

  function operatorName(id: string | null): string {
    if (!id) return 'Sin asignar'
    return operators.find((o) => o.id === id)?.full_name ?? 'Operador'
  }

  const totals = useMemo(() => {
    const t = {
      smsSent: 0,
      smsReceived: 0,
      autoWait: 0,
      autoCancelled: 0,
      autoFinished: 0,
      autoOther: 0,
      waSent: 0,
      waReceived: 0,
    }
    for (const m of rows) {
      const ch = m.sent_via_channel
      if (ch === 'sms') {
        if (m.sender_type === 'contact') t.smsReceived++
        else if (!m.sender_operator_id) {
          if (m.automation_type === 'wait') t.autoWait++
          else if (m.automation_type === 'cancelled') t.autoCancelled++
          else if (m.automation_type === 'finished') t.autoFinished++
          else t.autoOther++
        } else t.smsSent++
      } else if (ch === 'whatsapp') {
        if (m.sender_type === 'contact') t.waReceived++
        else t.waSent++
      }
    }
    return t
  }, [rows])

  const responseTimes = useMemo(() => {
    const byConversation = new Map<string, Row[]>()
    for (const m of rows) {
      if (!byConversation.has(m.conversation_id)) byConversation.set(m.conversation_id, [])
      byConversation.get(m.conversation_id)!.push(m)
    }

    const results: { minutes: number; operatorId: string | null; hour: number }[] = []

    for (const msgs of byConversation.values()) {
      const sorted = [...msgs].sort((a, b) => a.created_at.localeCompare(b.created_at))
      let pendingContactMsg: Row | null = null

      for (const m of sorted) {
        if (m.sender_type === 'contact') {
          pendingContactMsg = m // el mensaje del cliente más reciente todavía sin responder
        } else if (m.sender_type === 'operator' && m.automation_type == null && pendingContactMsg) {
          // Una respuesta real de un humano — los mensajes automáticos
          // (automation_type seteado) no cuentan como respuesta ni
          // "consumen" el mensaje pendiente del cliente.
          const minutes = (new Date(m.created_at).getTime() - new Date(pendingContactMsg.created_at).getTime()) / 60000
          if (minutes >= 0 && minutes < 24 * 60) {
            // Se descartan los que tardaron más de un día — mueven el
            // promedio sin representar una demora real de atención
            // (ej: conversación vieja que se reabrió mucho después).
            results.push({ minutes, operatorId: m.sender_operator_id, hour: new Date(pendingContactMsg.created_at).getHours() })
          }
          pendingContactMsg = null
        }
      }
    }
    return results
  }, [rows])

  const responseTimeStats = useMemo(() => {
    if (responseTimes.length === 0) return null
    const sortedMinutes = responseTimes.map((r) => r.minutes).sort((a, b) => a - b)
    const avg = sortedMinutes.reduce((a, b) => a + b, 0) / sortedMinutes.length
    const median = sortedMinutes[Math.floor(sortedMinutes.length / 2)]

    const byOperator = new Map<string, number[]>()
    for (const r of responseTimes) {
      const key = r.operatorId ?? 'sin_operador'
      if (!byOperator.has(key)) byOperator.set(key, [])
      byOperator.get(key)!.push(r.minutes)
    }
    const perOperator = Array.from(byOperator.entries())
      .map(([id, mins]) => ({
        id,
        name: id === 'sin_operador' ? 'Sin operador (automático)' : operatorName(id),
        avg: mins.reduce((a, b) => a + b, 0) / mins.length,
        count: mins.length,
      }))
      .sort((a, b) => a.avg - b.avg)

    const byHour = new Map<number, number[]>()
    for (const r of responseTimes) {
      if (!byHour.has(r.hour)) byHour.set(r.hour, [])
      byHour.get(r.hour)!.push(r.minutes)
    }
    const perHour = Array.from(byHour.entries())
      .map(([hour, mins]) => ({ hour, avg: mins.reduce((a, b) => a + b, 0) / mins.length }))
      .sort((a, b) => a.hour - b.hour)

    return { avg, median, perOperator, perHour, count: sortedMinutes.length }
  }, [responseTimes, operators])

  const buckets = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of rows) {
      const key = getBucketKey(new Date(m.created_at), granularity)
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    let entries = Array.from(map.entries())
    if (granularity === 'hour') {
      // Ordenado por hora del día (0-23), no por cuándo aparece primero
      entries = entries.sort((a, b) => a[0].localeCompare(b[0]))
    } else {
      // El resto, más reciente primero, tope de 20 para que no sea eterno
      entries = entries.reverse().slice(0, 20)
    }
    return entries
  }, [rows, granularity])

  const maxBucket = Math.max(1, ...buckets.map(([, c]) => c))

  function exportCsv() {
    const header = ['fecha', 'conversation_id', 'remitente', 'operador_id', 'canal', 'tipo_automatizacion']
    const lines = rows.map((r) =>
      [
        new Date(r.created_at).toISOString(),
        r.conversation_id,
        r.sender_type,
        r.sender_operator_id ?? '',
        r.sent_via_channel ?? '',
        r.automation_type ?? '',
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    )
    const csv = [header.join(','), ...lines].join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `mensajes_${dateFrom}_a_${dateTo}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Esperando respuesta ahora mismo">
        {waitingLoading ? (
          <p className="text-xs text-muted">Cargando...</p>
        ) : waiting.length === 0 ? (
          <p className="text-xs text-available">Nada esperando respuesta en este momento. 🎉</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {waiting.map((w) => {
              const minutesWaiting = (Date.now() - new Date(w.lastContactMessageAt).getTime()) / 60000
              const isUrgent = minutesWaiting > 15
              return (
                <div
                  key={w.id}
                  className={`flex items-center justify-between rounded-sm border px-3 py-2 text-xs ${
                    isUrgent ? 'border-alert/40 bg-alert/10' : 'border-panel-light bg-asphalt'
                  }`}
                >
                  <span className="text-cream">{w.contactName || w.phone || 'Contacto'}</span>
                  <span className="text-muted">{operatorName(w.assignedOperatorId)}</span>
                  <span className={`font-mono ${isUrgent ? 'text-alert' : 'text-muted'}`}>
                    hace {elapsedSince(w.lastContactMessageAt)}
                  </span>
                </div>
              )
            })}
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted">Se actualiza solo cada 1 minuto. En rojo, más de 15 min esperando.</p>
      </Panel>

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
        <span className="pb-1.5 text-xs text-muted">{rows.length} mensajes en este rango</span>
        <button
          onClick={exportCsv}
          disabled={rows.length === 0}
          className="ml-auto rounded-sm border border-panel-light px-3 py-1.5 text-xs text-muted hover:border-mustard hover:text-mustard disabled:opacity-40"
        >
          Exportar CSV
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: 'SMS enviados (manual)', value: totals.smsSent },
          { label: 'SMS recibidos', value: totals.smsReceived },
          { label: 'WhatsApp enviados', value: totals.waSent },
          { label: 'WhatsApp recibidos', value: totals.waReceived },
        ].map((t) => (
          <div key={t.label} className="rounded-sm border border-panel-light bg-panel p-3 text-center">
            <p className="font-mono text-xl text-mustard">{t.value}</p>
            <p className="mt-1 text-[11px] text-muted">{t.label}</p>
          </div>
        ))}
      </div>

      <Panel title="Mensajes automáticos, por tipo">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: '🚕 "Su taxi está afuera"', value: totals.autoWait },
            { label: '❌ "Servicio cancelado"', value: totals.autoCancelled },
            { label: '🏁 "Servicio terminado"', value: totals.autoFinished },
            ...(totals.autoOther > 0 ? [{ label: 'Otros automáticos', value: totals.autoOther }] : []),
          ].map((t) => (
            <div key={t.label} className="rounded-sm border border-panel-light bg-asphalt p-3 text-center">
              <p className="font-mono text-xl text-warning">{t.value}</p>
              <p className="mt-1 text-[11px] text-muted">{t.label}</p>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Tiempo de primera respuesta">
        {!responseTimeStats ? (
          <p className="text-xs text-muted">
            Sin datos suficientes en este rango (hace falta al menos un mensaje del cliente seguido de una
            respuesta manual de un operador).
          </p>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div className="rounded-sm border border-panel-light bg-asphalt p-3 text-center">
                <p className="font-mono text-xl text-mustard">{minutesLabel(responseTimeStats.avg)}</p>
                <p className="mt-1 text-[11px] text-muted">Promedio</p>
              </div>
              <div className="rounded-sm border border-panel-light bg-asphalt p-3 text-center">
                <p className="font-mono text-xl text-mustard">{minutesLabel(responseTimeStats.median)}</p>
                <p className="mt-1 text-[11px] text-muted">Mediana</p>
              </div>
              <div className="rounded-sm border border-panel-light bg-asphalt p-3 text-center">
                <p className="font-mono text-xl text-cream">{responseTimeStats.count}</p>
                <p className="mt-1 text-[11px] text-muted">Respuestas medidas</p>
              </div>
            </div>

            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Por operador</p>
            <div className="mb-4 flex flex-col gap-1.5">
              {responseTimeStats.perOperator.map((op) => (
                <div key={op.id} className="flex items-center justify-between text-xs">
                  <span className="text-cream">{op.name}</span>
                  <span className="font-mono text-muted">
                    {minutesLabel(op.avg)} <span className="text-[10px]">({op.count})</span>
                  </span>
                </div>
              ))}
            </div>

            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
              Por hora del día (cuándo escribió el cliente)
            </p>
            <div className="flex flex-col gap-1">
              {responseTimeStats.perHour.map((h) => (
                <Bar
                  key={h.hour}
                  label={`${String(h.hour).padStart(2, '0')}:00`}
                  count={Math.round(h.avg)}
                  max={Math.max(1, ...responseTimeStats.perHour.map((x) => x.avg))}
                />
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted">
              Las barras muestran minutos promedio de demora (no cantidad de mensajes) — por hora en que
              escribió el cliente.
            </p>
          </>
        )}
      </Panel>

      <Panel title="Volumen de mensajes">
        <div className="mb-3 flex gap-1.5">
          {(['hour', 'day', 'week', 'month'] as Granularity[]).map((g) => (
            <button
              key={g}
              onClick={() => setGranularity(g)}
              className={`rounded-sm border px-2.5 py-1 text-xs transition-colors ${
                granularity === g
                  ? 'border-mustard bg-mustard/10 text-mustard'
                  : 'border-panel-light text-muted hover:text-cream'
              }`}
            >
              {g === 'hour' && 'Por hora del día'}
              {g === 'day' && 'Por día'}
              {g === 'week' && 'Por semana'}
              {g === 'month' && 'Por mes'}
            </button>
          ))}
        </div>

        {loading && <p className="text-xs text-muted">Cargando...</p>}
        {!loading && buckets.length === 0 && <p className="text-xs text-muted">Sin mensajes en este rango.</p>}
        {!loading &&
          buckets.map(([key, count]) => <Bar key={key} label={key} count={count} max={maxBucket} />)}

        {granularity === 'hour' && !loading && buckets.length > 0 && (
          <p className="mt-3 text-[11px] text-muted">
            Suma todos los días del rango elegido en cada franja horaria — así se ve qué hora del día es
            la más movida, más allá de un día puntual.
          </p>
        )}
      </Panel>
    </div>
  )
}
