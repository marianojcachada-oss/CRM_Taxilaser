import { SiWhatsapp, SiFacebook, SiInstagram } from '@icons-pack/react-simple-icons'
import { MessageCircle } from 'lucide-react'

const SUPABASE_PROJECT_REF = 'jamgimsrnoskwjiewjck'

const channels = [
  {
    name: 'WhatsApp',
    icon: <SiWhatsapp size={18} color="#25D366" />,
    status: 'connected' as const,
    detail: 'Vía Meta Cloud API, webhook unificado.',
    endpoint: `https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/meta-webhook`,
  },
  {
    name: 'Facebook Messenger',
    icon: <SiFacebook size={18} color="#1877F2" />,
    status: 'connected' as const,
    detail: 'Vía Meta Cloud API, mismo webhook que WhatsApp.',
    endpoint: `https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/meta-webhook`,
  },
  {
    name: 'Instagram',
    icon: <SiInstagram size={18} color="#E1306C" />,
    status: 'connected' as const,
    detail: 'Vía Meta Cloud API, mismo webhook que WhatsApp.',
    endpoint: `https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/meta-webhook`,
  },
  {
    name: 'SMS (RingCentral)',
    icon: <MessageCircle size={18} color="#FF7A00" />,
    status: 'pending' as const,
    detail: 'El webhook está desplegado, pero falta automatizar el refresh del token de RingCentral.',
    endpoint: `https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/ringcentral-webhook`,
  },
]

export default function ChannelsSection() {
  return (
    <div className="flex flex-col gap-3">
      {channels.map((ch) => (
        <div key={ch.name} className="rounded-sm border border-panel-light bg-panel p-4">
          <div className="mb-1 flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-medium">
              {ch.icon} {ch.name}
            </span>
            <span
              className={`rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                ch.status === 'connected'
                  ? 'border-available/40 text-available'
                  : 'border-warning/40 text-warning'
              }`}
            >
              {ch.status === 'connected' ? 'Conectado' : 'Pendiente'}
            </span>
          </div>
          <p className="mb-1.5 text-xs text-muted">{ch.detail}</p>
          <p className="font-mono text-[10px] text-muted">{ch.endpoint}</p>
        </div>
      ))}
    </div>
  )
}
