import { useState } from 'react'
import {
  Users,
  Phone,
  AlarmClock,
  UserCheck,
  CircleDashed,
  Clock3,
  ChevronsLeft,
  ChevronsRight,
  History,
} from 'lucide-react'
import type { Conversation, Channel } from './ConversationsView'

export type FilterValue =
  | { kind: 'all'; channel?: Channel }
  | { kind: 'new'; channel?: Channel }
  | { kind: 'pending'; channel?: Channel }
  | { kind: 'mine'; channel?: Channel }
  | { kind: 'unassigned'; channel?: Channel }
  | { kind: 'snoozed'; channel?: Channel }
  | { kind: 'my_history'; channel?: Channel }

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
  totalConversationsCount: number
  onSelectContacts: () => void
  onSelectTeamChat: (team: string) => void
  onSelectMissedCalls: () => void
}

function GroupHeader({ label }: { label: string }) {
  return <p className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
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
  totalConversationsCount,
  onSelectContacts,
  onSelectTeamChat,
  onSelectMissedCalls,
}: Props) {
  const newCount = conversations.filter((c) => c.unread).length
  const pendingCount = conversations.filter((c) => !c.unread && pendingStatuses.includes(c.status)).length
  const mineCount = conversations.filter(
    (c) => c.assignedOperatorId === operatorId && (c.unread || c.status !== 'cerrada'),
  ).length
  const unassignedCount = conversations.filter((c) => c.assignedOperatorId === null).length
  const snoozedCount = conversations.filter(
    (c) => c.snoozedUntil && new Date(c.snoozedUntil).getTime() > Date.now(),
  ).length

  function itemClass(active: boolean) {
    return `flex w-full items-center justify-between gap-2 rounded-md px-3 py-2.5 text-left text-sm transition-colors ${
      active ? 'bg-asphalt font-semibold text-cream' : 'text-cream hover:bg-panel-light'
    }`
  }

  function CountText({ n, active, alwaysColor }: { n: number; active: boolean; alwaysColor?: boolean }) {
    if (n === 0) return null
    return (
      <span
        className={`rounded-full px-2 py-0.5 font-mono text-xs ${
          active || alwaysColor ? 'bg-mustard font-bold text-asphalt' : 'text-muted'
        }`}
      >
        {n}
      </span>
    )
  }

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === 'true')

  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v
      localStorage.setItem('sidebarCollapsed', String(next))
      return next
    })
  }

  if (collapsed) {
    return (
      <aside className="flex w-12 shrink-0 flex-col items-center border-r border-panel-light bg-panel py-4">
        <button
          onClick={toggleCollapsed}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-panel-light hover:text-mustard"
          title="Expandir el menú"
        >
          <ChevronsRight size={16} />
        </button>
      </aside>
    )
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-5 overflow-y-auto border-r border-panel-light bg-panel px-3 py-4">
      <button
        onClick={toggleCollapsed}
        className="mb-1 flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-xs text-muted hover:bg-panel-light hover:text-mustard"
        title="Contraer el menú"
      >
        <ChevronsLeft size={14} /> Contraer
      </button>
      <div>
        <GroupHeader label="Bandejas" />

        {/* Selector de dos posiciones: reemplaza al viejo botón único
            "Todos los mensajes" — mismo filtro de siempre (new/all), solo
            presentado como slider. */}
        <div className="mb-2 flex rounded-md bg-asphalt p-0.5">
          <button
            onClick={() => onSelectFilter({ kind: 'new' })}
            className={`flex-1 rounded-sm py-1.5 text-xs font-medium transition-colors ${
              view === 'inbox' && filter.kind === 'new' ? 'bg-mustard text-asphalt' : 'text-muted hover:text-cream'
            }`}
          >
            Sin leer{newCount > 0 ? ` (${newCount})` : ''}
          </button>
          <button
            onClick={() => onSelectFilter({ kind: 'all' })}
            className={`flex-1 rounded-sm py-1.5 text-xs font-medium transition-colors ${
              view === 'inbox' && filter.kind === 'all' ? 'bg-mustard text-asphalt' : 'text-muted hover:text-cream'
            }`}
          >
            Todos ({totalConversationsCount})
          </button>
        </div>

        <button onClick={() => onSelectFilter({ kind: 'mine' })} className={itemClass(view === 'inbox' && filter.kind === 'mine')}>
          <span className="flex items-center gap-2">
            <UserCheck size={15} /> Mías · round robin
          </span>
          <CountText n={mineCount} active={view === 'inbox' && filter.kind === 'mine'} alwaysColor />
        </button>
        <button
          onClick={() => onSelectFilter({ kind: 'unassigned' })}
          className={itemClass(view === 'inbox' && filter.kind === 'unassigned')}
        >
          <span className="flex items-center gap-2">
            <CircleDashed size={15} /> Sin asignar
          </span>
          <CountText n={unassignedCount} active={view === 'inbox' && filter.kind === 'unassigned'} alwaysColor />
        </button>
        <button onClick={() => onSelectFilter({ kind: 'pending' })} className={itemClass(view === 'inbox' && filter.kind === 'pending')}>
          <span className="flex items-center gap-2">
            <Clock3 size={15} /> Pendientes
          </span>
          <CountText n={pendingCount} active={view === 'inbox' && filter.kind === 'pending'} />
        </button>
        <button
          onClick={() => onSelectFilter({ kind: 'my_history' })}
          className={itemClass(view === 'inbox' && filter.kind === 'my_history')}
        >
          <span className="flex items-center gap-2">
            <History size={15} /> Mis respuestas
          </span>
        </button>
      </div>

      <div>
        <GroupHeader label="Mis equipos" />
        {teams
          .filter((team) => team !== 'Managers' || isAdmin)
          .map((team) => {
            const active = view === 'internal' && internalChannel === team
            return (
              <button key={team} onClick={() => onSelectTeamChat(team)} className={itemClass(active)}>
                <span className="flex items-center gap-2">
                  <Users size={15} /> {team}
                </span>
              </button>
            )
          })}
      </div>

      {/* Utilidades: Pospuestas, Llamadas perdidas, Contactos */}
      <div className="mt-auto border-t border-panel-light pt-3">
        {isAdmin && (
          <button onClick={() => onSelectFilter({ kind: 'snoozed' })} className={itemClass(view === 'inbox' && filter.kind === 'snoozed')}>
            <span className={`flex items-center gap-2 ${view === 'inbox' && filter.kind === 'snoozed' ? '' : 'text-mustard'}`}>
              <AlarmClock size={15} /> Pospuestas
            </span>
            <CountText n={snoozedCount} active={view === 'inbox' && filter.kind === 'snoozed'} />
          </button>
        )}
        <button onClick={onSelectMissedCalls} className={itemClass(view === 'missed-calls')}>
          <span className={`flex items-center gap-2 ${view !== 'missed-calls' ? 'text-mustard' : ''}`}>
            <Phone size={15} /> Llamadas perdidas
          </span>
          <CountText n={missedCallsCount} active={view === 'missed-calls'} alwaysColor />
        </button>
        <button onClick={onSelectContacts} className={itemClass(view === 'contacts')}>
          <span className="flex items-center gap-2">
            <Users size={15} /> Contactos
          </span>
        </button>
      </div>
    </aside>
  )
}
