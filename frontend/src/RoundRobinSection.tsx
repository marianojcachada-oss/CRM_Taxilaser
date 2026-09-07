import { useEffect, useState } from 'react'
import { AlertTriangle, Users, Plus, X } from 'lucide-react'
import { supabase } from './supabaseClient'

type OperatorRow = {
  id: string
  full_name: string
  presence: string
  current_load: number
  max_capacity: number | null
  last_assigned_at: string | null
}

type Queue = { id: string; name: string }

export default function RoundRobinSection() {
  const [operators, setOperators] = useState<OperatorRow[]>([])
  const [allQueues, setAllQueues] = useState<Queue[]>([])
  const [membership, setMembership] = useState<Record<string, string[]>>({})
  const [unassignedCount, setUnassignedCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [openPopoverFor, setOpenPopoverFor] = useState<string | null>(null)
  const [togglingKey, setTogglingKey] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)

    const [{ data: ops }, { data: queues }, { data: members }, { count }] = await Promise.all([
      supabase
        .from('operators')
        .select('id, full_name, presence, current_load, max_capacity, last_assigned_at')
        .order('full_name'),
      supabase.from('queues').select('id, name').order('name'),
      supabase.from('queue_members').select('operator_id, queue_id'),
      supabase
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .is('assigned_operator_id', null)
        .neq('status', 'cerrada'),
    ])

    setOperators(ops ?? [])
    setAllQueues(queues ?? [])
    setUnassignedCount(count ?? 0)

    const grouped: Record<string, string[]> = {}
    for (const m of members ?? []) {
      grouped[m.operator_id] = [...(grouped[m.operator_id] ?? []), m.queue_id]
    }
    setMembership(grouped)

    setLoading(false)
  }

  async function toggleMembership(operatorId: string, queueId: string, isMember: boolean) {
    const key = `${operatorId}:${queueId}`
    setTogglingKey(key)

    if (isMember) {
      setMembership((prev) => ({ ...prev, [operatorId]: (prev[operatorId] ?? []).filter((q) => q !== queueId) }))
      const { error } = await supabase
        .from('queue_members')
        .delete()
        .eq('operator_id', operatorId)
        .eq('queue_id', queueId)
      if (error) alert('No se pudo sacar de la cola: ' + error.message)
    } else {
      setMembership((prev) => ({ ...prev, [operatorId]: [...(prev[operatorId] ?? []), queueId] }))
      const { error } = await supabase.from('queue_members').insert({ operator_id: operatorId, queue_id: queueId })
      if (error) alert('No se pudo agregar a la cola: ' + error.message)
    }

    setTogglingKey(null)
  }

  const availableCount = operators.filter((o) => o.presence === 'available').length

  if (loading) return <p className="text-sm text-muted">Cargando...</p>

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
              <th className="px-4 py-2.5 text-left">Colas (round robin)</th>
              <th className="px-4 py-2.5 text-left">Última asignación</th>
            </tr>
          </thead>
          <tbody>
            {operators.map((op) => {
              const myQueueIds = membership[op.id] ?? []
              const notJoined = allQueues.filter((q) => !myQueueIds.includes(q.id))

              return (
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
                  <td className="relative px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-1">
                      {myQueueIds.length === 0 && (
                        <span className="text-xs italic text-alert">Sin colas asignadas</span>
                      )}
                      {myQueueIds.map((qid) => {
                        const q = allQueues.find((x) => x.id === qid)
                        if (!q) return null
                        return (
                          <span
                            key={qid}
                            className="flex items-center gap-1 rounded-full border border-panel-light px-2 py-0.5 text-[11px] capitalize text-muted"
                          >
                            {q.name.replace('_general', '')}
                            <button
                              onClick={() => toggleMembership(op.id, qid, true)}
                              disabled={togglingKey === `${op.id}:${qid}`}
                              className="text-muted hover:text-alert disabled:opacity-40"
                              title="Sacar de esta cola"
                            >
                              <X size={10} />
                            </button>
                          </span>
                        )
                      })}
                      {notJoined.length > 0 && (
                        <button
                          onClick={() => setOpenPopoverFor(openPopoverFor === op.id ? null : op.id)}
                          className="flex h-5 w-5 items-center justify-center rounded-full border border-panel-light text-muted hover:border-mustard hover:text-mustard"
                          title="Agregar a una cola (esto lo mete en el round robin)"
                        >
                          <Plus size={11} />
                        </button>
                      )}
                    </div>

                    {openPopoverFor === op.id && (
                      <div className="absolute left-4 top-full z-10 mt-1 flex flex-col gap-1 rounded-sm border border-panel-light bg-panel p-2 shadow-lg">
                        {notJoined.map((q) => (
                          <button
                            key={q.id}
                            onClick={() => {
                              toggleMembership(op.id, q.id, false)
                              setOpenPopoverFor(null)
                            }}
                            className="whitespace-nowrap rounded-sm px-2 py-1 text-left text-xs capitalize text-cream hover:bg-panel-light"
                          >
                            + {q.name.replace('_general', '')}
                          </button>
                        ))}
                      </div>
                    )}
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
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted">
        <Users size={12} /> Agregar a un operador a una cola acá es exactamente lo mismo que meterlo al
        round robin de ese canal — deja de estar "sin colas" y empieza a poder recibir conversaciones
        nuevas ni bien se marque disponible.
      </p>
    </div>
  )
}
