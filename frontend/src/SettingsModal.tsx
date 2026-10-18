import { useEffect } from 'react'
import { X, Settings, Check, Play } from 'lucide-react'
import { themes, chatPatterns, fonts } from './ThemePicker'
import { layouts, scales, setLayout, setScale, useLayout, useScale } from './layoutPreference'
import {
  notificationSounds,
  playNotificationSound,
  setNotificationSound,
  useNotificationSound,
} from './notificationSound'

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
  const layout = useLayout()
  const scale = useScale()
  const sound = useNotificationSound()
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

          <p className="mb-2 text-[10px] uppercase tracking-wide text-muted">Diseño de la interfaz</p>
          <div className="mb-1 grid grid-cols-2 gap-1.5">
            {layouts.map((l) => (
              <button
                key={l.id}
                onClick={() => setLayout(l.id)}
                aria-pressed={layout === l.id}
                className={`relative flex flex-col gap-0.5 rounded-sm border p-2.5 text-left transition-colors ${
                  layout === l.id
                    ? 'border-mustard bg-panel-light text-mustard'
                    : 'border-panel-light text-cream hover:bg-panel-light/60'
                }`}
              >
                {layout === l.id && <Check size={10} className="absolute right-1.5 top-1.5 text-mustard" />}
                <span className="text-xs font-medium">{l.label}</span>
                <span className="text-[10px] leading-snug text-muted">{l.description}</span>
              </button>
            ))}
          </div>
          <p className="mb-5 text-[10px] text-muted">Se guarda en este navegador. Los datos y los temas son los mismos.</p>

          <p className="mb-2 text-[10px] uppercase tracking-wide text-muted">Tamaño de la interfaz</p>
          <div className="mb-1 flex flex-wrap gap-1.5">
            {scales.map((sc) => (
              <button
                key={sc.id}
                onClick={() => setScale(sc.id)}
                aria-pressed={scale === sc.id}
                className={`rounded-sm border px-2.5 py-1.5 text-xs transition-colors ${
                  scale === sc.id
                    ? 'border-mustard bg-panel-light text-mustard'
                    : 'border-panel-light text-cream hover:bg-panel-light/60'
                }`}
              >
                {sc.label}
              </button>
            ))}
          </div>
          <p className="mb-5 text-[10px] text-muted">
            Para pantallas grandes o ultra anchas: agranda o achica todo. Automático ajusta solo en monitores muy anchos.
          </p>

          <p className="mb-2 text-[10px] uppercase tracking-wide text-muted">Sonido de notificación</p>
          <div className="mb-1 flex flex-col gap-1">
            {notificationSounds.map((s) => (
              <div
                key={s.id}
                className={`flex items-center gap-1.5 rounded-sm border pr-1.5 transition-colors ${
                  sound === s.id ? 'border-mustard bg-panel-light' : 'border-panel-light hover:bg-panel-light/60'
                }`}
              >
                <button
                  onClick={() => {
                    setNotificationSound(s.id)
                    playNotificationSound(s.id)
                  }}
                  aria-pressed={sound === s.id}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left"
                >
                  <span className="flex h-3 w-3 shrink-0 items-center justify-center">
                    {sound === s.id && <Check size={12} className="text-mustard" />}
                  </span>
                  <span className="min-w-0">
                    <span className={`block truncate text-xs font-medium ${sound === s.id ? 'text-mustard' : 'text-cream'}`}>
                      {s.label}
                    </span>
                    <span className="block truncate text-[10px] text-muted">{s.description}</span>
                  </span>
                </button>
                <button
                  onClick={() => playNotificationSound(s.id)}
                  aria-label={`Escuchar ${s.label}`}
                  title="Escuchar"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-panel-light text-muted transition-colors hover:border-mustard hover:text-mustard"
                >
                  <Play size={11} />
                </button>
              </div>
            ))}
          </div>
          <p className="mb-5 text-[10px] text-muted">
            Es solo para tu usuario. Tocá el play para escuchar antes de elegir. Para silenciar todo usá el botón de notificaciones de la barra superior.
          </p>

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
