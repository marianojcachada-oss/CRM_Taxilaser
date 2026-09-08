import { useState } from 'react'
import { Palette } from 'lucide-react'

export const themes = [
  { id: 'dark', label: 'Que tal? (oscuro)', asphalt: '#0D0D0C', mustard: '#F0BE52' },
  { id: 'light', label: 'Que tal? (claro)', asphalt: '#EDE9E1', mustard: '#C99A2E' },
  { id: 'midnight', label: 'Medianoche', asphalt: '#0B0F14', mustard: '#4FA8F0' },
  { id: 'sand', label: 'Arena', asphalt: '#F5EFE6', mustard: '#D97A22' },
  { id: 'dino', label: 'Dinosaurios', asphalt: '#0F1710', mustard: '#F2903F' },
  { id: 'bordo', label: 'Bordo', asphalt: '#1A0D10', mustard: '#E88BA0' },
  { id: 'tamagotchi', label: 'Tamagotchi', asphalt: '#12181A', mustard: '#FF6FB0' },
  { id: 'pastel', label: 'Pastel', asphalt: '#F3EEF7', mustard: '#A971C4' },
  { id: 'morado', label: 'Morado', asphalt: '#140E1C', mustard: '#A87EF0' },
  { id: 'taxicaller', label: 'TaxiCaller', asphalt: '#0A0A0A', mustard: '#F2C518' },
]

type Props = {
  theme: string
  onChangeTheme: (id: string) => void
}

export default function ThemePicker({ theme, onChangeTheme }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-sm border border-panel-light p-1.5 text-muted transition-colors hover:border-mustard hover:text-mustard"
        title="Elegir tema"
      >
        <Palette size={14} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-sm border border-panel-light bg-panel p-2 shadow-lg">
          {themes.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                onChangeTheme(t.id)
                setOpen(false)
              }}
              className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors ${
                theme === t.id ? 'bg-panel-light text-mustard' : 'text-cream hover:bg-panel-light/60'
              }`}
            >
              <span className="flex h-4 w-4 shrink-0 overflow-hidden rounded-full border border-panel-light">
                <span className="h-full w-1/2" style={{ backgroundColor: t.asphalt }} />
                <span className="h-full w-1/2" style={{ backgroundColor: t.mustard }} />
              </span>
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
