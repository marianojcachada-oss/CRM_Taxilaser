import { CheckCircle2, Circle } from 'lucide-react'

const features = [
  {
    name: 'Clasificación automática de estado',
    status: 'live' as const,
    detail:
      'Corre en la base (trigger sobre "messages"), por reglas de texto. Detecta reclamos, pedidos de información y cierres.',
  },
  {
    name: 'Traducción de mensajes',
    status: 'live' as const,
    detail: 'Conectada a Google Cloud Translation vía Edge Function.',
  },
  {
    name: 'Resumen de intención del cliente',
    status: 'partial' as const,
    detail:
      'Hoy funciona con reglas simples por palabra clave en el panel de contacto. Pasar a un resumen real con Claude (Haiku, más barato) es el siguiente paso natural.',
  },
  {
    name: 'Sugerencia de respuesta al operador',
    status: 'pending' as const,
    detail: 'No construida todavía. Necesita una Edge Function que le pase el hilo a Claude y proponga una respuesta.',
  },
  {
    name: 'Copiloto conversacional (chat con la IA sobre el caso)',
    status: 'pending' as const,
    detail: 'No construido. Es la pieza más grande de esta sección.',
  },
]

const statusLabel = {
  live: { label: 'En funcionamiento', icon: <CheckCircle2 size={14} className="text-available" />, color: 'text-available' },
  partial: { label: 'Parcial (mock)', icon: <Circle size={14} className="text-warning" />, color: 'text-warning' },
  pending: { label: 'Pendiente', icon: <Circle size={14} className="text-muted" />, color: 'text-muted' },
}

export default function AISection() {
  return (
    <div className="flex flex-col gap-3">
      {features.map((f) => (
        <div key={f.name} className="rounded-sm border border-panel-light bg-panel p-4">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-medium">{f.name}</span>
            <span className={`flex items-center gap-1.5 text-xs ${statusLabel[f.status].color}`}>
              {statusLabel[f.status].icon} {statusLabel[f.status].label}
            </span>
          </div>
          <p className="text-xs text-muted">{f.detail}</p>
        </div>
      ))}
    </div>
  )
}
