import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useLocation, useMatch, useNavigate } from 'react-router-dom'
import { Search, Bell, MessageSquarePlus, Menu, X, ShieldCheck } from 'lucide-react'
import { supabase } from './supabaseClient'
import ConversationsView, { type Conversation, type Operator } from './ConversationsView'
import ContactsView from './ContactsView'
import Sidebar, { type FilterValue } from './Sidebar'
import InternalChat from './InternalChat'
import SimulateMessageModal from './SimulateMessageModal'
import StartConversationModal from './StartConversationModal'
import MissedCallsView from './MissedCallsView'
import ProfileMenu from './ProfileMenu'
import { CONVERSATION_SELECT, mapConversation } from './conversationsData'

// 'cancelacion' entra acá como red de seguridad: aunque arreglamos la
// causa de raíz (un mensaje automático podía apagar el unread y hacer
// que la conversación se perdiera), si por cualquier otro motivo
// unread llega a estar en false, una posible cancelación tiene que
// seguir siendo visible en "Pendientes" — nunca puede quedar afuera de
// las dos pestañas.
// Slug de la URL (/chat-interno/<slug>) -> nombre del canal, el mismo
// que usa Sidebar.tsx. Un slug desconocido vuelve a la bandeja.
const INTERNAL_CHANNEL_SLUGS: Record<string, string> = {
  dispatchers: 'Dispatchers',
  managers: 'Managers',
}

const pendingStatuses = ['esperando_operador', 'esperando_informacion', 'reclamo', 'cancelacion']

// Ordena por el número del código (D5 antes que D12), no por texto — un
// orden alfabético pondría "D12" antes que "D5". Los que no tengan código
// van al final, ordenados por nombre.
function byOperatorCode(a: Operator, b: Operator) {
  const numA = a.operator_code ? parseInt(a.operator_code.replace(/\D/g, ''), 10) : NaN
  const numB = b.operator_code ? parseInt(b.operator_code.replace(/\D/g, ''), 10) : NaN
  if (isNaN(numA) && isNaN(numB)) return a.full_name.localeCompare(b.full_name)
  if (isNaN(numA)) return 1
  if (isNaN(numB)) return -1
  return numA - numB
}

function isSnoozed(c: Conversation): boolean {
  return !!c.snoozedUntil && new Date(c.snoozedUntil).getTime() > Date.now()
}

function matchesFilter(c: Conversation, filter: FilterValue, operatorId: string | null): boolean {
  switch (filter.kind) {
    case 'all':
      return true
    case 'new':
      return c.unread
    case 'pending':
      return !c.unread && pendingStatuses.includes(c.status)
    case 'mine':
      // OJO: tiene que ser EXACTAMENTE el mismo criterio que mineCount en
      // Sidebar.tsx. Antes esto era solo "assignedOperatorId === operatorId",
      // sin mirar el status — así que una conversación cerrada (con o sin
      // mensajes nuevos) se quedaba para siempre en "Mías · round robin",
      // grisada, hasta que un F5 volvía a traer la lista desde cero (la
      // consulta base en App.tsx sí excluye 'cerrada' con .neq(), pero el
      // estado local solo PATCHEA el status en el array en memoria, nunca
      // saca la fila). El "|| c.unread" es a propósito: si vuelve a entrar
      // un mensaje nuevo en una conversación ya cerrada (antes de que el
      // backend la reabra), sigue mostrándose para que no se pierda.
      return c.assignedOperatorId === operatorId && (c.unread || c.status !== 'cerrada')
    case 'unassigned':
      return c.assignedOperatorId === null && c.needsAssignment
    case 'snoozed':
      return isSnoozed(c)
    case 'my_history':
      return true // se resuelve con su propia consulta, no por esta función
    case 'support':
      return true // ídem — se resuelve cruzando con supportIds, no acá
    case 'operator':
      return c.assignedOperatorId === filter.operatorId
  }
}

type Props = {
  theme: string
  onChangeTheme: (id: string) => void
  // Patrón de fondo del chat — preferencia aparte del tema de colores,
  // elegida por el operador y guardada en el backend (ver App.tsx).
  chatPattern: string
  onChangeChatPattern: (id: string) => void
  // Tipografía — tercer sibling de preferencias por operador (se aplica
  // globalmente vía variable CSS, no hace falta pasarla a ConversationsView).
  font: string
  onChangeFont: (id: string) => void
  operatorName: string
  operatorId: string | null
  isAdmin: boolean
  isSuperAdmin: boolean
  onOpenAdmin: () => void
  conversations: Conversation[]
  setConversations: React.Dispatch<React.SetStateAction<Conversation[]>>
  onRefreshConversations: () => void
  muted: boolean
  onToggleMuted: () => void
  operatorPresence: 'available' | 'offline' | 'busy' | 'apoyo'
  onSetPresence: (next: 'available' | 'offline' | 'apoyo') => void
}

export default function Inbox({
  theme,
  onChangeTheme,
  chatPattern,
  onChangeChatPattern,
  font,
  onChangeFont,
  operatorName,
  operatorId,
  isAdmin,
  isSuperAdmin,
  onOpenAdmin,
  conversations,
  setConversations,
  onRefreshConversations,
  muted,
  onToggleMuted,
  operatorPresence,
  onSetPresence,
}: Props) {
  // La vista (y el canal del chat interno) salen de la URL, no de un
  // useState: así F5, atrás/adelante y los links directos funcionan.
  // Las rutas están declaradas en App.tsx (todas renderizan este Inbox).
  const navigate = useNavigate()
  const location = useLocation()
  const internalMatch = useMatch('/chat-interno/:canal')
  const view: 'inbox' | 'contacts' | 'internal' | 'missed-calls' =
    location.pathname === '/contactos'
      ? 'contacts'
      : internalMatch
        ? 'internal'
        : location.pathname === '/llamadas-perdidas'
          ? 'missed-calls'
          : 'inbox'
  const internalChannel = internalMatch ? (INTERNAL_CHANNEL_SLUGS[internalMatch.params.canal ?? ''] ?? null) : null
  // Cambia de vista sin apilar entradas repetidas en el historial si ya
  // estás ahí (ej.: tocar un filtro estando en la bandeja).
  function goTo(path: string) {
    if (location.pathname !== path) navigate(path)
  }
  const [missedCallsCount, setMissedCallsCount] = useState(0)
  const [totalConversationsCount, setTotalConversationsCount] = useState(0)
  const [filter, setFilter] = useState<FilterValue>({ kind: 'mine' })
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Conversation[] | null>(null)
  const [allHistoryResults, setAllHistoryResults] = useState<Conversation[] | null>(null)
  const [myHistoryResults, setMyHistoryResults] = useState<Conversation[] | null>(null)
  // IDs de conversaciones (de OTROS operadores) donde yo apoyé — se carga
  // siempre que haya operatorId (no solo al entrar a la pestaña "Apoyo"),
  // para que el contador del sidebar esté siempre al día.
  const [supportIds, setSupportIds] = useState<Set<string>>(new Set())
  const [allHistoryLoading, setAllHistoryLoading] = useState(false)
  const [operators, setOperators] = useState<Operator[]>([])
  const [showSimulator, setShowSimulator] = useState(false)
  const [showStartConversation, setShowStartConversation] = useState(false)
  const [showMobileSidebar, setShowMobileSidebar] = useState(false)
  const [showMobileSearch, setShowMobileSearch] = useState(false)

  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function loadOperators() {
      supabase
        .from('operators')
        .select('id, full_name, operator_code, presence')
        .then(({ data }) => setOperators((data ?? []).slice().sort(byOperatorCode)))
    }
    loadOperators()

    // Se mantiene al día en vivo — es lo que permite que el filtro "Ver
    // bandeja de..." solo ofrezca operadores que están disponibles EN
    // ESTE MOMENTO, no una foto vieja de cuando se abrió la pestaña.
    //
    // OJO: esto volvía a pedir TODOS los operadores (loadOperators()
    // completo) cada vez que se actualizaba CUALQUIER columna de
    // "operators" — y esa fila cambia todo el tiempo: el round robin
    // actualiza last_assigned_at en CADA asignación (no solo cuando
    // cambia la presencia), y cada operador que cambia su tema, patrón
    // de chat o tipografía también dispara un UPDATE ahí. Confirmado en
    // los logs de Supabase: esto era de los dos consumos más grandes de
    // todo el proyecto. El payload de Realtime ya trae la fila entera
    // actualizada — alcanza con parchear en memoria el operador que
    // cambió, sin volver a pedir nada a la base.
    const channel = supabase
      .channel('operators-presence')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'operators' }, (payload) => {
        const row = payload.new as {
          id: string
          full_name: string | null
          operator_code: string | null
          presence: 'available' | 'offline' | 'busy' | null
        }
        setOperators((prev) => {
          const idx = prev.findIndex((o) => o.id === row.id)
          if (idx === -1) return prev
          const next = [...prev]
          next[idx] = {
            ...next[idx],
            full_name: row.full_name ?? next[idx].full_name,
            operator_code: row.operator_code ?? next[idx].operator_code,
            presence: row.presence ?? next[idx].presence,
          }
          return next.sort(byOperatorCode)
        })
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'operators' }, loadOperators)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'operators' }, (payload) => {
        const oldRow = payload.old as { id: string }
        setOperators((prev) => prev.filter((o) => o.id !== oldRow.id))
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    function loadMissedCallsCount() {
      supabase
        .from('missed_calls')
        .select('id', { count: 'exact', head: true })
        .eq('acknowledged', false)
        .then(({ count }) => setMissedCallsCount(count ?? 0))
    }
    loadMissedCallsCount()

    // Debounce: marcar N llamadas como vistas genera N eventos de Realtime;
    // con esto se hace UNA sola consulta de conteo cuando se calma la ráfaga.
    let timer: ReturnType<typeof setTimeout> | null = null
    const channel = supabase
      .channel('missed-calls-count')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'missed_calls' }, () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(loadMissedCallsCount, 1000)
      })
      .subscribe()

    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [])

  // "Todos" es el histórico completo de verdad — a diferencia de la
  // lista principal (que a propósito solo trae lo activo, para que la
  // bandeja cargue rápido), esto consulta sin importar el estado.
  //
  // OJO — esto antes dependía de [conversations] (el estado local), que
  // cambia con CADA mensaje nuevo, cada asignación, cada cambio de
  // estado — no solo cuando se crea o se borra una conversación. Eso
  // disparaba esta consulta decenas de miles de veces por hora en cada
  // pestaña abierta (confirmado en los logs de Supabase: ~4 requests
  // por segundo por operador conectado), inflando un montón el consumo
  // de Log Query y de Realtime Messages del proyecto sin necesidad.
  // El total de conversaciones SOLO cambia cuando se crea o se borra
  // una — así que ahora se recalcula nada más en esos dos eventos,
  // igual que ya hace missedCallsCount arriba.
  useEffect(() => {
    function loadTotalConversationsCount() {
      supabase
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .then(({ count }) => setTotalConversationsCount(count ?? 0))
    }
    loadTotalConversationsCount()

    const channel = supabase
      .channel('total-conversations-count')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversations' }, loadTotalConversationsCount)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'conversations' }, loadTotalConversationsCount)
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    if (filter.kind !== 'all') {
      setAllHistoryResults(null)
      return
    }

    setAllHistoryLoading(true)
    supabase
      .from('conversations')
      .select(CONVERSATION_SELECT)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(300)
      .then(({ data }) => {
        setAllHistoryResults((data ?? []).map(mapConversation))
        setAllHistoryLoading(false)
      })
  }, [filter.kind])

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Búsqueda real contra la base — no solo sobre lo ya cargado. Busca por
  // nombre/teléfono del contacto, por el último mensaje, y dentro del
  // contenido de mensajes viejos. Trae las filas completas de lo que
  // encuentre, así también aparecen conversaciones cerradas/viejas que
  // ya no forman parte de la lista activa cargada de arranque.
  useEffect(() => {
    const q = searchQuery.trim()
    if (q.length < 2) {
      setSearchResults(null)
      return
    }

    const timeout = setTimeout(async () => {
      const digits = q.replace(/\D/g, '')

      const [byContactName, byContactPhone, byPreview, byMessageContent] = await Promise.all([
        supabase.from('contacts').select('id').ilike('full_name', `%${q}%`),
        digits.length >= 3
          ? supabase.from('contacts').select('id').ilike('phone', `%${digits}%`)
          : Promise.resolve({ data: [] as { id: string }[] }),
        supabase.from('conversations').select('id').ilike('last_message_preview', `%${q}%`),
        supabase.from('messages').select('conversation_id').ilike('content', `%${q}%`),
      ])

      const contactIds = [...(byContactName.data ?? []), ...(byContactPhone.data ?? [])].map((r) => r.id)
      const conversationIdsFromPreview = (byPreview.data ?? []).map((r) => r.id)
      const conversationIdsFromMessages = (byMessageContent.data ?? [])
        .map((r) => r.conversation_id)
        .filter(Boolean)

      const byContact = contactIds.length
        ? await supabase.from('conversations').select('id').in('contact_id', contactIds)
        : { data: [] as { id: string }[] }

      const allIds = Array.from(
        new Set([
          ...(byContact.data ?? []).map((r) => r.id),
          ...conversationIdsFromPreview,
          ...conversationIdsFromMessages,
        ]),
      )

      if (allIds.length === 0) {
        setSearchResults([])
        return
      }

      const { data } = await supabase
        .from('conversations')
        .select(CONVERSATION_SELECT)
        .in('id', allIds)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(100)

      setSearchResults((data ?? []).map(mapConversation))
    }, 350)

    return () => clearTimeout(timeout)
  }, [searchQuery])

  // "Todos" trae de verdad todo, incluidas las cerradas — la consulta
  // base de arranque las excluye a propósito (por rendimiento), así que
  // esta pestaña necesita su propia consulta aparte.
  useEffect(() => {
    if (filter.kind !== 'all') {
      setAllHistoryResults(null)
      return
    }
    supabase
      .from('conversations')
      .select(CONVERSATION_SELECT)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(300)
      .then(({ data }) => setAllHistoryResults((data ?? []).map(mapConversation)))
  }, [filter.kind])

  // "Mis respuestas": conversaciones donde YO mandé al menos un mensaje
  // alguna vez, más allá de que hoy estén asignadas a otro operador,
  // sin asignar, o cerradas — por eso tampoco alcanza con la lista base.
  useEffect(() => {
    if (filter.kind !== 'my_history' || !operatorId) {
      setMyHistoryResults(null)
      return
    }
    supabase
      .from('messages')
      .select('conversation_id')
      .eq('sender_operator_id', operatorId)
      .then(async ({ data: msgs }) => {
        const ids = Array.from(new Set((msgs ?? []).map((m) => m.conversation_id).filter(Boolean)))
        if (ids.length === 0) {
          setMyHistoryResults([])
          return
        }
        const { data } = await supabase
          .from('conversations')
          .select(CONVERSATION_SELECT)
          .in('id', ids)
          .order('last_message_at', { ascending: false, nullsFirst: false })
          .limit(300)
        setMyHistoryResults((data ?? []).map(mapConversation))
      })
  }, [filter.kind, operatorId])

  // Bandeja "Apoyo": arranca con lo que ya esté activo en conversation_support
  // y se mantiene al día con un canal de Realtime filtrado por mi propio
  // operator_id (bajo volumen a propósito, nada que ver con el canal
  // global de conversations — no reintroduce el problema que arreglamos ahí).
  useEffect(() => {
    if (!operatorId) {
      setSupportIds(new Set())
      return
    }

    supabase
      .from('conversation_support')
      .select('conversation_id')
      .eq('operator_id', operatorId)
      .eq('active', true)
      .then(({ data, error }) => {
        if (error) {
          console.error('No se pudo cargar la bandeja de Apoyo:', error.message)
          return
        }
        setSupportIds(new Set((data ?? []).map((r) => r.conversation_id)))
      })

    const channel = supabase
      .channel(`conversation-support-${operatorId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversation_support', filter: `operator_id=eq.${operatorId}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as { conversation_id?: string; active?: boolean } | null
          if (!row?.conversation_id) return
          setSupportIds((prev) => {
            const next = new Set(prev)
            if (payload.eventType === 'DELETE' || row.active === false) {
              next.delete(row.conversation_id!)
            } else {
              next.add(row.conversation_id!)
            }
            return next
          })
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [operatorId])

  const unreadTotal = conversations.filter((c) => c.unread).length

  const visibleConversations = useMemo(() => {
    if (searchQuery.trim().length >= 2) {
      return searchResults ?? []
    }
    if (filter.kind === 'all') {
      return allHistoryResults ?? []
    }
    if (filter.kind === 'my_history') {
      return myHistoryResults ?? []
    }
    if (filter.kind === 'support') {
      return conversations.filter((c) => supportIds.has(c.id))
    }
    return conversations
      .filter((c) => (filter.kind === 'snoozed' ? true : !isSnoozed(c)))
      .filter((c) => matchesFilter(c, filter, operatorId))
  }, [conversations, filter, searchQuery, searchResults, allHistoryResults, myHistoryResults, supportIds, operatorId])

  // Para el contador del sidebar — mismo criterio que la lista de arriba,
  // pero siempre calculado (no solo cuando esa pestaña está activa).
  const supportCount = conversations.filter((c) => supportIds.has(c.id)).length

  // Actualiza tanto la lista principal como los resultados de búsqueda a
  // la vez — así una acción sobre un resultado de búsqueda (que puede no
  // estar en la lista principal cargada) también se refleja al toque.
  function updateConversationsEverywhere(action: React.SetStateAction<Conversation[]>) {
    setConversations(action)
    setSearchResults((prev) => {
      if (!prev) return prev
      return typeof action === 'function' ? (action as (p: Conversation[]) => Conversation[])(prev) : action
    })
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  // /chat-interno/<algo> escrito a mano con un canal inexistente -> de
  // vuelta a la bandeja. (Managers sin ser admin lo redirige App.tsx,
  // que sabe cuándo terminaron de cargar los permisos — acá isAdmin
  // arranca en false y rebotaría también a los admins con un F5.)
  if (internalMatch && !internalChannel) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="flex h-screen flex-col bg-asphalt text-cream">
      {/* Barra superior */}
      <header className="flex items-center justify-between border-b border-panel-light bg-panel px-5 py-3">
        <div className="flex items-center gap-5">
          <button
            onClick={() => setShowMobileSidebar(true)}
            className="text-cream md:hidden"
          >
            <Menu size={20} />
          </button>

          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-mustard text-sm font-bold text-asphalt">
              Q
            </span>
            <span className="text-base font-bold uppercase tracking-wide text-cream">Qué tal?</span>
          </div>

          <div className="hidden items-center gap-2 rounded-full border border-panel-light bg-asphalt px-3.5 py-2 md:flex">
            <Search size={14} className="text-muted" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && searchQuery) {
                  e.preventDefault()
                  setSearchQuery('')
                }
              }}
              placeholder="Buscar por nombre, teléfono, unidad o mensaje..."
              className="w-80 bg-transparent text-sm text-cream placeholder-muted outline-none"
            />
            {searchQuery ? (
              <button
                onClick={() => {
                  setSearchQuery('')
                  searchInputRef.current?.focus()
                }}
                className="text-muted transition-colors hover:text-cream"
                title="Limpiar búsqueda (Esc)"
              >
                <X size={13} />
              </button>
            ) : (
              <span className="rounded-sm border border-panel-light px-1 font-mono text-[10px] text-muted">⌘K</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2.5 text-sm">
          <button
            onClick={() => setShowMobileSearch(true)}
            className="text-muted md:hidden"
          >
            <Search size={18} />
          </button>

          <button
            onClick={() => setShowStartConversation(true)}
            aria-label="Nuevo SMS"
            className="flex items-center gap-1.5 rounded-full bg-mustard px-3.5 py-2 text-xs font-semibold text-asphalt transition-opacity hover:opacity-90"
            title="Iniciar conversación nueva por SMS"
          >
            <MessageSquarePlus size={14} /> <span className="hidden sm:inline">Nuevo SMS</span>
          </button>

          {/* Disponible / No disponible / Apoyo — reemplaza al viejo
              toggle binario. "No disponible" también puede llegar sola
              (sin que el operador la elija) por el auto-logout de 10 min
              de inactividad — acá solo se refleja el estado actual. */}
          <div
            className={`hidden items-center gap-1 rounded-full border px-1 py-1 text-xs font-medium sm:flex ${
              operatorPresence === 'available'
                ? 'border-available/40'
                : operatorPresence === 'apoyo'
                  ? 'border-mustard/40'
                  : 'border-panel-light'
            }`}
          >
            <button
              onClick={() => onSetPresence('available')}
              aria-pressed={operatorPresence === 'available'}
              title="Recibir mensajes nuevos por round robin"
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-colors ${
                operatorPresence === 'available' ? 'bg-available/25 font-semibold text-available' : 'text-muted hover:text-cream'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${operatorPresence === 'available' ? 'bg-available' : 'bg-muted'}`} />
              Disponible{operatorPresence === 'available' && <span aria-hidden="true"> ✓</span>}
            </button>
            <button
              onClick={() => onSetPresence('offline')}
              aria-pressed={operatorPresence === 'offline' || operatorPresence === 'busy'}
              title="No recibir mensajes nuevos"
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-colors ${
                operatorPresence === 'offline' || operatorPresence === 'busy'
                  ? 'bg-panel-light font-semibold text-cream'
                  : 'text-muted hover:text-cream'
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-muted" />
              No disponible{(operatorPresence === 'offline' || operatorPresence === 'busy') && <span aria-hidden="true"> ✓</span>}
            </button>
            <button
              onClick={() => onSetPresence('apoyo')}
              aria-pressed={operatorPresence === 'apoyo'}
              title="Ayudar con conversaciones de otros operadores sin que te asignen las tuyas"
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-colors ${
                operatorPresence === 'apoyo' ? 'bg-mustard/25 font-semibold text-mustard' : 'text-muted hover:text-cream'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${operatorPresence === 'apoyo' ? 'bg-mustard' : 'bg-muted'}`} />
              Apoyo{operatorPresence === 'apoyo' && <span aria-hidden="true"> ✓</span>}
            </button>
          </div>

          {isAdmin && (
            <button
              onClick={onOpenAdmin}
              className="hidden items-center gap-1.5 rounded-full border border-mustard/40 px-3 py-2 text-xs font-medium text-mustard transition-colors hover:bg-mustard/10 sm:flex"
            >
              <ShieldCheck size={14} /> Panel admin
            </button>
          )}

          <div
            className="relative flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-panel-light"
            role="img"
            aria-label={`${unreadTotal} sin leer`}
          >
            <Bell size={16} />
            {unreadTotal > 0 && (
              <span className="absolute right-1 top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-mustard text-[9px] font-bold text-asphalt">
                {unreadTotal}
              </span>
            )}
          </div>

          <ProfileMenu
            operatorName={operatorName}
            theme={theme}
            onChangeTheme={onChangeTheme}
            chatPattern={chatPattern}
            onChangeChatPattern={onChangeChatPattern}
            font={font}
            onChangeFont={onChangeFont}
            muted={muted}
            onToggleMuted={onToggleMuted}
            isAdmin={isAdmin}
            onOpenAdmin={onOpenAdmin}
            onOpenSimulator={() => setShowSimulator(true)}
            onSignOut={handleSignOut}
          />
        </div>
      </header>

      {/* Buscador en mobile: se abre como barra superpuesta */}
      {showMobileSearch && (
        <div className="flex items-center gap-2 border-b border-panel-light bg-panel px-4 py-2.5 md:hidden">
          <Search size={14} className="text-muted" />
          <input
            autoFocus
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                setSearchQuery('')
                setShowMobileSearch(false)
              }
            }}
            placeholder="Buscar..."
            className="flex-1 bg-transparent text-sm text-cream placeholder-muted outline-none"
          />
          <button onClick={() => setShowMobileSearch(false)} className="text-muted">
            <X size={16} />
          </button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <div
          className={`${
            showMobileSidebar ? 'fixed inset-0 z-40 flex' : 'hidden'
          } md:static md:z-auto md:flex`}
        >
          <Sidebar
            conversations={conversations}
            operators={operators}
            operatorId={operatorId}
            isAdmin={isAdmin}
            filter={filter}
            onSelectFilter={(f) => {
              setFilter(f)
              goTo('/')
              setShowMobileSidebar(false)
            }}
            view={view}
            internalChannel={internalChannel}
            missedCallsCount={missedCallsCount}
            totalConversationsCount={totalConversationsCount}
            supportCount={supportCount}
            onSelectContacts={() => {
              goTo('/contactos')
              setShowMobileSidebar(false)
            }}
            onSelectTeamChat={(team) => {
              goTo(`/chat-interno/${team.toLowerCase()}`)
              setShowMobileSidebar(false)
            }}
            onSelectMissedCalls={() => {
              goTo('/llamadas-perdidas')
              setShowMobileSidebar(false)
            }}
          />
          <div onClick={() => setShowMobileSidebar(false)} className="flex-1 bg-black/50 md:hidden" />
        </div>

        {view === 'inbox' && (
          <ConversationsView
            conversations={visibleConversations}
            setConversations={updateConversationsEverywhere}
            operators={operators}
            operatorId={operatorId}
            operatorName={operatorName}
            isAdmin={isAdmin}
            isSuperAdmin={isSuperAdmin}
            theme={theme}
            chatPattern={chatPattern}
            filter={filter}
            onSelectFilter={(f) => setFilter(f)}
            onRefreshConversations={onRefreshConversations}
          />
        )}
        {view === 'contacts' && <ContactsView isAdmin={isAdmin} />}
        {/* Managers solo con isAdmin ya confirmado: mientras cargan los
            permisos no se muestra, para no dejar ver ese canal ni un instante. */}
        {view === 'internal' && internalChannel && (internalChannel !== 'Managers' || isAdmin) && (
          <InternalChat channelName={internalChannel} operatorId={operatorId} operatorName={operatorName} />
        )}
        {view === 'missed-calls' && <MissedCallsView />}
      </div>

      {showSimulator && (
        <SimulateMessageModal
          onClose={() => setShowSimulator(false)}
          onSent={() => {
            setShowSimulator(false)
            onRefreshConversations()
          }}
        />
      )}

      {showStartConversation && (
        <StartConversationModal
          onClose={() => setShowStartConversation(false)}
          onSent={() => {
            setShowStartConversation(false)
            onRefreshConversations()
          }}
        />
      )}
    </div>
  )
}
