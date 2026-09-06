import { useEffect, useState } from 'react'
import { AlertTriangle, Users } from 'lucide-react'
import { supabase } from './supabaseClient'

type OperatorRow = {
  id: string
  full_name: string
  presence: string
  current_load: number
  max_capacity: number | null
  last_assigned_at: string | null
}

type QueueMemberRow = { operator_id: string; queues: { name: string } | null }

export default function RoundRobinSection() {
  const [operators, setOperators] = useState<OperatorRow[]>([])
  const [queuesByOperator, setQueuesByOperator] = useState<Record<string, string[]>>({})
  const [unassignedCount, setUnassignedCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)

    const [{ data: ops }, { data: members }, { count }] = await Promise.all([
      supabase
        .from('operators')
        .select('id, full_name, presence, current_load, max_capacity, last_assigned_at')
        .order('full_name'),
      supabase.from('queue_members').select('operator_id, queues ( name )'),
      supabase
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .is('assigned_operator_id', null)
        .neq('status', 'cerrada'),
    ])

    setOperators(ops ?? [])
    setUnassignedCount(count ?? 0)

    const grouped: Record<string, string[]> = {}
    for (const m of (members ?? []) as unknown as QueueMemberRow[]) {
      if (!m.queues?.name) continue
      grouped[m.operator_id] = [...(grouped[m.operator_id] ?? []), m.queues.name.replace('_general', '')]
    }
    setQueuesByOperator(grouped)

    setLoading(false)
  }

  const availableCount = operators.filter((o) => o.presence === 'available').length

  if (loading) return <p className="text-sm text-muted">Cargando...</p>

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-sm border border-panel-light bg-panel p-4 text-center">
          <p className="font-mono text-2xl text-mustard">{availableCount}</p>
          <p className="mt-1 text-xs text-muted">Operadores disponibles</p>
        </div>
        <div className="rounded-sm border border-panel-light bg-panel p-4 text-center">
          <p className="font-mono text-2xl text-cream">{operators.length}</p>
          <p className="mt-1 text-xs text-muted">Operadores totales</p>
        </div>
        <div
          className={`rounded-sm border p-4 text-center ${
            unassignedCount > 0 ? 'border-alert/40 bg-alert/10' : 'border-panel-light bg-panel'
          }`}
        >
          <p className={`font-mono text-2xl ${unassignedCount > 0 ? 'text-alert' : 'text-cream'}`}>
            {unassignedCount}
          </p>
          <p className="mt-1 text-xs text-muted">Sin asignar ahora mismo</p>
        </div>
      </div>

      {unassignedCount > 0 && availableCount === 0 && (
        <div className="flex items-start gap-2.5 rounded-sm border border-alert/40 bg-alert/10 px-3.5 py-3 text-sm text-alert">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <span>
            Hay {unassignedCount} conversaciones sin asignar y <strong>nadie está disponible</strong> —
            van a quedar esperando hasta que alguien se marque como disponible.
          </span>
        </div>
      )}

      <div className="overflow-x-auto rounded-sm border border-panel-light">
        <table className="w-full text-sm">
          <thead className="bg-panel text-xs text-muted">
            <tr>
              <th className="px-4 py-2.5 text-left">Operador</th>
              <th className="px-4 py-2.5 text-left">Presencia</th>
              <th className="px-4 py-2.5 text-left">Carga actual</th>
              <th className="px-4 py-2.5 text-left">Colas</th>
              <th className="px-4 py-2.5 text-left">Última asignación</th>
            </tr>
          </thead>
          <tbody>
            {operators.map((op) => (
              <tr key={op.id} className="border-t border-panel-light">
                <td className="px-4 py-2.5 font-medium text-cream">{op.full_name}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${
                      op.presence === 'available'
                        ? 'border-available/40 text-available'
                        : 'border-panel-light text-muted'
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${op.presence === 'available' ? 'bg-available' : 'bg-muted'}`}
                    />
                    {op.presence === 'available' ? 'Disponible' : 'No disponible'}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <span className="rounded-full bg-mustard px-2.5 py-0.5 font-mono text-xs font-semibold text-asphalt">
                    {op.current_load}
                  </span>
                  {op.max_capacity != null && <span className="ml-1 text-xs text-muted">/ {op.max_capacity}</span>}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {(queuesByOperator[op.id] ?? []).map((q) => (
                      <span
                        key={q}
                        className="rounded-full border border-panel-light px-2 py-0.5 text-[11px] capitalize text-muted"
                      >
                        {q}
                      </span>
                    ))}
                    {!(queuesByOperator[op.id] ?? []).length && (
                      <span className="text-xs italic text-alert">Sin colas asignadas</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-xs text-muted">
                  {op.last_assigned_at
                    ? new Date(op.last_assigned_at).toLocaleString('es-AR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : 'Nunca'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted">
        <Users size={12} /> Un operador sin colas asignadas nunca va a recibir conversaciones nuevas por
        round robin, aunque esté disponible.
      </p>
    </div>
  )
}
