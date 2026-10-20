import { Suspense, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, BarChart3, Menu, X } from 'lucide-react'
import ThemePicker from './ThemePicker'
import type { Conversation } from './ConversationsView'
import { lazyWithReload } from './lazyWithReload'

// Cada sección se baja recién cuando se abre.
const CommandCenterSection = lazyWithReload(() => import('./CommandCenterSection'))
const TeamSection = lazyWithReload(() => import('./TeamSection'))
const AdminSection = lazyWithReload(() => import('./AdminSection'))
const ChannelsSection = lazyWithReload(() => import('./ChannelsSection'))
const TemplatesSection = lazyWithReload(() => import('./TemplatesSection'))
const AnalyticsSection = lazyWithReload(() => import('./AnalyticsSection'))
const AISection = lazyWithReload(() => import('./AISection'))
const CampaignsSection = lazyWithReload(() => import('./CampaignsSection'))
const AutomationsSection = lazyWithReload(() => import('./AutomationsSection'))
const IntegrationsSection = lazyWithReload(() => import('./IntegrationsSection'))
const VehiclesSection = lazyWithReload(() => import('./VehiclesSection'))
const MessageMetricsSection = lazyWithReload(() => import('./MessageMetricsSection'))
const RoundRobinSection = lazyWithReload(() => import('./RoundRobinSection'))
const ErrorLogsSection = lazyWithReload(() => import('./ErrorLogsSection'))
const IntegrationHealthSection = lazyWithReload(() => import('./IntegrationHealthSection'))
const ReportsSection = lazyWithReload(() => import('./ReportsSection'))

type Section =
  | 'command-center'
  | 'vehicles'
  | 'metrics'
  | 'roundrobin'
  | 'errors'
  | 'integrationhealth'
  | 'reports'
  | 'campaigns'
  | 'automations'
  | 'ai'
  | 'analytics'
  | 'team'
  | 'templates'
  | 'channels'
  | 'integrations'
  | 'admin'

// Grupos del menú del panel.
const NAV_GROUPS: { label: string; ids: Section[] }[] = [
  { label: 'Operación', ids: ['command-center', 'analytics', 'metrics', 'roundrobin', 'vehicles'] },
  { label: 'Equipo y mensajes', ids: ['team', 'templates', 'channels', 'campaigns', 'automations', 'ai'] },
  { label: 'Sistema', ids: ['integrations', 'integrationhealth', 'errors', 'reports', 'admin'] },
]

const navItems: { id: Section; emoji: string; label: string }[] = [
  { id: 'command-center', emoji: '🏠', label: 'Command Center' },
  { id: 'campaigns', emoji: '📣', label: 'Campaigns' },
  { id: 'automations', emoji: '🔄', label: 'Automations' },
  { id: 'ai', emoji: '🤖', label: 'AI (Valeria)' },
  { id: 'analytics', emoji: '📊', label: 'Analytics' },
  { id: 'team', emoji: '👨‍💼', label: 'Team' },
  { id: 'templates', emoji: '🧩', label: 'Templates' },
  { id: 'channels', emoji: '⚙️', label: 'Channels' },
  { id: 'integrations', emoji: '🔗', label: 'Integrations' },
  { id: 'vehicles', emoji: '🚕', label: 'Vehículos' },
  { id: 'metrics', emoji: '📈', label: 'Métricas de mensajes' },
  { id: 'roundrobin', emoji: '🔁', label: 'Round robin' },
  { id: 'errors', emoji: '🐞', label: 'Errores' },
  { id: 'integrationhealth', emoji: '💓', label: 'Salud de integraciones' },
  { id: 'reports', emoji: '🛟', label: 'Problemas reportados' },
  { id: 'admin', emoji: '🛡️', label: 'Admin' },
]

type Props = {
  theme: string
  onChangeTheme: (id: string) => void
  operatorName: string
  isSuperAdmin: boolean
  // Si tiene el permiso de métricas, el panel muestra un acceso a /metrics.
  canViewMetrics?: boolean
  onBack: () => void
  conversations: Conversation[]
}

// Un admin común (no superadmin) solo ve estas secciones — el resto
// queda reservado para superadmin. Integrations se ve pero en modo
// solo lectura (se resuelve dentro de IntegrationsSection).
const ADMIN_ALLOWED_SECTIONS: Section[] = [
  'analytics',
  'team',
  'templates',
  'roundrobin',
  'errors',
  'metrics',
  'integrations',
  'integrationhealth',
]

export default function AdminPanel({
  theme,
  onChangeTheme,
  operatorName,
  isSuperAdmin,
  canViewMetrics,
  onBack,
  conversations,
}: Props) {
  const visibleNavItems = isSuperAdmin
    ? navItems
    : navItems.filter((item) => ADMIN_ALLOWED_SECTIONS.includes(item.id))

  // La sección sale de la URL (/admin/<sección>) en vez de un useState —
  // F5, atrás/adelante y links directos caen en la misma sección.
  const navigate = useNavigate()
  const { section } = useParams<{ section?: string }>()
  const defaultSection: Section = isSuperAdmin ? 'command-center' : 'analytics'
  const active = (section ?? defaultSection) as Section
  const setActive = (next: Section) => {
    if (next !== active) navigate(`/admin/${next}`)
  }
  const [showMobileNav, setShowMobileNav] = useState(false)

  // Sección inexistente, o reservada a superadmin para un admin común
  // (antes no se podía llegar porque no aparece en el menú; con URLs se
  // puede tipear a mano) -> a la sección por defecto.
  if (!visibleNavItems.some((item) => item.id === active)) {
    return <Navigate to="/admin" replace />
  }

  return (
    <div className="flex h-screen bg-asphalt text-cream">
      {/* Sidebar */}
      <div className={`${showMobileNav ? 'fixed inset-0 z-40 flex' : 'hidden'} md:static md:z-auto md:flex`}>
        <aside className="ui-adminnav flex w-56 shrink-0 flex-col border-r border-panel-light bg-panel">
          <div className="border-b border-panel-light px-4 py-3">
            <button
              onClick={onBack}
              className="mb-2 flex items-center gap-1 text-xs text-muted transition-colors hover:text-mustard"
            >
              <ArrowLeft size={13} /> Volver a mensajería
            </button>
            {canViewMetrics && (
              <button
                onClick={() => navigate('/metrics')}
                className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-sm border border-mustard/50 px-2 py-1.5 text-xs font-medium text-mustard transition-colors hover:bg-mustard hover:text-asphalt"
              >
                <BarChart3 size={13} /> Ir a Métricas
              </button>
            )}
            <span className="text-sm font-semibold tracking-tight text-mustard">Panel Admin</span>
          </div>

          <nav className="ui-adminnav-list flex-1 overflow-y-auto py-2">
            {NAV_GROUPS.flatMap((g) => g.ids.map((id) => ({ group: g.label, item: visibleNavItems.find((n) => n.id === id) })))
              .filter((e): e is { group: string; item: (typeof navItems)[number] } => !!e.item)
              .map(({ group, item }, idx, arr) => (
              <div key={item.id} className="contents">
                {group !== arr[idx - 1]?.group && (
                  <p className="ui-navgroup px-3 pb-1 pt-3 text-[10px] font-extrabold uppercase tracking-[0.13em] text-muted">{group}</p>
                )}
              <button
                data-nav="item"
                data-active={active === item.id ? 'true' : undefined}
                onClick={() => {
                  setActive(item.id)
                  setShowMobileNav(false)
                }}
                className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors ${
                  active === item.id
                    ? 'bg-panel-light text-mustard'
                    : 'text-muted hover:bg-panel-light/60 hover:text-cream'
                }`}
              >
                <span>{item.emoji}</span>
                {item.label}
              </button>
              </div>
            ))}
          </nav>

          <div className="border-t border-panel-light px-4 py-3 text-xs text-muted">{operatorName}</div>
        </aside>
        <div onClick={() => setShowMobileNav(false)} className="flex-1 bg-black/50 md:hidden" />
      </div>

      {/* Contenido */}
      <main className="ui-admin flex-1 overflow-y-auto">
        <header className="ui-adminhead flex items-center justify-between border-b border-panel-light bg-panel px-4 py-3 md:px-6">
          <div className="flex items-center gap-3">
            <button onClick={() => setShowMobileNav(true)} className="text-cream md:hidden">
              <Menu size={20} />
            </button>
            <h1 className="text-sm font-medium text-cream">
              {navItems.find((n) => n.id === active)?.emoji} {navItems.find((n) => n.id === active)?.label}
            </h1>
          </div>
          <ThemePicker theme={theme} onChangeTheme={onChangeTheme} />
        </header>

        <div className="ui-admin-content p-4 md:p-6">
          <Suspense fallback={<p className="text-sm text-muted">Cargando…</p>}>
          {active === 'command-center' && <CommandCenterSection />}
          {active === 'campaigns' && <CampaignsSection />}
          {active === 'automations' && <AutomationsSection />}
          {active === 'ai' && <AISection readOnly={!isSuperAdmin} />}
          {active === 'analytics' && <AnalyticsSection conversations={conversations} />}
          {active === 'team' && <TeamSection isSuperAdmin={isSuperAdmin} />}
          {active === 'templates' && <TemplatesSection />}
          {active === 'channels' && <ChannelsSection />}
          {active === 'integrations' && <IntegrationsSection readOnly={!isSuperAdmin} />}
          {active === 'vehicles' && <VehiclesSection />}
          {active === 'metrics' && <MessageMetricsSection />}
          {active === 'roundrobin' && <RoundRobinSection />}
          {active === 'errors' && <ErrorLogsSection />}
          {active === 'integrationhealth' && <IntegrationHealthSection />}
          {active === 'reports' && <ReportsSection />}
          {active === 'admin' && <AdminSection />}
          </Suspense>
        </div>
      </main>
    </div>
  )
}
