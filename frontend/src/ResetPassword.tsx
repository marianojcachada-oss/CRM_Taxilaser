import { useState } from 'react'
import { Lock, Eye, EyeOff, Check, X, Loader2 } from 'lucide-react'
import { supabase } from './supabaseClient'
import Logo from './Logo'

type Props = { onDone: () => void }

export default function ResetPassword({ onDone }: Props) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const longEnough = password.length >= 6
  const matches = confirm.length > 0 && password === confirm

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!longEnough) {
      setError('La contraseña debe tener al menos 6 caracteres')
      return
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden')
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (error) setError(error.message)
    else onDone()
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-asphalt px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <Logo size={72} />
          <h1 className="mt-5 text-xl font-semibold text-cream">Nueva contraseña</h1>
          <p className="mt-1 text-center text-sm text-muted">Elegí una contraseña nueva para tu cuenta.</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">Nueva contraseña</label>
            <div className="relative">
              <Lock size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-panel-light bg-panel py-2.5 pl-9 pr-9 text-sm text-cream outline-none transition-colors focus:border-mustard"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted transition-colors hover:text-mustard"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {password.length > 0 && (
              <p className={`mt-1.5 flex items-center gap-1 text-xs ${longEnough ? 'text-available' : 'text-muted'}`}>
                {longEnough ? <Check size={12} /> : <X size={12} />}
                Al menos 6 caracteres
              </p>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">Confirmar contraseña</label>
            <div className="relative">
              <Lock size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-md border border-panel-light bg-panel py-2.5 pl-9 pr-3 text-sm text-cream outline-none transition-colors focus:border-mustard"
              />
            </div>
            {confirm.length > 0 && (
              <p className={`mt-1.5 flex items-center gap-1 text-xs ${matches ? 'text-available' : 'text-alert'}`}>
                {matches ? <Check size={12} /> : <X size={12} />}
                {matches ? 'Coinciden' : 'Todavía no coinciden'}
              </p>
            )}
          </div>

          {error && (
            <p className="rounded-md border border-alert/30 bg-alert/10 px-3 py-2 text-xs text-alert">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 flex items-center justify-center gap-2 rounded-md bg-mustard py-2.5 text-sm font-medium text-asphalt transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading && <Loader2 size={15} className="animate-spin" />}
            {loading ? 'Guardando...' : 'Guardar contraseña'}
          </button>
        </form>
      </div>
    </div>
  )
}
