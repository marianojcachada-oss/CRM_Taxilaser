import { useState } from 'react'
import { Mail, Lock, Eye, EyeOff, ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react'
import { supabase } from './supabaseClient'
import Logo from './Logo'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [showForgot, setShowForgot] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotSent, setForgotSent] = useState(false)
  const [forgotError, setForgotError] = useState<string | null>(null)
  const [forgotLoading, setForgotLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    // Importante: esto tiene que setearse ANTES de signInWithPassword,
    // porque supabase-js guarda la sesión apenas responde el login.
    localStorage.setItem('rememberMe', remember ? 'true' : 'false')

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    setLoading(false)
    if (error) setError('Email o contraseña incorrectos')
  }

  async function handleForgotSubmit(e: React.FormEvent) {
    e.preventDefault()
    setForgotError(null)
    setForgotLoading(true)

    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: window.location.origin,
    })

    setForgotLoading(false)
    if (error) setForgotError(error.message)
    else setForgotSent(true)
  }

  return (
    <div className="flex min-h-screen bg-asphalt">
      {/* Panel de marca — se oculta en pantallas chicas */}
      <div className="relative hidden flex-1 flex-col items-center justify-center overflow-hidden bg-panel md:flex">
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              'repeating-linear-gradient(135deg, var(--color-mustard) 0px, var(--color-mustard) 2px, transparent 2px, transparent 26px)',
          }}
        />
        <div className="relative flex flex-col items-center px-10 text-center">
          <Logo size={96} />
          <h1 className="mt-6 text-2xl font-semibold text-cream">Qué tal?</h1>
          <p className="mt-2 text-sm text-muted">Panel de operadores — mensajería y despacho</p>
        </div>
      </div>

      {/* Panel del formulario */}
      <div className="flex w-full flex-1 items-center justify-center px-6 py-12 md:max-w-md">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center md:hidden">
            <Logo size={64} />
          </div>

          {!showForgot ? (
            <>
              <h2 className="mb-1 text-xl font-semibold text-cream">Ingresá a tu cuenta</h2>
              <p className="mb-8 text-sm text-muted">Usá tu email y contraseña de operador</p>

              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted">Email</label>
                  <div className="relative">
                    <Mail size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                    <input
                      type="email"
                      required
                      autoFocus
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="tu@taxilaserllc.com"
                      className="w-full rounded-md border border-panel-light bg-asphalt py-2.5 pl-9 pr-3 text-sm text-cream placeholder-muted/50 outline-none transition-colors focus:border-mustard"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted">Contraseña</label>
                  <div className="relative">
                    <Lock size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-md border border-panel-light bg-asphalt py-2.5 pl-9 pr-9 text-sm text-cream outline-none transition-colors focus:border-mustard"
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
                </div>

                <div className="flex items-center justify-between text-xs">
                  <label className="flex cursor-pointer items-center gap-1.5 text-muted">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                      className="h-3.5 w-3.5 accent-[var(--color-mustard)]"
                    />
                    Recordarme
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowForgot(true)}
                    className="font-medium text-muted transition-colors hover:text-mustard"
                  >
                    ¿Olvidaste tu contraseña?
                  </button>
                </div>

                {error && (
                  <p className="rounded-md border border-alert/30 bg-alert/10 px-3 py-2 text-xs text-alert">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="mt-2 flex items-center justify-center gap-2 rounded-md bg-mustard py-2.5 text-sm font-medium text-asphalt transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {loading && <Loader2 size={15} className="animate-spin" />}
                  {loading ? 'Ingresando...' : 'Ingresar'}
                </button>
              </form>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setShowForgot(false)
                  setForgotSent(false)
                  setForgotError(null)
                }}
                className="mb-6 flex items-center gap-1 text-xs font-medium text-muted transition-colors hover:text-mustard"
              >
                <ArrowLeft size={13} /> Volver al login
              </button>

              <h2 className="mb-1 text-xl font-semibold text-cream">Recuperar contraseña</h2>
              <p className="mb-8 text-sm text-muted">
                Ingresá tu email y te mandamos instrucciones para restablecerla.
              </p>

              {forgotSent ? (
                <div className="flex items-start gap-2.5 rounded-md border border-available/30 bg-available/10 px-3.5 py-3 text-sm text-available">
                  <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
                  <span>Listo — revisá tu correo (incluyendo spam) para continuar.</span>
                </div>
              ) : (
                <form onSubmit={handleForgotSubmit} className="flex flex-col gap-4">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted">Email</label>
                    <div className="relative">
                      <Mail size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                      <input
                        type="email"
                        required
                        autoFocus
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                        className="w-full rounded-md border border-panel-light bg-asphalt py-2.5 pl-9 pr-3 text-sm text-cream outline-none transition-colors focus:border-mustard"
                      />
                    </div>
                  </div>

                  {forgotError && (
                    <p className="rounded-md border border-alert/30 bg-alert/10 px-3 py-2 text-xs text-alert">
                      {forgotError}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={forgotLoading}
                    className="mt-1 flex items-center justify-center gap-2 rounded-md bg-mustard py-2.5 text-sm font-medium text-asphalt transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {forgotLoading && <Loader2 size={15} className="animate-spin" />}
                    {forgotLoading ? 'Enviando...' : 'Enviar instrucciones'}
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
