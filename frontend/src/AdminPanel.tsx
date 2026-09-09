import { useState } from 'react'
import { ArrowLeft, Menu, X } from 'lucide-react'
import ThemePicker from './ThemePicker'
import type { Conversation } from './ConversationsView'
import CommandCenterSection from './CommandCenterSection'
import TeamSection from './TeamSection'
import AdminSection from './AdminSection'
import ChannelsSection from './ChannelsSection'
import TemplatesSection from './TemplatesSection'
import AnalyticsSection from './AnalyticsSection'
import AISection from './AISection'
import CampaignsSection from './CampaignsSection'
import AutomationsSection from './AutomationsSection'
import IntegrationsSection from './IntegrationsSection'
import VehiclesSection from './VehiclesSection'
import MessageMetricsSection from './MessageMetricsSection'
import RoundRobinSection from './RoundRobinSection'
import ErrorLogsSection from './ErrorLogsSection'

type Section =
  | 'command-center'
  | 'vehicles'
  | 'metrics'
  | 'roundrobin'
  | 'errors'
  | 'campaigns'
  | 'automations'
  | 'ai'
  | 'analytics'
  | 'team'
  | 'templates'
  | 'channels'
  | 'integrations'
  | 'admin'

const navItems: { id: Section; emoji: string; label: string }[] = [
  { id: 'command-center', emoji: '🏠', label: 'Command Center' },
  { id: 'campaigns', emoji: '📣', label: 'Campaigns' },
  { id: 'automations', emoji: '🔄', label: 'Automations' },
  { id: 'ai', emoji: '🤖', label: 'AI' },
  { id: 'analytics', emoji: '📊', label: 'Analytics' },
  { id: 'team', emoji: '👨‍💼', label: 'Team' },
  { id: 'templates', emoji: '🧩', label: 'Templates' },
  { id: 'channels', emoji: '⚙️', label: 'Channels' },
  { id: 'integrations', emoji: '🔗', label: 'Integrations' },
  { id: 'vehicles', emoji: '🚕', label: 'Vehículos' },
  { id: 'metrics', emoji: '📈', label: 'Métricas de mensajes' },
  { id: 'roundrobin', emoji: '🔁', label: 'Round robin' },
  { id: 'errors', emoji: '🐞', label: 'Errores' },
  { id: 'admin', emoji: '🛡️', label: 'Admin' },
]

type Props = {
  theme: string
  onChangeTheme: (id: string) => void
  operatorName: string
  isSuperAdmin: boolean
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
]

export default function AdminPanel({ theme, onChangeTheme, operatorName, isSuperAdmin, onBack, conversations }: Props) {
  const visibleNavItems = isSuperAdmin
    ? navItems
    : navItems.filter((item) => ADMIN_ALLOWED_SECTIONS.includes(item.id))

  const [active, setActive] = useState<Section>(isSuperAdmin ? 'command-center' : 'analytics')
  const [showMobileNav, setShowMobileNav] = useState(false)

  return (
    <div className="flex h-screen bg-asphalt text-cream">
      {/* Sidebar */}
      <div className={`${showMobileNav ? 'fixed inset-0 z-40 flex' : 'hidden'} md:static md:z-auto md:flex`}>
        <aside className="flex w-56 shrink-0 flex-col border-r border-panel-light bg-panel">
          <div className="border-b border-panel-light px-4 py-3">
            <button
              onClick={onBack}
              className="mb-2 flex items-center gap-1 text-xs text-muted transition-colors hover:text-mustard"
            >
              <ArrowLeft size={13} /> Volver a mensajería
            </button>
            <span className="text-sm font-semibold tracking-tight text-mustard">Panel Admin</span>
          </div>

          <nav className="flex-1 overflow-y-auto py-2">
            {visibleNavItems.map((item) => (
              <button
                key={item.id}
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
            ))}
          </nav>

          <div className="border-t border-panel-light px-4 py-3 text-xs text-muted">{operatorName}</div>
        </aside>
        <div onClick={() => setShowMobileNav(false)} className="flex-1 bg-black/50 md:hidden" />
      </div>

      {/* Contenido */}
      <main className="flex-1 overflow-y-auto">
        <header className="flex items-center justify-between border-b border-panel-light bg-panel px-4 py-3 md:px-6">
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

        <div className="p-4 md:p-6">
          {active === 'command-center' && <CommandCenterSection />}
          {active === 'campaigns' && <CampaignsSection />}
          {active === 'automations' && <AutomationsSection />}
          {active === 'ai' && <AISection />}
          {active === 'analytics' && <AnalyticsSection conversations={conversations} />}
          {active === 'team' && <TeamSection isSuperAdmin={isSuperAdmin} />}
          {active === 'templates' && <TemplatesSection />}
          {active === 'channels' && <ChannelsSection />}
          {active === 'integrations' && <IntegrationsSection readOnly={!isSuperAdmin} />}
          {active === 'vehicles' && <VehiclesSection />}
          {active === 'metrics' && <MessageMetricsSection />}
          {active === 'roundrobin' && <RoundRobinSection />}
          {active === 'errors' && <ErrorLogsSection />}
          {active === 'admin' && <AdminSection />}
        </div>
      </main>
    </div>
  )
}
