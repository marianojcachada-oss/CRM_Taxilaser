import { useState } from 'react'
import { Users, Phone, Clock, ChevronDown } from 'lucide-react'
import type { Conversation, Channel } from './ConversationsView'

export type FilterValue =
  | { kind: 'new' }
  | { kind: 'pending' }
  | { kind: 'mine' }
  | { kind: 'channel'; channel: Channel }
  | { kind: 'snoozed' }

const teams = ['Dispatchers', 'Managers']

const pendingStatuses = ['esperando_operador', 'esperando_informacion', 'reclamo']

type Props = {
  conversations: Conversation[]
  operatorId: string | null
  isAdmin: boolean
  filter: FilterValue
  onSelectFilter: (f: FilterValue) => void
  view: 'inbox' | 'contacts' | 'internal' | 'missed-calls'
  internalChannel: string | null
  missedCallsCount: number
  onSelectContacts: () => void
  onSelectTeamChat: (team: string) => void
  onSelectMissedCalls: () => void
}

function GroupHeader({
  label,
  open,
  onToggle,
}: {
  label: string
  open: boolean
  onToggle: () => void
}) {
  return (
    <button
      onClick={onToggle}
      className="mb-1.5 flex w-full items-center justify-between px-2 text-xs font-semibold uppercase tracking-wide text-muted hover:text-cream"
    >
      {label}
      <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
  )
}

export default function Sidebar({
  conversations,
  operatorId,
  isAdmin,
  filter,
  onSelectFilter,
  view,
  internalChannel,
  missedCallsCount,
  onSelectContacts,
  onSelectTeamChat,
  onSelectMissedCalls,
}: Props) {
  const [teamsOpen, setTeamsOpen] = useState(true)

  const newCount = conversations.filter((c) => c.unread).length
  const pendingCount = conversations.filter((c) => !c.unread && pendingStatuses.includes(c.status)).length
  const mineCount = conversations.filter(
    (c) => c.assignedOperatorId === operatorId && (c.unread || c.status !== 'cerrada'),
  ).length
  const snoozedCount = conversations.filter(
    (c) => c.snoozedUntil && new Date(c.snoozedUntil).getTime() > Date.now(),
  ).length

  function itemClass(active: boolean) {
    return `flex w-full items-center justify-between rounded-md border-l-2 px-3 py-2 text-left text-sm transition-colors ${
      active
        ? 'border-mustard bg-panel-light text-cream'
        : 'border-transparent text-muted hover:bg-panel-light/60 hover:text-cream'
    }`
  }

  function Badge({ n, active }: { n: number; active: boolean }) {
    return (
      <span
        className={`rounded-full px-2 py-0.5 font-mono text-[11px] ${
          active ? 'bg-mustard text-asphalt' : 'bg-panel-light text-muted'
        }`}
      >
        {n}
      </span>
    )
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col gap-5 overflow-y-auto border-r border-panel-light bg-panel px-3 py-4">
      {/* Inbox: siempre expandido, es lo que más se usa */}
      <div>
        <p className="mb-1.5 px-2 text-xs font-semibold uppercase tracking-wide text-muted">Inbox</p>
        <button
          onClick={() => onSelectFilter({ kind: 'new' })}
          className={itemClass(view === 'inbox' && filter.kind === 'new')}
        >
          <span>🔴 Nuevas</span>
          <Badge n={newCount} active={view === 'inbox' && filter.kind === 'new'} />
        </button>
        <button
          onClick={() => onSelectFilter({ kind: 'pending' })}
          className={itemClass(view === 'inbox' && filter.kind === 'pending')}
        >
          <span>🟡 Pendientes</span>
          <Badge n={pendingCount} active={view === 'inbox' && filter.kind === 'pending'} />
        </button>
        <button
          onClick={() => onSelectFilter({ kind: 'mine' })}
          className={itemClass(view === 'inbox' && filter.kind === 'mine')}
        >
          <span>🟢 Mías</span>
          <Badge n={mineCount} active={view === 'inbox' && filter.kind === 'mine'} />
        </button>
      </div>

      <div>
        <GroupHeader label="Mis equipos" open={teamsOpen} onToggle={() => setTeamsOpen((v) => !v)} />
        {teamsOpen &&
          teams.map((team) => {
            const active = view === 'internal' && internalChannel === team
            return (
              <button key={team} onClick={() => onSelectTeamChat(team)} className={itemClass(active)}>
                <span>💬 {team}</span>
              </button>
            )
          })}
      </div>

      {/* Utilidades: Contactos, Llamadas perdidas, y Pospuestas si sos admin */}
      <div className="mt-auto border-t border-panel-light pt-3">
        {isAdmin && (
          <button
            onClick={() => onSelectFilter({ kind: 'snoozed' })}
            className={itemClass(view === 'inbox' && filter.kind === 'snoozed')}
          >
            <span className="flex items-center gap-1.5">
              <Clock size={13} /> 😴 Pospuestas
            </span>
            {snoozedCount > 0 && <Badge n={snoozedCount} active={view === 'inbox' && filter.kind === 'snoozed'} />}
          </button>
        )}
        <button onClick={onSelectMissedCalls} className={itemClass(view === 'missed-calls')}>
          <span className="flex items-center gap-1.5">
            <Phone size={13} /> Llamadas perdidas
          </span>
          {missedCallsCount > 0 && (
            <span className="rounded-full bg-alert px-2 py-0.5 font-mono text-[11px] text-cream">
              {missedCallsCount}
            </span>
          )}
        </button>
        <button onClick={onSelectContacts} className={itemClass(view === 'contacts')}>
          <span className="flex items-center gap-1.5">
            <Users size={13} /> Contactos
          </span>
        </button>
      </div>
    </aside>
  )
}
