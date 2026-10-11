import { useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { supabase } from './supabaseClient'
import type { Session } from '@supabase/supabase-js'
import type { Conversation } from './ConversationsView'
import { CONVERSATION_SELECT, mapConversation, applyConversationPatch } from './conversationsData'
import { fonts } from './ThemePicker'
import { ToastProvider } from './Toast'
import { logAppError } from './errorLogging'
import { HEARTBEAT_INTERVAL_MS, sendHeartbeat, signOutOperator } from './operatorPresence'

// Los 3 estados que elige el operador son Disponible / No disponible /
// Apoyo. "No disponible" es el 'offline' de siempre (mismo valor que ya
// usaba el toggle viejo) — lo único nuevo es 'apoyo'. 'busy' se mantiene
// solo por compatibilidad con lo que ya hubiera en la base.
export type Presence = 'available' | 'offline' | 'busy' | 'apoyo'

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


// Todo lo que las rutas de router.tsx necesitan de la lógica global.
// App lo pasa con <Outlet context>, y las rutas lo leen con useAppContext().
export type AppContext = {
  session: Session | null
  passwordRecovery: boolean
  // true cuando ya llegaron los permisos del operador de ESTA sesión —
  // los guards de /admin y /metrics esperan esto antes de decidir.
  operatorReady: boolean
  loggedOutForInactivity: boolean
  finishPasswordRecovery: () => void
  operatorName: string
  operatorId: string | null
  isAdmin: boolean
  isSuperAdmin: boolean
  canViewMetrics: boolean
  theme: string
  changeTheme: (next: string) => void
  chatPattern: string
  changeChatPattern: (next: string) => void
  font: string
  changeFont: (next: string) => void
  conversations: Conversation[]
  setConversations: React.Dispatch<React.SetStateAction<Conversation[]>>
  loadConversations: () => void
  muted: boolean
  toggleMuted: () => void
  operatorPresence: Presence
  setOwnPresence: (next: 'available' | 'offline' | 'apoyo') => Promise<boolean>
}

// Ruta raíz del router (ver router.tsx): está montada mientras dure la
// app, así que los efectos globales (sesión, Realtime, inactividad) no
// se desarman al cambiar de ruta. Las pantallas se renderizan en el
// <Outlet> de abajo.
export default function App() {
  const navigate = useNavigate()
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [theme, setTheme] = useState<string>('dark')
  // Patrón de fondo del chat — preferencia aparte del tema de colores,
  // guardada por operador igual que theme_preference (ver changeTheme).
  const [chatPattern, setChatPattern] = useState<string>('dots')
  // Tipografía — mismo mecanismo que tema y patrón, un sibling más de
  // "configuraciones" por operador (ver ThemePicker.tsx -> fonts).
  const [font, setFont] = useState<string>('plex')
  const [operatorName, setOperatorName] = useState('Operador')
  const [operatorId, setOperatorId] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [canViewMetrics, setCanViewMetrics] = useState(false)
  // De qué usuario son los permisos de arriba (is_admin, can_view_metrics)
  // — los guards de router.tsx esperan a que coincida con la sesión
  // actual antes de decidir, para no rebotar un F5 en /admin antes de
  // tener los datos, ni usar los permisos del operador anterior.
  const [operatorLoadedFor, setOperatorLoadedFor] = useState<string | null>(null)
  const [operatorPresence, setOperatorPresence] = useState<Presence>('offline')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [passwordRecovery, setPasswordRecovery] = useState(false)
  const [muted, setMuted] = useState(() => localStorage.getItem('notificationsMuted') === 'true')
  const [loggedOutForInactivity, setLoggedOutForInactivity] = useState(false)
  const lastActivityRef = useRef<number>(Date.now())
  // Clave de localStorage donde las pestañas del mismo operador comparten
  // su última actividad. Antes cada pestaña llevaba la cuenta sola: una
  // pestaña olvidada en segundo plano llegaba a los 10 min y hacía
  // signOut() — que es global — y deslogueaba también la pestaña en la
  // que el operador SÍ estaba trabajando.
  const activityKeyRef = useRef<string | null>(null)

  // Espejo del estado `conversations` en un ref — se usa SOLO para
  // decidir, de forma sincrónica y sin side-effects dentro de un
  // actualizador de setState, si hace falta pedirle a la base la fila
  // completa (con joins) o si alcanza con pisar en el array local los
  // campos que ya vienen en el propio evento de Realtime. Ver el
  // handler de 'UPDATE' del canal 'conversations-list' más abajo.
  const conversationsRef = useRef<Conversation[]>([])
  useEffect(() => {
    conversationsRef.current = conversations
  }, [conversations])

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
      .select('id, full_name, is_admin, is_superadmin, can_view_metrics, presence, theme_preference, chat_pattern_preference, font_preference')
      .eq('auth_user_id', session.user.id)
      .single()
      .then(({ data, error }) => {
        // Se marca como cargado aunque falle: si no, los guards de
        // /admin y /metrics se quedarían en "Cargando..." para siempre
        // (con error, los permisos quedan en false y lo rebotan a /).
        setOperatorLoadedFor(session.user.id)
        if (error) {
          console.error('No se pudo cargar el operador:', error.message)
          return
        }
        if (data) {
          setOperatorId(data.id)
          setOperatorName(data.full_name ?? 'Operador')
          setIsAdmin(data.is_admin ?? false)
          setIsSuperAdmin(data.is_superadmin ?? false)
          setCanViewMetrics(data.can_view_metrics ?? false)
          setOperatorPresence(data.presence ?? 'offline')
          setTheme(data.theme_preference ?? 'dark')
          setChatPattern(data.chat_pattern_preference ?? 'dots')
          setFont(data.font_preference ?? 'plex')
          // A dónde entra según el selector del Login lo resuelve
          // router.tsx (LoginRoute + RequirePermission), no acá.
        }
      })
    // session?.user?.id (no "session" entero) — mismo motivo que en los
    // demás efectos de más abajo: no hace falta re-traer el operador ni
    // resetear tema/vista en cada refresh de token en segundo plano.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id])

  // Se incrementa con cada cambio manual de presencia — el heartbeat lo
  // usa para no pisar con un valor viejo (pedido antes del click) el
  // estado que el operador acaba de elegir.
  const presenceSeqRef = useRef(0)

  // Reemplaza al viejo toggle binario (Disponible/No disponible) — ahora
  // el operador elige explícitamente entre los 3 estados desde Inbox.
  // Devuelve false si la base no lo aceptó: antes el error se ignoraba
  // y la UI mostraba un estado que la base no tenía.
  async function setOwnPresence(next: 'available' | 'offline' | 'apoyo'): Promise<boolean> {
    if (!operatorId) return false
    const previous = operatorPresence
    const seq = ++presenceSeqRef.current
    setOperatorPresence(next)
    const { error } = await supabase.from('operators').update({ presence: next }).eq('id', operatorId)
    if (error) {
      if (seq === presenceSeqRef.current) setOperatorPresence(previous)
      console.error('No se pudo cambiar la presencia:', error.message)
      logAppError('setOwnPresence', error.message)
      return false
    }
    return true
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
    // OJO: la dependencia es session?.user?.id (string estable), NO el
    // objeto "session" completo — Supabase crea un objeto session NUEVO
    // cada vez que refresca el token en segundo plano (pasa solo, sin
    // que el operador haga nada), aunque sea el mismo usuario. Si esta
    // función dependiera de "session" entero, cambiaría de referencia
    // en cada refresh y arrastraría a TODO lo que depende de ella (el
    // canal de Realtime de abajo) a desarmarse y rearmarse de nuevo sin
    // necesidad — ver el comentario grande en el useEffect del canal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id])

  // Trae y aplica en memoria SOLO la conversación que cambió, en vez de
  // recargar la lista entera (hasta 1000 filas, con contacto y operador
  // asignado adentro) por cada evento.
  //
  // OJO — esto era el consumo más grande de los dos que encontramos en
  // los logs de Supabase (confirmado con export de logs reales): la
  // suscripción de abajo llamaba a loadConversations() COMPLETO en cada
  // insert/update/delete de "conversations" — y esa fila cambia con
  // CADA mensaje nuevo, cada asignación de round robin, cada vez que se
  // marca como leída. Con varios operadores conectados a la vez, eso
  // eran cientos de recargas completas por minuto, cada una trayendo de
  // vuelta hasta 1000 filas con join a contactos — la causa principal
  // de la suba descontrolada en Log Query y Realtime Messages. Acá se
  // pide solo la fila puntual que cambió (un id, no toda la tabla) y se
  // actualiza/inserta/saca del arreglo local a mano.
  const patchConversation = useCallback((id: string) => {
    supabase
      .from('conversations')
      .select(CONVERSATION_SELECT)
      .eq('id', id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          console.error('No se pudo refrescar la conversación:', error.message)
          return
        }
        setConversations((prev) => {
          // Se cerró (o ya no existe): afuera de la bandeja activa si estaba.
          if (!data || data.status === 'cerrada') {
            return prev.some((c) => c.id === id) ? prev.filter((c) => c.id !== id) : prev
          }
          const patched = mapConversation(data)
          const idx = prev.findIndex((c) => c.id === id)
          if (idx === -1) return [patched, ...prev]
          const next = [...prev]
          next[idx] = patched
          return next
        })
      })
  }, [])

  // Aplica un UPDATE de "conversations" SIN pedirle nada a la base,
  // cuando es seguro hacerlo — ver el comentario grande de
  // applyConversationPatch en conversationsData.ts. Si la conversación
  // todavía no está en el estado local (no debería pasar en un UPDATE,
  // pero por las dudas), si cambió a quién está asignada, o si cambió
  // `last_message_at` (CUALQUIER mensaje nuevo — de cliente, de
  // operador, o automático, como el aviso de "unidad asignada" de
  // TaxiCaller), cae al camino de siempre (patchConversation, con su
  // propio fetch) para traer los datos del join actualizados.
  const applyOrPatchConversation = useCallback(
    (row: any) => {
      const existing = conversationsRef.current.find((c) => c.id === row.id)
      if (!existing) {
        patchConversation(row.id)
        return
      }
      const assignedChanged = existing.assignedOperatorId !== (row.assigned_operator_id ?? null)
      const hasNewMessage = (existing.lastMessageAtRaw ?? null) !== (row.last_message_at ?? null)
      if (assignedChanged || hasNewMessage) {
        patchConversation(row.id)
        return
      }
      setConversations((prev) => prev.map((c) => (c.id === row.id ? applyConversationPatch(c, row) : c)))
    },
    [patchConversation],
  )

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
    // OJO #2 — este bug sí llegó a producción: la dependencia de este
    // efecto tiene que ser session?.user?.id, NUNCA "session" entero.
    // Supabase emite un evento de auth (y un objeto "session" con una
    // referencia NUEVA) cada vez que refresca el token en segundo plano
    // — sin que el operador haga nada, puede pasar varias veces por
    // sesión, y más seguido si hay varias pestañas abiertas (se
    // sincronizan entre sí). Con "session" entero como dependencia,
    // cada uno de esos refreshes desarmaba este canal y armaba uno
    // nuevo — y como removeChannel() es asíncrono, durante esa ventana
    // quedaban DOS canales escuchando el mismo evento a la vez. Esto es
    // justo lo que confirmé en los logs que pasaste: una conversación
    // con 3 escrituras reales pero 83 lecturas — cada escritura se
    // procesaba varias veces por canales viejos que no habían terminado
    // de desuscribirse. Con session?.user?.id (un string, no cambia
    // aunque el token se refresque) el canal se arma UNA vez por login
    // real y listo.
    //
    // OJO #3 — nuevo (oct/2026): un UPDATE de "conversations" no
    // siempre necesita volver a pedirle nada a la base. La mayoría de
    // los UPDATE son de bookkeeping (marcar como visto, cerrar/reabrir,
    // pinear, posponer) — no tocan ni a quién está asignada la
    // conversación ni `last_message_at`, así que no pueden haber
    // cambiado los datos de los joins (contacto, operador asignado).
    // Para esos, applyOrPatchConversation pisa el array local con los
    // campos que ya vienen en el propio evento, sin fetch. Para una
    // reasignación o cualquier mensaje nuevo (del cliente, de un
    // operador, o automático — como el aviso de "unidad asignada" de
    // TaxiCaller), sigue pidiendo la fila completa como siempre — ahí sí
    // puede haber cambiado el nombre del operador o los datos de viaje
    // activo del contacto.
    const channel = supabase
      .channel('conversations-list')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversations' }, (payload) => {
        patchConversation((payload.new as { id: string }).id)
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations' }, (payload) => {
        applyOrPatchConversation(payload.new as any)
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'conversations' }, (payload) => {
        const oldRow = payload.old as { id: string }
        setConversations((prev) => prev.filter((c) => c.id !== oldRow.id))
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, loadConversations, patchConversation, applyOrPatchConversation])

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
    // session?.user?.id, no "session" entero — mismo fix que en el canal
    // de conversations-list de más arriba.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, muted, operatorId])

  useEffect(() => {
    // Sin sesión (login, o recién cerraste sesión) siempre va en oscuro,
    // sin importar qué tema tenía elegido el último operador que usó
    // esta compu — si no, el logo puede quedar sobre un fondo claro que
    // no lo hace lucir bien.
    if (!session) {
      setTheme('dark')
      return
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id])

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.removeAttribute('data-theme')
    } else {
      document.documentElement.setAttribute('data-theme', theme)
    }
  }, [theme])

  // La tipografía no depende del tema (no hay un "--font-sans" por tema),
  // así que en vez de un atributo se pisa directo la variable CSS en el
  // elemento raíz — alcanza con esto para que todo lo que ya usa
  // var(--font-sans) cambie de fuente al toque.
  useEffect(() => {
    const family = fonts.find((f) => f.id === font)?.family
    if (family) document.documentElement.style.setProperty('--font-sans', family)
  }, [font])

  // --- Auto-logout por inactividad -----------------------------------
  // Si pasan 10 minutos sin ninguna actividad del operador, se cierra
  // la sesión sola y se avisa en pantalla. Esto también ayuda a bajar
  // la cantidad de conexiones de Realtime abiertas de operadores que
  // quedaron logueados pero inactivos.
  //
  // AJUSTADO (03/10/2026): "actividad" ya NO es cualquier uso de la
  // pantalla (mover el mouse, hacer scroll leyendo, etc.) — eso contaba
  // como actividad a alguien que solo tenía la pantalla abierta sin
  // estar realmente trabajando. Ahora solo cuenta:
  //   1) escribir en un input/textarea/campo editable (cualquiera de la
  //      app, no solo el de responder un chat), y
  //   2) el evento 'operator-activity' — que YA se dispara al mandar un
  //      mensaje, y que ahora el handler de "cambiar de conversación"
  //      seleccionada tiene que disparar también (ver nota más abajo,
  //      no está en este archivo).
  useEffect(() => {
    let lastSharedWrite = 0
    function markActivity() {
      const now = Date.now()
      lastActivityRef.current = now
      // Se comparte con las demás pestañas del mismo operador (ver
      // readLastActivity más abajo). Como mucho una escritura cada 5s —
      // keydown llega por cada tecla.
      const key = activityKeyRef.current
      if (key && now - lastSharedWrite > 5_000) {
        lastSharedWrite = now
        try {
          localStorage.setItem(key, String(now))
        } catch {
          // Sin localStorage (modo privado estricto): queda solo el ref local.
        }
      }
    }
    // keydown + input cubren entre los dos: tipeo normal (keydown) y
    // texto que entra sin tecleo letra por letra -- pegar con el mouse,
    // autocompletar, teclados de celular con IME (input) -- en cualquier
    // input/textarea/campo editable de la app.
    function markActivityIfTyping(e: Event) {
      const target = e.target as HTMLElement | null
      if (!target) return
      const tag = target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) {
        markActivity()
      }
    }
    window.addEventListener('keydown', markActivityIfTyping)
    window.addEventListener('input', markActivityIfTyping, { passive: true })
    window.addEventListener('operator-activity', markActivity)
    return () => {
      window.removeEventListener('keydown', markActivityIfTyping)
      window.removeEventListener('input', markActivityIfTyping)
      window.removeEventListener('operator-activity', markActivity)
    }
  }, [])

  // Arranca el contador limpio en cada sesión nueva (login) — session?.user?.id
  // y no "session" entero: si no, un refresh de token en segundo plano
  // (mismo usuario, objeto nuevo) reseteaba el contador de actividad sin
  // que el operador hiciera nada, lo cual iba en contra de la idea de
  // "solo por inactividad real".
  useEffect(() => {
    activityKeyRef.current = session ? `operatorLastActivityAt:${session.user.id}` : null
    if (session) {
      const now = Date.now()
      lastActivityRef.current = now
      try {
        localStorage.setItem(`operatorLastActivityAt:${session.user.id}`, String(now))
      } catch {
        // ver markActivity
      }
      setLoggedOutForInactivity(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id])

  useEffect(() => {
    if (!session) return

    const INACTIVITY_LIMIT_MS = 10 * 60 * 1000 // 10 minutos
    // Evita que dos ticks disparen el logout dos veces mientras se
    // espera la respuesta de la base.
    let loggingOut = false

    // La actividad más reciente entre esta pestaña y las demás del mismo operador.
    function readLastActivity() {
      let shared = 0
      try {
        const key = activityKeyRef.current
        shared = key ? Number(localStorage.getItem(key)) || 0 : 0
      } catch {
        // ver markActivity
      }
      return Math.max(lastActivityRef.current, shared)
    }

    const interval = setInterval(() => {
      if (loggingOut) return
      if (Date.now() - readLastActivity() < INACTIVITY_LIMIT_MS) return
      loggingOut = true
      // Cierra la sesión de verdad (no alcanza con solo cambiar el
      // estado — dejar la sesión abierta e inactiva es justamente lo
      // que generaba la sobrecarga de conexiones/consultas a Supabase
      // que veníamos corrigiendo). Antes de cerrarla, si el operador
      // se había olvidado de marcarse como no disponible (quedó en
      // "Disponible" o "Apoyo"), lo dejamos como "No disponible" en la
      // base — si no, quedaría "pegado" como disponible para el round
      // robin hasta que alguien lo note, aunque ya no esté conectado.
      //
      // OJO — bug real: antes el update a 'offline' se armaba sin
      // await ni .then(), y el query builder de supabase-js no manda
      // NADA hasta que alguien lo "espera" — o sea que nunca se
      // ejecutaba, y el operador quedaba Disponible igual. Ahora
      // signOutOperator lo espera (con timeout) ANTES de cerrar sesión,
      // y si falla lo registra; el barrido del servidor es el respaldo.
      setLoggedOutForInactivity(true)
      setOperatorPresence('offline')
      // Se navega DESPUÉS del signOut: si se navegara antes, /login
      // todavía vería la sesión y rebotaría de vuelta a /. Se guarda
      // `from` para volver a la misma pantalla al reloguearse.
      const from = window.location.pathname + window.location.search
      signOutOperator('auto-logout por inactividad').finally(() => {
        navigate('/login', { replace: true, state: { from } })
      })
    }, 30_000) // chequear cada 30s alcanza, no hace falta más seguido

    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id])

  // --- Heartbeat de conectividad --------------------------------------
  // Esto NO es actividad del operador (eso es lo de arriba, 10 min sin
  // tipear/mandar): es "esta pestaña sigue abierta y con red". Mientras
  // haya sesión, cada pestaña llama a operator_heartbeat() cada 60s, sin
  // importar si el operador toca algo o no. Si dejan de llegar latidos
  // por más de 4 min (pestaña o navegador cerrados, compu suspendida,
  // sin red, pestaña congelada por el navegador), un job de pg_cron lo
  // pasa a No disponible — ver PARTE H de supabase/schema.sql. Con varias
  // pestañas abiertas, alcanza con que cualquiera siga latiendo.
  //
  // De paso, la respuesta trae la presencia actual de la base: si el
  // barrido (o un admin desde Equipo) lo cambió, la UI se entera.
  useEffect(() => {
    if (!session) return

    let cancelled = false
    let inFlight = false
    let lastOkAt = 0
    let consecutiveFailures = 0

    async function beat() {
      if (inFlight || cancelled) return
      inFlight = true
      const seq = presenceSeqRef.current
      try {
        const presence = await sendHeartbeat()
        lastOkAt = Date.now()
        consecutiveFailures = 0
        // Si en el medio el operador cambió su presencia a mano, este
        // valor ya es viejo — no se pisa.
        if (!cancelled && presence && seq === presenceSeqRef.current) {
          setOperatorPresence(presence)
        }
      } catch (err) {
        consecutiveFailures++
        console.warn('Heartbeat de presencia falló:', err)
        // Un corte breve es normal; 3 seguidos (~3 min, a 1 min de
        // quedar No disponible) ya vale registrarlo. Una vez por racha.
        if (consecutiveFailures === 3) logAppError('operator_heartbeat', err)
      } finally {
        inFlight = false
      }
    }

    // Al volver la red, o al volver a la pestaña (los navegadores frenan
    // los timers de las pestañas en segundo plano), se late enseguida en
    // vez de esperar al próximo tick.
    function beatSoon() {
      if (Date.now() - lastOkAt > 15_000) void beat()
    }
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') beatSoon()
    }

    void beat()
    const interval = setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS)
    window.addEventListener('online', beatSoon)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      cancelled = true
      clearInterval(interval)
      window.removeEventListener('online', beatSoon)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id])

  async function changeTheme(next: string) {
    setTheme(next)
    if (operatorId) {
      await supabase.from('operators').update({ theme_preference: next }).eq('id', operatorId)
    }
  }

  async function changeChatPattern(next: string) {
    setChatPattern(next)
    if (operatorId) {
      await supabase.from('operators').update({ chat_pattern_preference: next }).eq('id', operatorId)
    }
  }

  async function changeFont(next: string) {
    setFont(next)
    if (operatorId) {
      await supabase.from('operators').update({ font_preference: next }).eq('id', operatorId)
    }
  }

  function toggleMuted() {
    setMuted((m) => {
      const next = !m
      localStorage.setItem('notificationsMuted', next ? 'true' : 'false')
      return next
    })
  }

  const context: AppContext = {
    session,
    passwordRecovery,
    operatorReady: !!session && operatorLoadedFor === session.user.id,
    loggedOutForInactivity,
    finishPasswordRecovery: () => {
      setPasswordRecovery(false)
      navigate('/', { replace: true })
    },
    operatorName,
    operatorId,
    isAdmin,
    isSuperAdmin,
    canViewMetrics,
    theme,
    changeTheme,
    chatPattern,
    changeChatPattern,
    font,
    changeFont,
    conversations,
    setConversations,
    loadConversations,
    muted,
    toggleMuted,
    operatorPresence,
    setOwnPresence,
  }

  return (
    <ToastProvider>
      {/* Hasta que getSession() no responde no sabemos si hay sesión — sin
          esto, los guards mandarían a /login a alguien que sí está logueado. */}
      {loading ? (
        <div className="flex h-screen items-center justify-center bg-asphalt text-muted">Cargando...</div>
      ) : (
        <Outlet context={context} />
      )}
    </ToastProvider>
  )
}
