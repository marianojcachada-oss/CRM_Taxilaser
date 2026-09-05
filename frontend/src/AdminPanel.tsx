import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
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

type Section =
  | 'command-center'
  | 'vehicles'
  | 'metrics'
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
  { id: 'admin', emoji: '🛡️', label: 'Admin' },
]

type Props = {
  theme: string
  onChangeTheme: (id: string) => void
  operatorName: string
  onBack: () => void
  conversations: Conversation[]
}

export default function AdminPanel({ theme, onChangeTheme, operatorName, onBack, conversations }: Props) {
  const [active, setActive] = useState<Section>('command-center')

  return (
    <div className="flex h-screen bg-asphalt text-cream">
      {/* Sidebar */}
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
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActive(item.id)}
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

      {/* Contenido */}
      <main className="flex-1 overflow-y-auto">
        <header className="flex items-center justify-between border-b border-panel-light bg-panel px-6 py-3">
          <h1 className="text-sm font-medium text-cream">
            {navItems.find((n) => n.id === active)?.emoji} {navItems.find((n) => n.id === active)?.label}
          </h1>
          <ThemePicker theme={theme} onChangeTheme={onChangeTheme} />
        </header>

        <div className="p-6">
          {active === 'command-center' && <CommandCenterSection />}
          {active === 'campaigns' && <CampaignsSection />}
          {active === 'automations' && <AutomationsSection />}
          {active === 'ai' && <AISection />}
          {active === 'analytics' && <AnalyticsSection conversations={conversations} />}
          {active === 'team' && <TeamSection />}
          {active === 'templates' && <TemplatesSection />}
          {active === 'channels' && <ChannelsSection />}
          {active === 'integrations' && <IntegrationsSection />}
          {active === 'vehicles' && <VehiclesSection />}
          {active === 'metrics' && <MessageMetricsSection />}
          {active === 'admin' && <AdminSection />}
        </div>
      </main>
    </div>
  )
}
