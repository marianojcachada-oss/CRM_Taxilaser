import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'

// Reloj de Atlanta (America/New_York) para la barra superior. La empresa
// opera en ese huso, así que se muestra esa hora sin importar desde dónde
// mire el operador. Intl se encarga solo de EDT/EST según la fecha.
const TZ = 'America/New_York'
const timeFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
})
const dateFmt = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' })
const zoneFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'short' })

export default function AtlantaClock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const zone = zoneFmt.formatToParts(now).find((p) => p.type === 'timeZoneName')?.value ?? ''

  return (
    <div
      className="hidden items-center gap-2 rounded-full border border-panel-light bg-asphalt px-3 py-1.5 sm:flex"
      title="Hora de Atlanta (America/New_York)"
    >
      <Clock size={13} className="text-mustard" />
      <span className="font-mono text-xs font-semibold tabular-nums text-cream">{timeFmt.format(now)}</span>
      <span className="text-[10px] uppercase tracking-wide text-muted">
        ATL · {zone}
        <span className="hidden xl:inline"> · {dateFmt.format(now)}</span>
      </span>
    </div>
  )
}
