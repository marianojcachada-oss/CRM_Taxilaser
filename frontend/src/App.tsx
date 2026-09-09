import { useCallback, useEffect, useState } from 'react'
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
      .limit(300)
      .then(({ data, error }) => {
        if (error) {
          console.error('No se pudieron cargar las conversaciones:', error.message)
          return
        }
        setConversations((data ?? []).map(mapConversation))
      })
  }, [session])

  // Carga inicial + se mantiene al día en vivo (conversaciones nuevas,
  // reasignadas, cerradas, o con mensajes nuevos de cualquier canal).
  useEffect(() => {
    if (!session) return
    loadConversations()

    const channel = supabase
      .channel('conversations-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, loadConversations)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, loadConversations)
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [session, loadConversations])

  // Sonido + notificación del navegador cuando llega un mensaje nuevo de un cliente
  useEffect(() => {
    if (!session) return
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }

    const channel = supabase
      .channel('new-messages-notify')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: 'sender_type=eq.contact' },
        async (payload) => {
          if (muted) return

          // Solo suena si el mensaje cayó en una conversación asignada A
          // MÍ — no es un sonido universal para todo el equipo por cada
          // mensaje que entra, sea de quien sea.
          const { data: conv } = await supabase
            .from('conversations')
            .select('assigned_operator_id')
            .eq('id', payload.new.conversation_id)
            .maybeSingle()

          if (conv?.assigned_operator_id !== operatorId) return

          playNotificationSound()
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('Mensaje nuevo', { body: String(payload.new.content ?? '').slice(0, 120) })
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

  if (!session) return <Login />

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
