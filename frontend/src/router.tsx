// Este archivo exporta `router` (no un componente) junto con las
// pantallas/guards, a propósito: así todo el enrutamiento queda en un
// solo lugar. Lo único que se pierde es el Fast Refresh de ESTE archivo
// en desarrollo (al editarlo, Vite recarga la página entera).
/* eslint-disable react-refresh/only-export-components */
import { useState } from 'react'
import { createBrowserRouter, Navigate, Outlet, useLocation, useMatch, useNavigate, useOutletContext } from 'react-router-dom'
import App, { type AppContext } from './App'
import Login from './Login'
import ResetPassword from './ResetPassword'
import Inbox from './Inbox'
import AdminPanel from './AdminPanel'
import MetricsPage from './MetricsPage'
import { supabase } from './supabaseClient'

// Router centralizado. App (la ruta raíz) tiene toda la lógica global —
// sesión, operador, Realtime, inactividad — y se la pasa a estas rutas
// con <Outlet context>. Acá solo se decide QUÉ pantalla va en cada URL
// y quién puede entrar.
//
//   /login                      Login
//   /reset-password             ResetPassword (necesita la sesión del link del mail)
//   /                           Inbox: Conversaciones
//   /contactos                  Inbox: Contactos
//   /chat-interno/:canal        Inbox: chat interno (managers solo admins)
//   /llamadas-perdidas          Inbox: Llamadas perdidas
//   /admin/:section?            AdminPanel (isAdmin)
//   /metrics                    MetricsPage (canViewMetrics)

function useAppContext() {
  return useOutletContext<AppContext>()
}

// Lo que viaja en `location.state`: `from` = a dónde quería entrar
// cuando lo mandamos a /login; `accessDenied` = aviso para la bandeja.
type RouteState = { from?: string; accessDenied?: string }

function readRouteState(state: unknown): RouteState {
  return state && typeof state === 'object' ? (state as RouteState) : {}
}

function FullScreenLoader() {
  return <div className="flex h-screen items-center justify-center bg-asphalt text-muted">Cargando...</div>
}

// --- Guards ----------------------------------------------------------
// OJO: un <Outlet /> sin `context` NO hereda el del padre (le pasa
// undefined a los hijos) — por eso cada guard reenvía el contexto.

// /, /admin, /metrics: sin sesión -> /login (guardando a dónde iba).
// Durante PASSWORD_RECOVERY la sesión existe, pero hasta elegir la
// contraseña nueva solo puede estar en /reset-password.
function RequireAuth() {
  const ctx = useAppContext()
  const location = useLocation()
  if (!ctx.session) {
    // pathname + search, NO el hash: en los links de Supabase el hash
    // puede traer tokens.
    const state: RouteState = { from: location.pathname + location.search }
    return <Navigate to="/login" replace state={state} />
  }
  if (ctx.passwordRecovery) return <Navigate to="/reset-password" replace />
  return <Outlet context={ctx} />
}

// Espera a que lleguen los permisos del operador (si no, un F5 en
// /admin rebotaba a / antes de saber si es admin) y, sin permiso,
// manda a / con el aviso de acceso denegado.
function RequirePermission({ permission }: { permission: 'admin' | 'metrics' }) {
  const ctx = useAppContext()
  if (!ctx.operatorReady) return <FullScreenLoader />
  const allowed = permission === 'admin' ? ctx.isAdmin : ctx.canViewMetrics
  if (!allowed) {
    const state: RouteState = {
      accessDenied:
        permission === 'admin'
          ? 'Tu cuenta no tiene permiso para entrar al Panel de Administración — te dejamos en Mensajería.'
          : 'Tu cuenta no tiene permiso para entrar a Administración — te dejamos en Mensajería.',
    }
    return <Navigate to="/" replace state={state} />
  }
  return <Outlet context={ctx} />
}

// --- Pantallas -------------------------------------------------------

// /login. Con sesión no se muestra: va a /reset-password si está en
// recuperación, a /metrics si eligió "Administración" en el selector,
// si no a donde quería entrar (`from`) o a /.
function LoginRoute() {
  const ctx = useAppContext()
  const location = useLocation()
  // Vive acá (no en App) porque solo le importa al Login: se resetea
  // solo cada vez que se vuelve a montar la pantalla.
  const [intent, setIntent] = useState<'mensajeria' | 'administracion'>('mensajeria')

  if (ctx.session) {
    const { from } = readRouteState(location.state)
    // Solo rutas internas ("//algo" sería una URL de otro dominio).
    const safeFrom = from && from.startsWith('/') && !from.startsWith('//') && !from.startsWith('/login') ? from : null
    const to = ctx.passwordRecovery ? '/reset-password' : intent === 'administracion' ? '/metrics' : (safeFrom ?? '/')
    return <Navigate to={to} replace />
  }

  return (
    <>
      {ctx.loggedOutForInactivity && (
        <div className="fixed inset-x-0 top-0 z-50 bg-mustard px-4 py-2 text-center text-sm font-medium text-asphalt">
          Se cerró tu sesión por inactividad (10 minutos sin uso). Volvé a iniciar sesión para continuar.
        </div>
      )}
      <Login onIntentChange={setIntent} />
    </>
  )
}

// updateUser necesita la sesión temporal del link del mail de Supabase.
function ResetPasswordRoute() {
  const ctx = useAppContext()
  if (!ctx.session) return <Navigate to="/login" replace />
  return <ResetPassword onDone={ctx.finishPasswordRecovery} />
}

// El aviso rojo de acceso denegado, alimentado por el state que deja
// RequirePermission al rebotar.
function AccessDeniedBanner() {
  const location = useLocation()
  const navigate = useNavigate()
  const { accessDenied } = readRouteState(location.state)
  if (!accessDenied) return null
  return (
    <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 bg-alert px-4 py-2 text-center text-sm font-medium text-cream">
      {accessDenied}
      <button
        // Limpia el state de esta entrada del historial — si no, el
        // aviso volvería a aparecer con F5 o con atrás/adelante.
        onClick={() => navigate(location.pathname + location.search, { replace: true, state: null })}
        className="rounded-sm bg-asphalt/30 px-3 py-1 text-xs font-semibold text-cream hover:bg-asphalt/50"
      >
        Entendido
      </button>
    </div>
  )
}

// Layout de /, /contactos, /chat-interno/:canal y /llamadas-perdidas: el
// Inbox queda MONTADO al moverse entre ellas (no pierde filtro, búsqueda
// ni conversación abierta) y lee la vista de la URL.
function InboxRoute() {
  const ctx = useAppContext()
  const navigate = useNavigate()
  const managersChat = useMatch('/chat-interno/managers')

  // El canal de Managers es solo para admins. Se decide recién con los
  // permisos cargados — antes isAdmin es false para todos.
  if (managersChat && ctx.operatorReady && !ctx.isAdmin) return <Navigate to="/" replace />

  return (
    <>
      <AccessDeniedBanner />
      <Inbox
        theme={ctx.theme}
        onChangeTheme={ctx.changeTheme}
        chatPattern={ctx.chatPattern}
        onChangeChatPattern={ctx.changeChatPattern}
        font={ctx.font}
        onChangeFont={ctx.changeFont}
        operatorName={ctx.operatorName}
        operatorId={ctx.operatorId}
        isAdmin={ctx.isAdmin}
        isSuperAdmin={ctx.isSuperAdmin}
        onOpenAdmin={() => navigate('/admin')}
        conversations={ctx.conversations}
        setConversations={ctx.setConversations}
        onRefreshConversations={ctx.loadConversations}
        muted={ctx.muted}
        onToggleMuted={ctx.toggleMuted}
        operatorPresence={ctx.operatorPresence}
        onSetPresence={ctx.setOwnPresence}
      />
    </>
  )
}

function AdminRoute() {
  const ctx = useAppContext()
  const navigate = useNavigate()
  return (
    <AdminPanel
      theme={ctx.theme}
      onChangeTheme={ctx.changeTheme}
      operatorName={ctx.operatorName}
      isSuperAdmin={ctx.isSuperAdmin}
      onBack={() => navigate('/')}
      conversations={ctx.conversations}
    />
  )
}

function MetricsRoute() {
  const ctx = useAppContext()
  const navigate = useNavigate()
  return (
    <MetricsPage
      operatorName={ctx.operatorName}
      onSignOut={() => supabase.auth.signOut()}
      onBackToInbox={() => navigate('/')}
    />
  )
}

export const router = createBrowserRouter([
  {
    element: <App />,
    children: [
      { path: '/login', element: <LoginRoute /> },
      { path: '/reset-password', element: <ResetPasswordRoute /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <InboxRoute />,
            // Sin element: cada hijo solo marca qué URL es válida; el
            // Inbox (que no tiene <Outlet>) lee la vista de la URL.
            children: [
              { path: '/' },
              { path: '/contactos' },
              { path: '/chat-interno/:canal' },
              { path: '/llamadas-perdidas' },
            ],
          },
          {
            element: <RequirePermission permission="admin" />,
            // `:section?` opcional en UNA sola ruta: cambiar de sección no
            // desmonta el AdminPanel. /admin solo = sección por defecto.
            children: [{ path: '/admin/:section?', element: <AdminRoute /> }],
          },
          {
            element: <RequirePermission permission="metrics" />,
            children: [{ path: '/metrics', element: <MetricsRoute /> }],
          },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
