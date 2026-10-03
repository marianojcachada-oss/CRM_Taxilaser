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
    const channel = supabase
      .channel('conversations-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, loadConversations)
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
  // Si pasan 10 minutos sin ninguna actividad del operador, se cierra
  // la sesión sola y se avisa en pantalla. Esto también ayuda a bajar
  // la cantidad de conexiones de Realtime abiertas de operadores que
  // quedaron logueados pero inactivos.
  //
  // Ojo: "actividad" tiene que ser cualquier uso real de la pantalla
  // (mouse, teclado, clicks, scroll, touch) — antes solo contaba el
  // evento 'operator-activity' (mandar un mensaje), así que a alguien
  // que estaba activo mirando/organizando conversaciones pero sin
  // mandar un mensaje nuevo cada 10 minutos se lo desconectaba igual,
  // aunque estuviera usando la pantalla sin parar.
  useEffect(() => {
    function markActivity() {
      lastActivityRef.current = Date.now()
    }
    const activityEvents = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'wheel']
    activityEvents.forEach((evt) => window.addEventListener(evt, markActivity, { passive: true }))
    window.addEventListener('operator-activity', markActivity)
    return () => {
      activityEvents.forEach((evt) => window.removeEventListener(evt, markActivity))
      window.removeEventListener('operator-activity', markActivity)
    }
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

    const INACTIVITY_LIMIT_MS = 10 * 60 * 1000 // 10 minutos

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
            Se cerró tu sesión por inactividad (10 minutos sin uso). Volvé a iniciar sesión para continuar.
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
