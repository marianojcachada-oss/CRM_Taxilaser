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
  Inbox as InboxIcon,
  List,
  HeartHandshake,
} from 'lucide-react'
import type { Conversation, Channel, Operator } from './ConversationsView'

export type FilterValue =
  | { kind: 'all'; channel?: Channel }
  | { kind: 'new'; channel?: Channel }
  | { kind: 'pending'; channel?: Channel }
  | { kind: 'mine'; channel?: Channel }
  // Conversaciones de OTROS operadores donde yo "apoyé" (respondí estando
  // en modo Apoyo) — se queda asignada al dueño de siempre, esto es solo
  // mi forma de volver a encontrarlas rápido.
  | { kind: 'support'; channel?: Channel }
  | { kind: 'unassigned'; channel?: Channel }
  | { kind: 'snoozed'; channel?: Channel }
  | { kind: 'my_history'; channel?: Channel }
  | { kind: 'operator'; operatorId: string; channel?: Channel }

// Ordena por el número del código (D5 antes que D12), no por texto.
function byOperatorCode(a: Operator, b: Operator) {
  const numA = a.operator_code ? parseInt(a.operator_code.replace(/\D/g, ''), 10) : NaN
  const numB = b.operator_code ? parseInt(b.operator_code.replace(/\D/g, ''), 10) : NaN
  if (isNaN(numA) && isNaN(numB)) return a.full_name.localeCompare(b.full_name)
  if (isNaN(numA)) return 1
  if (isNaN(numB)) return -1
  return numA - numB
}

const teams = ['Dispatchers', 'Managers']

const pendingStatuses = ['esperando_operador', 'esperando_informacion', 'reclamo']

type Props = {
  conversations: Conversation[]
  operators: Operator[]
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
  // Precalculado en Inbox.tsx (no se puede sacar de "conversations" +
  // operatorId solo, hace falta cruzar con conversation_support).
  supportCount: number
}

function GroupHeader({ label }: { label: string }) {
  return <p className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
}

export default function Sidebar({
  conversations,
  operators,
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
  supportCount,
}: Props) {
  const newCount = conversations.filter((c) => c.unread).length
  const pendingCount = conversations.filter((c) => !c.unread && pendingStatuses.includes(c.status)).length
  const mineCount = conversations.filter(
    (c) => c.assignedOperatorId === operatorId && (c.unread || c.status !== 'cerrada'),
  ).length
  // Tiene que ser EXACTAMENTE el mismo filtro que usa la pestaña "Sin
  // asignar" para mostrar la lista (en Inbox.tsx) — antes este número
  // solo miraba assignedOperatorId, sin needsAssignment, así que el
  // contador podía mostrar conversaciones que la lista de abajo no
  // mostraba (ej: cerradas sin asignar, que no "necesitan" asignación).
  const unassignedCount = conversations.filter((c) => c.assignedOperatorId === null && c.needsAssignment).length
  const snoozedCount = conversations.filter(
    (c) => c.snoozedUntil && new Date(c.snoozedUntil).getTime() > Date.now(),
  ).length

  // Para "ver la bandeja de otro operador" (si pide ayuda) solo tiene
  // sentido ofrecer a quien está disponible ahora mismo — a uno
  // desconectado no tiene caso ir a mirarle la cola.
  const availableOperators = operators
    .filter((o) => o.presence === 'available' && o.id !== operatorId)
    .slice()
    .sort(byOperatorCode)

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === 'true')

  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v
      localStorage.setItem('sidebarCollapsed', String(next))
      return next
    })
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

  // Un solo botón que sabe renderizarse de dos formas — completo (ícono +
  // texto + cuenta) o solo ícono cuando el sidebar está contraído. Así,
  // contraído sigue siendo 100% funcional para cambiar de pestaña, no
  // solo un adorno — con el nombre completo como tooltip al pasar el
  // mouse.
  function NavButton({
    icon,
    label,
    count,
    active,
    alwaysColor,
    onClick,
    mustardLabel,
  }: {
    icon: React.ReactNode
    label: string
    count?: number
    active: boolean
    alwaysColor?: boolean
    onClick: () => void
    mustardLabel?: boolean
  }) {
    if (collapsed) {
      return (
        <button
          onClick={onClick}
          title={label}
          className={`relative mx-auto flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
            active ? 'bg-asphalt text-mustard' : 'text-cream hover:bg-panel-light'
          }`}
        >
          {icon}
          {!!count && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-mustard px-1 font-mono text-[9px] font-bold text-asphalt">
              {count > 99 ? '99+' : count}
            </span>
          )}
        </button>
      )
    }

    return (
      <button
        onClick={onClick}
        className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2.5 text-left text-sm transition-colors ${
          active ? 'bg-asphalt font-semibold text-cream' : 'text-cream hover:bg-panel-light'
        }`}
      >
        <span className={`flex items-center gap-2 ${mustardLabel && !active ? 'text-mustard' : ''}`}>
          {icon} {label}
        </span>
        {count !== undefined && <CountText n={count} active={active} alwaysColor={alwaysColor} />}
      </button>
    )
  }

  if (collapsed) {
    return (
      <aside className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-panel-light bg-panel py-4">
        <button
          onClick={toggleCollapsed}
          className="mb-2 flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-panel-light hover:text-mustard"
          title="Expandir el menú"
        >
          <ChevronsRight size={16} />
        </button>

        <NavButton
          icon={<InboxIcon size={17} />}
          label="Sin leer"
          count={newCount}
          active={view === 'inbox' && filter.kind === 'new'}
          onClick={() => onSelectFilter({ kind: 'new' })}
        />
        <NavButton
          icon={<List size={17} />}
          label="Todos los mensajes"
          count={totalConversationsCount}
          active={view === 'inbox' && filter.kind === 'all'}
          onClick={() => onSelectFilter({ kind: 'all' })}
        />
        <NavButton
          icon={<UserCheck size={17} />}
          label="Mías · round robin"
          count={mineCount}
          active={view === 'inbox' && filter.kind === 'mine'}
          onClick={() => onSelectFilter({ kind: 'mine' })}
        />
        <NavButton
          icon={<HeartHandshake size={17} />}
          label="Apoyo"
          count={supportCount}
          active={view === 'inbox' && filter.kind === 'support'}
          onClick={() => onSelectFilter({ kind: 'support' })}
        />
        <NavButton
          icon={<CircleDashed size={17} />}
          label="Sin asignar"
          count={unassignedCount}
          active={view === 'inbox' && filter.kind === 'unassigned'}
          onClick={() => onSelectFilter({ kind: 'unassigned' })}
        />
        <NavButton
          icon={<Clock3 size={17} />}
          label="Pendientes"
          count={pendingCount}
          active={view === 'inbox' && filter.kind === 'pending'}
          onClick={() => onSelectFilter({ kind: 'pending' })}
        />
        <NavButton
          icon={<History size={17} />}
          label="Mis respuestas"
          active={view === 'inbox' && filter.kind === 'my_history'}
          onClick={() => onSelectFilter({ kind: 'my_history' })}
        />

        <div className="my-2 h-px w-8 bg-panel-light" />

        {teams
          .filter((team) => team !== 'Managers' || isAdmin)
          .map((team) => (
            <NavButton
              key={team}
              icon={<Users size={17} />}
              label={team}
              active={view === 'internal' && internalChannel === team}
              onClick={() => onSelectTeamChat(team)}
            />
          ))}

        <div className="mt-auto flex flex-col items-center gap-1">
          {isAdmin && (
            <NavButton
              icon={<AlarmClock size={17} />}
              label="Pospuestas"
              count={snoozedCount}
              active={view === 'inbox' && filter.kind === 'snoozed'}
              onClick={() => onSelectFilter({ kind: 'snoozed' })}
            />
          )}
          <NavButton
            icon={<Phone size={17} />}
            label="Llamadas perdidas"
            count={missedCallsCount}
            active={view === 'missed-calls'}
            alwaysColor
            onClick={onSelectMissedCalls}
          />
          <NavButton icon={<Users size={17} />} label="Contactos" active={view === 'contacts'} onClick={onSelectContacts} />
        </div>
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

        <NavButton
          icon={<UserCheck size={15} />}
          label="Mías · round robin"
          count={mineCount}
          active={view === 'inbox' && filter.kind === 'mine'}
          alwaysColor
          onClick={() => onSelectFilter({ kind: 'mine' })}
        />
        <NavButton
          icon={<HeartHandshake size={15} />}
          label="Apoyo"
          count={supportCount}
          active={view === 'inbox' && filter.kind === 'support'}
          alwaysColor
          onClick={() => onSelectFilter({ kind: 'support' })}
        />
        <NavButton
          icon={<CircleDashed size={15} />}
          label="Sin asignar"
          count={unassignedCount}
          active={view === 'inbox' && filter.kind === 'unassigned'}
          alwaysColor
          onClick={() => onSelectFilter({ kind: 'unassigned' })}
        />
        <NavButton
          icon={<Clock3 size={15} />}
          label="Pendientes"
          count={pendingCount}
          active={view === 'inbox' && filter.kind === 'pending'}
          onClick={() => onSelectFilter({ kind: 'pending' })}
        />
        <NavButton
          icon={<History size={15} />}
          label="Mis respuestas"
          active={view === 'inbox' && filter.kind === 'my_history'}
          onClick={() => onSelectFilter({ kind: 'my_history' })}
        />
      </div>

      <div>
        <GroupHeader label="Ver bandeja de..." />
        <select
          value={filter.kind === 'operator' ? filter.operatorId : ''}
          onChange={(e) => {
            const id = e.target.value
            if (id) onSelectFilter({ kind: 'operator', operatorId: id })
          }}
          className={`w-full rounded-md border px-2 py-2 text-xs outline-none ${
            filter.kind === 'operator'
              ? 'border-mustard bg-asphalt font-semibold text-cream'
              : 'border-panel-light bg-asphalt text-muted'
          }`}
        >
          <option value="">
            {availableOperators.length === 0 ? 'Nadie disponible ahora' : 'Elegir operador disponible...'}
          </option>
          {availableOperators.map((o) => (
            <option key={o.id} value={o.id}>
              {o.operator_code ? `${o.operator_code} · ` : ''}
              {o.full_name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <GroupHeader label="Mis equipos" />
        {teams
          .filter((team) => team !== 'Managers' || isAdmin)
          .map((team) => (
            <NavButton
              key={team}
              icon={<Users size={15} />}
              label={team}
              active={view === 'internal' && internalChannel === team}
              onClick={() => onSelectTeamChat(team)}
            />
          ))}
      </div>

      {/* Utilidades: Pospuestas, Llamadas perdidas, Contactos */}
      <div className="mt-auto border-t border-panel-light pt-3">
        {isAdmin && (
          <NavButton
            icon={<AlarmClock size={15} />}
            label="Pospuestas"
            count={snoozedCount}
            active={view === 'inbox' && filter.kind === 'snoozed'}
            mustardLabel
            onClick={() => onSelectFilter({ kind: 'snoozed' })}
          />
        )}
        <NavButton
          icon={<Phone size={15} />}
          label="Llamadas perdidas"
          count={missedCallsCount}
          active={view === 'missed-calls'}
          alwaysColor
          mustardLabel
          onClick={onSelectMissedCalls}
        />
        <NavButton icon={<Users size={15} />} label="Contactos" active={view === 'contacts'} onClick={onSelectContacts} />
      </div>
    </aside>
  )
}
