import { useEffect } from 'react'
import { X, Settings, Check } from 'lucide-react'
import { themes, chatPatterns, fonts } from './ThemePicker'

type Props = {
  theme: string
  onChangeTheme: (id: string) => void
  chatPattern: string
  onChangeChatPattern: (id: string) => void
  font: string
  onChangeFont: (id: string) => void
  onClose: () => void
}

// Antes esto vivía adentro del menú de perfil (Tema + Patrón + Tipografía,
// una debajo de la otra) y terminaba siendo una lista eterna para scrollear.
// Ahora es su propia ventana, con más aire y la vista previa arriba de
// todo — el menú de perfil solo tiene la entrada "Configuración" que la abre.
export default function SettingsModal({
  theme,
  onChangeTheme,
  chatPattern,
  onChangeChatPattern,
  font,
  onChangeFont,
  onClose,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div role="dialog" aria-modal="true" className="flex max-h-[85vh] w-full max-w-md flex-col rounded-sm border border-panel-light bg-panel">
        <div className="flex items-center justify-between border-b border-panel-light p-4">
          <span className="flex items-center gap-1.5 text-sm font-medium text-mustard">
            <Settings size={14} /> Configuración
          </span>
          <button onClick={onClose} aria-label="Cerrar" className="text-muted hover:text-cream">
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto p-4">
          {/* Vista previa en vivo: combina el tema y el patrón activos —
              se actualiza al toque, sin cerrar la ventana. */}
          <div
            className={`chat-pattern-${chatPattern} relative mb-5 flex h-20 flex-col justify-end gap-1.5 overflow-hidden rounded-sm border border-panel-light p-2`}
          >
            <span
              style={{ fontFamily: fonts.find((f) => f.id === font)?.family }}
              className="w-fit max-w-[75%] rounded-sm bg-panel-light px-2 py-1 text-xs text-cream"
            >
              Hola, ¿cómo va?
            </span>
            <span
              style={{ fontFamily: fonts.find((f) => f.id === font)?.family }}
              className="w-fit max-w-[75%] self-end rounded-sm bg-mustard px-2 py-1 text-xs text-asphalt"
            >
              Todo bien, ¡gracias!
            </span>
          </div>

          <p className="mb-2 text-[10px] uppercase tracking-wide text-muted">Tema</p>
          <div className="mb-5 grid grid-cols-3 gap-1.5">
            {themes.map((t) => (
              <button
                key={t.id}
                onClick={() => onChangeTheme(t.id)}
                className={`relative flex flex-col items-center gap-1 rounded-sm border p-2 text-center transition-colors ${
                  theme === t.id
                    ? 'border-mustard bg-panel-light text-mustard'
                    : 'border-panel-light text-cream hover:bg-panel-light/60'
                }`}
              >
                {theme === t.id && (
                  <Check size={10} className="absolute right-1 top-1 text-mustard" />
                )}
                <span className="flex h-6 w-6 shrink-0 overflow-hidden rounded-full border border-panel-light">
                  <span className="h-full w-1/2" style={{ backgroundColor: t.asphalt }} />
                  <span className="h-full w-1/2" style={{ backgroundColor: t.mustard }} />
                </span>
                <span className="w-full truncate text-[10px]">{t.label}</span>
              </button>
            ))}
          </div>

          <p className="mb-2 text-[10px] uppercase tracking-wide text-muted">Patrón de chat</p>
          <div className="mb-5 grid grid-cols-3 gap-1.5">
            {chatPatterns.map((p) => (
              <button
                key={p.id}
                onClick={() => onChangeChatPattern(p.id)}
                className={`relative flex flex-col items-center gap-1 rounded-sm border p-2 text-center transition-colors ${
                  chatPattern === p.id
                    ? 'border-mustard bg-panel-light text-mustard'
                    : 'border-panel-light text-cream hover:bg-panel-light/60'
                }`}
              >
                {chatPattern === p.id && (
                  <Check size={10} className="absolute right-1 top-1 text-mustard" />
                )}
                <span
                  className={`chat-pattern-${p.id} h-6 w-6 shrink-0 overflow-hidden rounded-sm border border-panel-light`}
                />
                <span className="w-full truncate text-[10px]">{p.label}</span>
              </button>
            ))}
          </div>

          <p className="mb-2 text-[10px] uppercase tracking-wide text-muted">Tipografía</p>
          <div className="flex flex-col gap-1">
            {fonts.map((f) => (
              <button
                key={f.id}
                onClick={() => onChangeFont(f.id)}
                className={`flex w-full items-center justify-between rounded-sm border px-2.5 py-2 text-left text-sm transition-colors ${
                  font === f.id
                    ? 'border-mustard bg-panel-light text-mustard'
                    : 'border-panel-light text-cream hover:bg-panel-light/60'
                }`}
              >
                <span style={{ fontFamily: f.family }} className="truncate">
                  {f.label}
                </span>
                {font === f.id && <Check size={12} className="ml-2 shrink-0 text-mustard" />}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
