import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'

type Granularity = 'hour' | 'day' | 'week' | 'month'

type Row = {
  sender_type: string
  sender_operator_id: string | null
  sent_via_channel: string | null
  automation_type: string | null
  created_at: string
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

  useEffect(() => {
    setLoading(true)
    supabase
      .from('messages')
      .select('sender_type, sender_operator_id, sent_via_channel, automation_type, created_at')
      .gte('created_at', `${dateFrom}T00:00:00`)
      .lte('created_at', `${dateTo}T23:59:59`)
      .then(({ data }) => {
        setRows(data ?? [])
        setLoading(false)
      })
  }, [dateFrom, dateTo])

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
    const header = ['fecha', 'remitente', 'operador_id', 'canal', 'tipo_automatizacion']
    const lines = rows.map((r) =>
      [
        new Date(r.created_at).toISOString(),
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
