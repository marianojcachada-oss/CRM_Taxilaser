import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import Login from './Login'
import ResetPassword from './ResetPassword'
import Inbox from './Inbox'
import AdminPanel from './AdminPanel'
import type { Session } from '@supabase/supabase-js'
import type { Conversation } from './ConversationsView'
import { CONVERSATION_SELECT, mapConversation } from './conversationsData'
import { ToastProvider } from './Toast'

function playNotificationSound() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.15, ctx.currentTime)
    osc.start()
    osc.stop(ctx.currentTime + 0.15)
  } catch {
    // Si el navegador bloquea el audio (sin interacción previa), no pasa nada.
  }
}


export default function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  )
}

function AppContent() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [theme, setTheme] = useState<string>('dark')
  const [view, setView] = useState<'inbox' | 'admin'>('inbox')
  const [operatorName, setOperatorName] = useState('Operador')
  const [operatorId, setOperatorId] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [operatorPresence, setOperatorPresence] = useState<'available' | 'offline' | 'busy'>('offline')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [passwordRecovery, setPasswordRecovery] = useState(false)
  const [muted, setMuted] = useState(() => localStorage.getItem('notificationsMuted') === 'true')
  const [loggedOutForInactivity, setLoggedOutForInactivity] = useState(false)
  const lastActivityRef = useRef<number>(Date.now())
  const [operatorNames, setOperatorNames] = useState<Map<string, string>>(new Map())
  const operatorNamesRef = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return

    supabase
      .from('operators')
      .select('id, full_name, is_admin, is_superadmin, presence, theme_preference')
      .eq('auth_user_id', session.user.id)
      .single()
      .then(({ data, error }) => {
        if (error) {
          console.error('No se pudo cargar el operador:', error.message)
          return
        }
        if (data) {
          setOperatorId(data.id)
          setOperatorName(data.full_name ?? 'Operador')
          setIsAdmin(data.is_admin ?? false)
          setIsSuperAdmin(data.is_superadmin ?? false)
          setOperatorPresence(data.presence ?? 'offline')
          setTheme(data.theme_preference ?? 'dark')
        }
      })
  }, [session])

  // Nombres de operadores para poder resolver "assignedToName" en las
  // actualizaciones en vivo sin tener que volver a pedir la conversación
  // entera con el join — es una tabla chica que casi no cambia.
  useEffect(() => {
    if (!session) return
    supabase
      .from('operators')
      .select('id, full_name')
      .then(({ data, error }) => {
        if (error) {
          console.error('No se pudieron cargar los nombres de operadores:', error.message)
          return
        }
        const map = new Map<string, string>()
        for (const o of data ?? []) map.set(o.id, o.full_name ?? '')
        setOperatorNames(map)
      })
  }, [session])

  useEffect(() => {
    operatorNamesRef.current = operatorNames
  }, [operatorNames])

  async function toggleOwnPresence() {
    if (!operatorId) return
    const next = operatorPresence === 'available' ? 'offline' : 'available'
    setOperatorPresence(next)
    await supabase.from('operators').update({ presence: next }).eq('id', operatorId)
  }

  // Solo trae lo activo (no cerrado) — el trabajo del día a día. El
  // historial cerrado se consulta aparte, por contacto (panel de
  // contacto) o por búsqueda, no de arranque acá. El límite de 300 es
  // un techo de seguridad, no algo que se espere alcanzar en el uso normal.
  const loadConversations = useCallback(() => {
    if (!session) return
    supabase
      .from('conversations')
      .select(CONVERSATION_SELECT)
      .neq('status', 'cerrada')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1000)
      .then(({ data, error }) => {
        if (error) {
          console.error('No se pudieron cargar las conversaciones:', error.message)
          return
        }
        if ((data ?? []).length >= 1000) {
          // Si llegamos justo al techo, hay que asumir que se está
          // cortando algo real — con este volumen de operadores/
          // vehículos conviene pasar esta lista a un fetch por
          // operador en vez de una lista global compartida.
          console.warn(
            'loadConversations llegó al límite de 1000 — puede haber conversaciones activas que no se estén mostrando. Conviene revisar el volumen real.',
          )
        }
        setConversations((data ?? []).map(mapConversation))
      })
  }, [session])

  // Aplica un UPDATE de "conversations" en vivo a la conversación que ya
  // tenemos en memoria, sin volver a pedir las 1000 filas con sus joins.
  // Solo toca las columnas propias de "conversations" — nombre, teléfono,
  // tags, notas, etc. vienen de "contacts" y no cambian acá, así que se
  // conservan tal cual ya los teníamos.
  function applyConversationPatch(
    prev: Conversation,
    row: Record<string, any>,
    names: Map<string, string>,
  ): Conversation {
    return {
      ...prev,
      channel: row.channel,
      lastMessage: row.last_message_preview ?? '',
      time: row.last_message_at
        ? new Date(row.last_message_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
        : '',
      createdAt: row.created_at,
      snoozedUntil: row.snoozed_until ?? null,
      lastContactMessageAt: row.last_contact_message_at ?? null,
      keepWithOperator: row.keep_with_operator ?? false,
      needsAssignment: row.needs_assignment ?? true,
      unread: row.unread,
      status: row.status,
      assignedOperatorId: row.assigned_operator_id,
      assignedToName: row.assigned_operator_id ? names.get(row.assigned_operator_id) ?? prev.assignedToName : null,
      team: row.team,
    }
  }

  // Trae una sola conversación completa (con sus joins) y la agrega a la
  // lista si todavía no está — para cuando llega una realmente nueva, o
  // se reabre una que no teníamos cargada.
  function fetchAndAddConversation(id: string) {
    supabase
      .from('conversations')
      .select(CONVERSATION_SELECT)
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) return
        const mapped = mapConversation(data)
        setConversations((prev) => (prev.some((c) => c.id === mapped.id) ? prev : [mapped, ...prev]))
      })
  }

  // Carga inicial + se mantiene al día en vivo (conversaciones nuevas,
  // reasignadas, cerradas, o con mensajes nuevos de cualquier canal).
  useEffect(() => {
    if (!session) return
    loadConversations()

    // OJO: antes había también una suscripción aparte a "cada mensaje
    // nuevo de cualquier conversación" (sin filtrar, a TODOS los
    // operadores conectados) — pero cada mensaje que entra ya toca la
    // fila de "conversations" (last_message_at, vista/no vista,
    // clasificación), así que esa segunda suscripción era redundante:
    // duplicaba el aviso y multiplicaba la cantidad de mensajes de
    // Realtime que consume el proyecto, sin agregar nada que esta de
    // acá abajo no cubra ya.
    //
    // ANTES: cualquier cambio en CUALQUIER conversación de la empresa
    // (de cualquier operador) volvía a pedir las 1000 conversaciones
    // ENTERAS, con los joins de contacts/operators, a TODOS los
    // operadores conectados a la vez. Con varios operadores y mensajes
    // entrando todo el día, esto multiplicaba muchísimo la cantidad de
    // requests — es la causa más probable de los picos de Realtime/uso
    // de API que estábamos viendo.
    //
    // AHORA: cada evento se aplica en memoria (sin ir a la base) salvo
    // en los dos casos en que realmente hace falta traer datos que no
    // tenemos: una conversación nueva, o una que se reabre y no
    // estábamos mostrando — ahí se trae SOLO esa fila, no las 1000.
    const channel = supabase
      .channel('conversations-list')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversations' }, (payload) => {
        const row = payload.new as Record<string, any>
        if (row.status === 'cerrada') return
        fetchAndAddConversation(row.id)
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations' }, (payload) => {
        const row = payload.new as Record<string, any>

        if (row.status === 'cerrada') {
          // La lista activa nunca incluye cerradas.
          setConversations((prev) => prev.filter((c) => c.id !== row.id))
          return
        }

        setConversations((prev) => {
          const idx = prev.findIndex((c) => c.id === row.id)
          if (idx === -1) {
            // No la teníamos (se acaba de reabrir, o había quedado
            // afuera del límite de 1000) — recién acá hace falta traerla.
            fetchAndAddConversation(row.id)
            return prev
          }
          const next = [...prev]
          next[idx] = applyConversationPatch(next[idx], row, operatorNamesRef.current)
          return next
        })
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'conversations' }, (payload) => {
        const oldRow = payload.old as Record<string, any>
        setConversations((prev) => prev.filter((c) => c.id !== oldRow.id))
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [session, loadConversations])

  // Sonido + notificación del navegador cuando llega un mensaje nuevo de un cliente
  useEffect(() => {
    if (!session || !operatorId) return
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }

    // Antes esto escuchaba TODOS los mensajes de TODOS los clientes, sin
    // filtrar, y por cada uno hacía una consulta aparte a "conversations"
    // solo para chequear si era mío — con varios operadores conectados,
    // cada mensaje de cualquier cliente generaba un evento de Realtime +
    // una consulta a la base POR CADA operador conectado, casi todas
    // descartadas al toque. Eso suma bastante al uso de Supabase sin
    // necesidad.
    //
    // Ahora se filtra directo por "assigned_operator_id" — Realtime SÍ
    // puede filtrar esto del lado del servidor porque es una columna
    // propia de la tabla a la que nos suscribimos (no hace falta cruzar
    // con "messages"), así que Supabase ya me manda solo lo que me toca,
    // sin la consulta extra. "conversations.last_contact_message_at" se
    // actualiza solo con cada mensaje real del cliente (trigger ya
    // existente), así que alcanza con mirar ese campo.
    const channel = supabase
      .channel(`my-new-messages-${operatorId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'conversations',
          filter: `assigned_operator_id=eq.${operatorId}`,
        },
        (payload) => {
          if (muted) return

          // "last_contact_message_at" puede venir en updates que no son
          // un mensaje nuevo (por ejemplo, reasignación) — se chequea que
          // sea reciente (últimos 10s) para no sonar de más en esos casos.
          const lastContactAt = payload.new.last_contact_message_at as string | null
          if (!lastContactAt) return
          if (Date.now() - new Date(lastContactAt).getTime() > 10_000) return

          playNotificationSound()
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('Mensaje nuevo', {
              body: String(payload.new.last_message_preview ?? '').slice(0, 120),
            })
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [session, muted, operatorId])

  useEffect(() => {
    // Sin sesión (login, o recién cerraste sesión) siempre va en oscuro,
    // sin importar qué tema tenía elegido el último operador que usó
    // esta compu — si no, el logo puede quedar sobre un fondo claro que
    // no lo hace lucir bien.
    if (!session) {
      setTheme('dark')
      return
    }
  }, [session])

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.removeAttribute('data-theme')
    } else {
      document.documentElement.setAttribute('data-theme', theme)
    }
  }, [theme])

  // --- Auto-logout por inactividad -----------------------------------
  // Pedido puntual: si pasan 30 minutos sin que el operador mande un
  // mensaje (no actividad genérica de mouse/teclado, sino su propia
  // participación en la mensajería), se cierra la sesión sola y se
  // avisa en pantalla. Esto también ayuda a bajar la cantidad de
  // conexiones de Realtime abiertas de operadores que quedaron
  // logueados pero inactivos.
  useEffect(() => {
    function markActivity() {
      lastActivityRef.current = Date.now()
    }
    window.addEventListener('operator-activity', markActivity)
    return () => window.removeEventListener('operator-activity', markActivity)
  }, [])

  // Arranca el contador limpio en cada sesión nueva (login).
  useEffect(() => {
    if (session) {
      lastActivityRef.current = Date.now()
      setLoggedOutForInactivity(false)
    }
  }, [session])

  useEffect(() => {
    if (!session) return

    const INACTIVITY_LIMIT_MS = 30 * 60 * 1000 // 30 minutos

    const interval = setInterval(() => {
      if (Date.now() - lastActivityRef.current >= INACTIVITY_LIMIT_MS) {
        setLoggedOutForInactivity(true)
        supabase.auth.signOut()
      }
    }, 30_000) // chequear cada 30s alcanza, no hace falta más seguido

    return () => clearInterval(interval)
  }, [session])

  async function changeTheme(next: string) {
    setTheme(next)
    if (operatorId) {
      await supabase.from('operators').update({ theme_preference: next }).eq('id', operatorId)
    }
  }

  function toggleMuted() {
    setMuted((m) => {
      const next = !m
      localStorage.setItem('notificationsMuted', next ? 'true' : 'false')
      return next
    })
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-asphalt text-muted">
        Cargando...
      </div>
    )
  }

  if (!session) {
    return (
      <>
        {loggedOutForInactivity && (
          <div className="fixed inset-x-0 top-0 z-50 bg-mustard px-4 py-2 text-center text-sm font-medium text-asphalt">
            Se cerró tu sesión por inactividad (30 minutos sin mandar mensajes). Volvé a iniciar sesión para continuar.
          </div>
        )}
        <Login />
      </>
    )
  }

  if (passwordRecovery) {
    return <ResetPassword onDone={() => setPasswordRecovery(false)} />
  }

  if (view === 'admin' && isAdmin) {
    return (
      <AdminPanel
        theme={theme}
        onChangeTheme={changeTheme}
        operatorName={operatorName}
        isSuperAdmin={isSuperAdmin}
        onBack={() => setView('inbox')}
        conversations={conversations}
      />
    )
  }

  return (
    <Inbox
      theme={theme}
      onChangeTheme={changeTheme}
      operatorName={operatorName}
      operatorId={operatorId}
      isAdmin={isAdmin}
      isSuperAdmin={isSuperAdmin}
      onOpenAdmin={() => setView('admin')}
      conversations={conversations}
      setConversations={setConversations}
      onRefreshConversations={loadConversations}
      muted={muted}
      onToggleMuted={toggleMuted}
      operatorPresence={operatorPresence}
      onTogglePresence={toggleOwnPresence}
    />
  )
}
