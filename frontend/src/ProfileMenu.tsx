import { useState } from 'react'
import { CircleUserRound, ChevronDown, Volume2, VolumeX, FlaskConical, ShieldCheck, LogOut, Check } from 'lucide-react'
import { themes } from './ThemePicker'

type Props = {
  operatorName: string
  theme: string
  onChangeTheme: (id: string) => void
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
  muted,
  onToggleMuted,
  isAdmin,
  onOpenAdmin,
  onOpenSimulator,
  onSignOut,
}: Props) {
  const [open, setOpen] = useState(false)

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
            <p className="mb-1 px-2 text-[10px] uppercase tracking-wide text-muted">Tema</p>
            {themes.map((t) => (
              <button
                key={t.id}
                onClick={() => onChangeTheme(t.id)}
                className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors ${
                  theme === t.id ? 'bg-panel-light text-mustard' : 'text-cream hover:bg-panel-light/60'
                }`}
              >
                <span className="flex h-4 w-4 shrink-0 overflow-hidden rounded-full border border-panel-light">
                  <span className="h-full w-1/2" style={{ backgroundColor: t.asphalt }} />
                  <span className="h-full w-1/2" style={{ backgroundColor: t.mustard }} />
                </span>
                {t.label}
                {theme === t.id && <Check size={12} className="ml-auto" />}
              </button>
            ))}

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
    </div>
  )
}
