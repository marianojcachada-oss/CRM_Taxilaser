import { useState } from 'react'
import {
  Users,
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
  MessageSquarePlus,
} from 'lucide-react'
import type { Conversation, Channel, Operator } from './ConversationsView'
import { useLayout } from './layoutPreference'

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

const channelNav: { id: Channel; label: string; color: string }[] = [
  { id: 'whatsapp', label: 'WhatsApp', color: '#25D366' },
  { id: 'sms', label: 'SMS', color: '#6B6459' },
  { id: 'instagram', label: 'Instagram', color: '#E1306C' },
  { id: 'facebook', label: 'Messenger', color: '#1877F2' },
]

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
  // undefined = contador apagado desde Integraciones (no se muestra el número)
  missedCallsCount?: number
  totalConversationsCount: number
  onSelectContacts: () => void
  onSelectTeamChat: (team: string) => void
  onSelectMissedCalls: () => void
  // Precalculado en Inbox.tsx (no se puede sacar de "conversations" +
  // operatorId solo, hace falta cruzar con conversation_support).
  supportCount: number
  // Interfaz "Espacio de trabajo": el botón Nuevo SMS vive arriba del menú.
  onNewSms?: () => void
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
  totalConversationsCount,
  onSelectTeamChat,
  supportCount,
  onNewSms,
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
  const layout = useLayout()

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
        data-count=""
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
          aria-label={label}
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
        data-nav="item"
        data-active={active ? 'true' : undefined}
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
      <aside className="ui-nav ui-nav-collapsed flex w-14 shrink-0 flex-col items-center gap-1 border-r border-panel-light bg-panel py-4">
        <button
          onClick={toggleCollapsed}
          className="mb-2 flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-panel-light hover:text-mustard"
          title="Expandir el menú"
          aria-label="Expandir el menú"
        >
          <ChevronsRight size={16} />
        </button>

        {layout === 'espacio' && onNewSms && (
          <button
            onClick={onNewSms}
            title="Nuevo SMS"
            aria-label="Nuevo SMS"
            className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl bg-mustard text-asphalt transition-opacity hover:opacity-90"
          >
            <MessageSquarePlus size={17} />
          </button>
        )}

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
          label="Mías"
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
        </div>
      </aside>
    )
  }

  // Interfaz "Espacio de trabajo": mismas bandejas y mismos contadores, pero
  // cada una como ítem propio (en la clásica "Sin leer/Todos" es un selector
  // de dos posiciones), con canales, equipo y la tarjeta del operador abajo.
  if (layout === 'espacio') {
    const me = operators.find((o) => o.id === operatorId)
    const meName = me?.full_name ?? 'Operador'
    const meInitials =
      meName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase())
        .join('') || '?'
    const inInbox = view === 'inbox'
    return (
      <aside className="ui-nav flex w-64 shrink-0 flex-col gap-4 overflow-y-auto border-r border-panel-light bg-panel px-3 py-4">
        {onNewSms && (
          <button
            onClick={onNewSms}
            className="ui-newsms flex w-full items-center justify-center gap-2 rounded-xl bg-mustard px-3 py-2.5 text-sm font-semibold text-asphalt transition-opacity hover:opacity-90"
          >
            <MessageSquarePlus size={16} /> Nuevo SMS
          </button>
        )}
        <div>
          <GroupHeader label="Espacio de trabajo" />
          <NavButton
            icon={<InboxIcon size={16} />}
            label="Bandeja de entrada"
            count={totalConversationsCount}
            active={inInbox && filter.kind === 'all'}
            onClick={() => onSelectFilter({ kind: 'all' })}
          />
          <NavButton
            icon={<CircleDashed size={16} />}
            label="Sin leer"
            count={newCount}
            active={inInbox && filter.kind === 'new'}
            onClick={() => onSelectFilter({ kind: 'new' })}
          />
          <NavButton
            icon={<UserCheck size={16} />}
            label="Mis conversaciones"
            count={mineCount}
            active={inInbox && filter.kind === 'mine'}
            onClick={() => onSelectFilter({ kind: 'mine' })}
          />
          <NavButton
            icon={<Clock3 size={16} />}
            label="Pendientes"
            count={pendingCount}
            active={inInbox && filter.kind === 'pending'}
            onClick={() => onSelectFilter({ kind: 'pending' })}
          />
          <NavButton
            icon={<CircleDashed size={16} />}
            label="Sin asignar"
            count={unassignedCount}
            active={inInbox && filter.kind === 'unassigned'}
            onClick={() => onSelectFilter({ kind: 'unassigned' })}
          />
          <NavButton
            icon={<HeartHandshake size={16} />}
            label="Apoyo"
            count={supportCount}
            active={inInbox && filter.kind === 'support'}
            onClick={() => onSelectFilter({ kind: 'support' })}
          />
          <NavButton
            icon={<History size={16} />}
            label="Mis respuestas"
            active={inInbox && filter.kind === 'my_history'}
            onClick={() => onSelectFilter({ kind: 'my_history' })}
          />
          {isAdmin && (
            <NavButton
              icon={<AlarmClock size={16} />}
              label="Pospuestas"
              count={snoozedCount}
              active={inInbox && filter.kind === 'snoozed'}
              onClick={() => onSelectFilter({ kind: 'snoozed' })}
            />
          )}
        </div>

        <div>
          <GroupHeader label="Canales" />
          {channelNav.map((ch) => {
            const active = inInbox && filter.channel === ch.id
            const base: FilterValue = inInbox ? filter : { kind: 'all' }
            return (
              <NavButton
                key={ch.id}
                icon={<span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: ch.color }} />}
                label={ch.label}
                count={conversations.filter((c) => c.channel === ch.id && c.unread).length}
                active={active}
                onClick={() =>
                  onSelectFilter(
                    active ? ({ ...base, channel: undefined } as FilterValue) : ({ ...base, channel: ch.id } as FilterValue),
                  )
                }
              />
            )
          })}
        </div>

        <div>
          <GroupHeader label="Equipo" />
          {teams
            .filter((team) => team !== 'Managers' || isAdmin)
            .map((team) => (
              <NavButton
                key={team}
                icon={<Users size={16} />}
                label={team}
                active={view === 'internal' && internalChannel === team}
                onClick={() => onSelectTeamChat(team)}
              />
            ))}
          <select
            aria-label="Ver la bandeja de otro operador"
            value={filter.kind === 'operator' ? filter.operatorId : ''}
            onChange={(e) => {
              const id = e.target.value
              if (id) onSelectFilter({ kind: 'operator', operatorId: id })
            }}
            className={`mt-1 w-full rounded-md border px-2 py-2 text-xs outline-none focus-visible:border-mustard ${
              filter.kind === 'operator'
                ? 'border-mustard bg-asphalt font-semibold text-cream'
                : 'border-panel-light bg-asphalt text-muted'
            }`}
          >
            <option value="">
              {availableOperators.length === 0 ? 'Ver bandeja de otro operador (nadie disponible)' : 'Ver bandeja de otro operador…'}
            </option>
            {availableOperators.map((o) => (
              <option key={o.id} value={o.id}>
                {o.operator_code ? `${o.operator_code} · ` : ''}
                {o.full_name}
              </option>
            ))}
          </select>
        </div>

        <div className="ui-usercard mt-auto flex items-center gap-2.5 border-t border-panel-light pt-3">
          <span aria-hidden="true" className="ui-usercard-avatar">{meInitials}</span>
          <span className="min-w-0 flex-1">
            <strong className="block truncate text-xs text-cream">{meName}</strong>
            <small className="block text-[11px] text-muted">{isAdmin ? 'Administrador' : 'Operador'}</small>
          </span>
          <button
            onClick={toggleCollapsed}
            className="rounded-md p-1.5 text-muted hover:bg-panel-light hover:text-mustard"
            title="Contraer el menú"
            aria-label="Contraer el menú"
          >
            <ChevronsLeft size={15} />
          </button>
        </div>
      </aside>
    )
  }

  return (
    <aside className="ui-nav flex w-64 shrink-0 flex-col gap-5 overflow-y-auto border-r border-panel-light bg-panel px-3 py-4">
      <button
        onClick={toggleCollapsed}
        className="mb-1 flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-xs text-muted hover:bg-panel-light hover:text-mustard"
        title="Contraer el menú"
      >
        <ChevronsLeft size={14} /> Contraer
      </button>
      <div>
        <GroupHeader label="Mi trabajo" />

        {/* Selector de dos posiciones (new/all). */}
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
          label="Mías"
          count={mineCount}
          active={view === 'inbox' && filter.kind === 'mine'}
          alwaysColor
          onClick={() => onSelectFilter({ kind: 'mine' })}
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
        <GroupHeader label="Equipo" />
        <NavButton
          icon={<CircleDashed size={15} />}
          label="Sin asignar"
          count={unassignedCount}
          active={view === 'inbox' && filter.kind === 'unassigned'}
          alwaysColor
          onClick={() => onSelectFilter({ kind: 'unassigned' })}
        />
        <NavButton
          icon={<HeartHandshake size={15} />}
          label="Apoyo"
          count={supportCount}
          active={view === 'inbox' && filter.kind === 'support'}
          alwaysColor
          onClick={() => onSelectFilter({ kind: 'support' })}
        />
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
        <select
          aria-label="Ver la bandeja de otro operador"
          value={filter.kind === 'operator' ? filter.operatorId : ''}
          onChange={(e) => {
            const id = e.target.value
            if (id) onSelectFilter({ kind: 'operator', operatorId: id })
          }}
          className={`mt-1 w-full rounded-md border px-2 py-2 text-xs outline-none focus-visible:border-mustard ${
            filter.kind === 'operator'
              ? 'border-mustard bg-asphalt font-semibold text-cream'
              : 'border-panel-light bg-asphalt text-muted'
          }`}
        >
          <option value="">
            {availableOperators.length === 0 ? 'Ver bandeja de otro operador (nadie disponible)' : 'Ver bandeja de otro operador…'}
          </option>
          {availableOperators.map((o) => (
            <option key={o.id} value={o.id}>
              {o.operator_code ? `${o.operator_code} · ` : ''}
              {o.full_name}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-auto border-t border-panel-light pt-3">
        <GroupHeader label="Más" />
        {isAdmin && (
          <NavButton
            icon={<AlarmClock size={15} />}
            label="Pospuestas"
            count={snoozedCount}
            active={view === 'inbox' && filter.kind === 'snoozed'}
            onClick={() => onSelectFilter({ kind: 'snoozed' })}
          />
        )}
      </div>
    </aside>
  )
}
