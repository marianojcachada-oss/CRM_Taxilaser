import { useState } from 'react'
import { CircleUserRound, ChevronDown, Volume2, VolumeX, FlaskConical, ShieldCheck, LogOut, Settings } from 'lucide-react'
import SettingsModal from './SettingsModal'

type Props = {
  operatorName: string
  theme: string
  onChangeTheme: (id: string) => void
  // Patrón de fondo del chat — independiente del tema de colores, cada
  // operador elige el suyo (ver index.css, clases .chat-pattern-*).
  chatPattern: string
  onChangeChatPattern: (id: string) => void
  // Tipografía — tercer sibling de preferencias (ver ThemePicker.tsx -> fonts).
  font: string
  onChangeFont: (id: string) => void
  muted: boolean
  onToggleMuted: () => void
  isAdmin: boolean
  onOpenAdmin: () => void
  onOpenSimulator: () => void
  onSignOut: () => void
}

export default function ProfileMenu({
  operatorName,
  theme,
  onChangeTheme,
  chatPattern,
  onChangeChatPattern,
  font,
  onChangeFont,
  muted,
  onToggleMuted,
  isAdmin,
  onOpenAdmin,
  onOpenSimulator,
  onSignOut,
}: Props) {
  const [open, setOpen] = useState(false)
  // Tema, patrón y tipografía se mudaron de este menú a su propia
  // ventana (SettingsModal) — antes eran tres listas largas acá adentro
  // y quedaba todo apretado para scrollear.
  const [showSettings, setShowSettings] = useState(false)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-sm border border-transparent px-1.5 py-1 text-sm text-cream transition-colors hover:border-panel-light"
      >
        <CircleUserRound size={20} className="text-muted" />
        {operatorName}
        <ChevronDown size={13} className="text-muted" />
      </button>

      {open && (
        <>
          {/* Clickear afuera cierra el menú */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-sm border border-panel-light bg-panel p-2 shadow-lg">
            <button
              onClick={() => {
                setOpen(false)
                setShowSettings(true)
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-cream hover:bg-panel-light/60"
            >
              <Settings size={13} /> Configuración
            </button>

            <div className="my-2 border-t border-panel-light" />

            <button
              onClick={onToggleMuted}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-cream hover:bg-panel-light/60"
            >
              {muted ? <VolumeX size={13} className="text-alert" /> : <Volume2 size={13} />}
              {muted ? 'Activar notificaciones' : 'Silenciar notificaciones'}
            </button>

            {isAdmin && (
              <>
                <div className="my-2 border-t border-panel-light" />
                <button
                  onClick={onOpenSimulator}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-cream hover:bg-panel-light/60"
                >
                  <FlaskConical size={13} /> Simular mensaje (testing)
                </button>
                <button
                  onClick={onOpenAdmin}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-mustard hover:bg-panel-light/60"
                >
                  <ShieldCheck size={13} /> Panel Admin
                </button>
              </>
            )}

            <div className="my-2 border-t border-panel-light" />

            <button
              onClick={onSignOut}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-alert hover:bg-alert/10"
            >
              <LogOut size={13} /> Cerrar sesión
            </button>
          </div>
        </>
      )}

      {showSettings && (
        <SettingsModal
          theme={theme}
          onChangeTheme={onChangeTheme}
          chatPattern={chatPattern}
          onChangeChatPattern={onChangeChatPattern}
          font={font}
          onChangeFont={onChangeFont}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}
