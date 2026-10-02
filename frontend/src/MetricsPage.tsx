import { useEffect, useState } from 'react'
import { ArrowLeft, BarChart3, Loader2 } from 'lucide-react'
import { supabase } from './supabaseClient'
import Logo from './Logo'

type Operator = { id: string; full_name: string; operator_code: string | null }

type OperatorRow = {
  operator_id: string
  hour_bucket: string
  messages_whatsapp: number
  messages_ringcentral: number
  calls_answered: number
}

type ServiceRow = {
  hour_bucket: string
  services_completed: number
  services_cancelled: number
}

type Props = {
  operatorName: string
  onSignOut: () => void
  // Vuelve a la bandeja normal — solo tiene sentido ofrecerlo si esta
  // misma cuenta también es operador de mensajería (lo decide App.tsx).
  onBackToInbox?: () => void
}

// Ordena por el número del código (D5 antes que D12) — mismo criterio
// que en Equipo, para que la tabla salga en un orden que tenga sentido.
function byOperatorCode(a: Operator, b: Operator) {
  const numA = a.operator_code ? parseInt(a.operator_code.replace(/\D/g, ''), 10) : NaN
  const numB = b.operator_code ? parseInt(b.operator_code.replace(/\D/g, ''), 10) : NaN
  if (isNaN(numA) && isNaN(numB)) return a.full_name.localeCompare(b.full_name)
  if (isNaN(numA)) return 1
  if (isNaN(numB)) return -1
  return numA - numB
}

function todayLocalISO(): string {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 10)
}

export default function MetricsPage({ operatorName, onSignOut, onBackToInbox }: Props) {
  const [date, setDate] = useState(todayLocalISO())
  const [operators, setOperators] = useState<Operator[]>([])
  const [selectedOperatorId, setSelectedOperatorId] = useState<string>('all')
  const [operatorRows, setOperatorRows] = useState<OperatorRow[]>([])
  const [serviceRows, setServiceRows] = useState<ServiceRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('operators')
      .select('id, full_name, operator_code')
      .then(({ data }) => setOperators((data ?? []).slice().sort(byOperatorCode)))
  }, [])

  useEffect(() => {
    // OJO: el día se corta según la hora local del navegador, no la
    // zona horaria de Atlanta — para el primer corte alcanza, pero si
    // en algún momento se usa desde otro huso y los números no
    // cierran con lo esperado, es lo primero que hay que mirar.
    setLoading(true)
    const start = new Date(`${date}T00:00:00`)
    const end = new Date(`${date}T00:00:00`)
    end.setDate(end.getDate() + 1)

    Promise.all([
      supabase
        .from('hourly_operator_metrics')
        .select('operator_id, hour_bucket, messages_whatsapp, messages_ringcentral, calls_answered')
        .gte('hour_bucket', start.toISOString())
        .lt('hour_bucket', end.toISOString()),
      supabase
        .from('hourly_service_metrics')
        .select('hour_bucket, services_completed, services_cancelled')
        .gte('hour_bucket', start.toISOString())
        .lt('hour_bucket', end.toISOString()),
    ]).then(([op, svc]) => {
      setOperatorRows(op.data ?? [])
      setServiceRows(svc.data ?? [])
      setLoading(false)
    })
  }, [date])

  const serviceTotals = serviceRows.reduce(
    (acc, r) => ({
      completed: acc.completed + r.services_completed,
      cancelled: acc.cancelled + r.services_cancelled,
    }),
    { completed: 0, cancelled: 0 },
  )

  // Vista "Todos los operadores": un total por operador para el día.
  const totalsByOperator = operators.map((op) => {
    const rows = operatorRows.filter((r) => r.operator_id === op.id)
    return {
      operator: op,
      whatsapp: rows.reduce((s, r) => s + r.messages_whatsapp, 0),
      ringcentral: rows.reduce((s, r) => s + r.messages_ringcentral, 0),
      calls: rows.reduce((s, r) => s + r.calls_answered, 0),
    }
  })

  // Vista de un operador puntual: desglose por las 24 horas del día.
  const selectedOperator = operators.find((o) => o.id === selectedOperatorId)
  const hourRows = Array.from({ length: 24 }, (_, h) => {
    const hourIso = new Date(`${date}T${String(h).padStart(2, '0')}:00:00`).toISOString()
    const row = operatorRows.find(
      (r) => r.operator_id === selectedOperatorId && new Date(r.hour_bucket).toISOString() === hourIso,
    )
    return {
      hour: h,
      whatsapp: row?.messages_whatsapp ?? 0,
      ringcentral: row?.messages_ringcentral ?? 0,
      calls: row?.calls_answered ?? 0,
    }
  })

  return (
    <div className="flex min-h-screen flex-col bg-asphalt" style={{ '--color-mustard': 'var(--color-info)' } as React.CSSProperties}>
      <header className="flex items-center justify-between border-b border-panel-light bg-panel px-6 py-3">
        <div className="flex items-center gap-2.5">
          <Logo size={28} />
          <div>
            <p className="flex items-center gap-1.5 text-sm font-semibold text-cream">
              <BarChart3 size={14} className="text-mustard" /> Métricas
            </p>
            <p className="text-[11px] text-muted">{operatorName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onBackToInbox && (
            <button
              onClick={onBackToInbox}
              className="flex items-center gap-1.5 rounded-sm border border-panel-light px-2.5 py-1.5 text-xs text-cream hover:border-mustard hover:text-mustard"
            >
              <ArrowLeft size={13} /> Ir a Mensajería
            </button>
          )}
          <button
            onClick={onSignOut}
            className="rounded-sm border border-panel-light px-2.5 py-1.5 text-xs text-muted hover:text-alert"
          >
            Cerrar sesión
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-5 flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wide text-muted">Día</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-sm border border-panel-light bg-panel px-2.5 py-1.5 text-xs text-cream outline-none focus:border-mustard"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wide text-muted">Operador</label>
            <select
              value={selectedOperatorId}
              onChange={(e) => setSelectedOperatorId(e.target.value)}
              className="rounded-sm border border-panel-light bg-panel px-2.5 py-1.5 text-xs text-cream outline-none focus:border-mustard"
            >
              <option value="all">Todos los operadores</option>
              {operators.map((op) => (
                <option key={op.id} value={op.id}>
                  {op.operator_code ? `${op.operator_code} — ` : ''}
                  {op.full_name}
                </option>
              ))}
            </select>
          </div>
          {loading && <Loader2 size={15} className="mb-2 animate-spin text-muted" />}
        </div>

        {/* Servicios del día — global, no por operador (ver nota en el
            SQL de Fase 1: TaxiCaller todavía no nos dice quién creó
            cada servicio). */}
        <div className="mb-6 flex gap-4">
          <div className="rounded-sm border border-panel-light bg-panel px-4 py-3">
            <p className="text-[10px] uppercase tracking-wide text-muted">Servicios completados</p>
            <p className="font-mono text-xl text-cream">{serviceTotals.completed}</p>
          </div>
          <div className="rounded-sm border border-panel-light bg-panel px-4 py-3">
            <p className="text-[10px] uppercase tracking-wide text-muted">Servicios cancelados</p>
            <p className="font-mono text-xl text-cream">{serviceTotals.cancelled}</p>
          </div>
        </div>

        {selectedOperatorId === 'all' ? (
          <div className="overflow-x-auto rounded-sm border border-panel-light">
            <table className="w-full text-left text-xs">
              <thead className="bg-panel text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Operador</th>
                  <th className="px-4 py-2.5 font-medium">Mensajes WhatsApp</th>
                  <th className="px-4 py-2.5 font-medium">Mensajes RingCentral</th>
                  <th className="px-4 py-2.5 font-medium">Llamadas atendidas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-panel-light">
                {totalsByOperator.map(({ operator, whatsapp, ringcentral, calls }) => (
                  <tr key={operator.id} className="bg-asphalt">
                    <td className="px-4 py-2.5 font-mono text-cream">
                      {operator.operator_code ?? '—'} <span className="text-muted">{operator.full_name}</span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-cream">{whatsapp}</td>
                    <td className="px-4 py-2.5 font-mono text-cream">{ringcentral}</td>
                    <td className="px-4 py-2.5 font-mono text-cream">{calls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-sm border border-panel-light">
            <table className="w-full text-left text-xs">
              <thead className="bg-panel text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Hora</th>
                  <th className="px-4 py-2.5 font-medium">Mensajes WhatsApp</th>
                  <th className="px-4 py-2.5 font-medium">Mensajes RingCentral</th>
                  <th className="px-4 py-2.5 font-medium">Llamadas atendidas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-panel-light">
                {hourRows.map((r) => (
                  <tr key={r.hour} className="bg-asphalt">
                    <td className="px-4 py-2.5 font-mono text-cream">
                      {String(r.hour).padStart(2, '0')}:00
                    </td>
                    <td className="px-4 py-2.5 font-mono text-cream">{r.whatsapp}</td>
                    <td className="px-4 py-2.5 font-mono text-cream">{r.ringcentral}</td>
                    <td className="px-4 py-2.5 font-mono text-cream">{r.calls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {selectedOperator && (
              <p className="border-t border-panel-light px-4 py-2 text-[11px] text-muted">
                {selectedOperator.operator_code} — {selectedOperator.full_name}
              </p>
            )}
          </div>
        )}

        <p className="mt-4 text-[11px] text-muted">
          Esta tabla lee de datos ya calculados hora por hora — no consulta la base en vivo, así que
          no afecta el rendimiento del CRM operativo. "Llamadas atendidas" queda en 0 hasta que se
          termine de conectar la Analytics API de RingCentral.
        </p>
      </main>
    </div>
  )
}
