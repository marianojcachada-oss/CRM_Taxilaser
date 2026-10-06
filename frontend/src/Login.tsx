import { useState } from 'react'
import { Mail, Lock, Eye, EyeOff, ArrowLeft, CheckCircle2, Loader2, MessageSquare, BarChart3, CircleAlert } from 'lucide-react'
import { supabase } from './supabaseClient'

type LoginIntent = 'mensajeria' | 'administracion'

type Props = {
  // Le avisa a App.tsx a dónde quiere entrar — se llama apenas cambia
  // el selector, no recién al mandar el formulario, así App.tsx ya
  // sabe la intención antes de que termine de resolverse la sesión.
  onIntentChange?: (intent: LoginIntent) => void
}

// Marca: dos cuadrados "¿" y "?" (mostaza y crema). Se escala con `scale`.
function BrandMark({ scale = 1 }: { scale?: number }) {
  const w = 76 * scale
  const h = 66 * scale
  const r = 18 * scale
  const font = 40 * scale
  const common = {
    width: w,
    height: h,
    borderRadius: r,
    fontSize: font,
    lineHeight: 1,
  } as React.CSSProperties
  return (
    <div aria-hidden="true" className="relative shrink-0" style={{ width: 132 * scale, height: 112 * scale }}>
      <div
        className="absolute left-0 top-0 flex items-center justify-center bg-mustard font-bold text-asphalt transition-colors duration-300"
        style={common}
      >
        ¿
      </div>
      <div
        className="absolute bottom-0 right-0 flex items-center justify-center bg-cream font-bold text-asphalt"
        style={{ ...common, border: `${4 * scale}px solid var(--color-panel)`, boxSizing: 'content-box', margin: `0 ${-4 * scale}px ${-4 * scale}px 0` }}
      >
        ?
      </div>
    </div>
  )
}

const checkerStyle = (size: number): React.CSSProperties => ({
  backgroundImage:
    'conic-gradient(var(--color-mustard) 25%, transparent 0 50%, var(--color-mustard) 0 75%, transparent 0)',
  backgroundSize: `${size}px ${size}px`,
})

const fieldWrap =
  'flex h-12 items-center gap-2.5 rounded-[10px] border border-muted/70 bg-asphalt px-3.5 transition-[border-color,box-shadow] focus-within:border-mustard focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-mustard)_35%,transparent)]'
const fieldInput =
  'h-full min-w-0 flex-1 bg-transparent text-base text-cream placeholder-muted/60 outline-none md:text-[15px] [&:-webkit-autofill]:[-webkit-text-fill-color:var(--color-cream)] [&:-webkit-autofill]:shadow-[inset_0_0_0_40px_var(--color-asphalt)]'
const labelCls = 'text-[13px] font-semibold text-cream/80'
const primaryBtn =
  'flex h-12 items-center justify-center gap-2 rounded-[10px] bg-mustard text-base font-bold text-asphalt transition-[filter,opacity] hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mustard disabled:opacity-50'

export default function Login({ onIntentChange }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [intent, setIntent] = useState<LoginIntent>('mensajeria')

  function changeIntent(next: LoginIntent) {
    setIntent(next)
    onIntentChange?.(next)
  }

  // Mensajería = marca de siempre (mostaza). Administración = un acento
  // distinto (azul "info", ya definido en todos los temas) para que se
  // note de un vistazo que no es la pantalla operativa de todos los
  // días. Pisa la variable CSS --color-mustard para TODO lo de acá
  // abajo, así los mismos botones/bordes que ya usan var(--color-mustard)
  // cambian solos, sin duplicar estilos.
  const accentOverride =
    intent === 'administracion' ? ({ '--color-mustard': 'var(--color-info)' } as React.CSSProperties) : undefined
  const isAdmin = intent === 'administracion'

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
    if (error) setError('Email o contraseña incorrectos. Revisalos e intentá de nuevo.')
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

  const segBase =
    'flex h-11 flex-1 items-center justify-center gap-2 rounded-[9px] border text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mustard'
  const segOn = `${segBase} border-mustard bg-mustard/15 font-semibold text-cream`
  const segOff = `${segBase} border-transparent font-medium text-cream/75 hover:text-cream`

  return (
    <div className="flex min-h-screen bg-asphalt text-cream transition-colors duration-300 md:flex-row" style={accentOverride}>
      {/* Panel de marca — solo en pantallas medianas y grandes */}
      <section
        aria-label="Qué tal?"
        className="relative hidden flex-1 flex-col items-center justify-center gap-6 overflow-hidden border-r border-panel-light bg-panel md:flex"
      >
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-[72px] opacity-[0.12]"
          style={{
            ...checkerStyle(36),
            WebkitMaskImage: 'linear-gradient(to top, #000, transparent)',
            maskImage: 'linear-gradient(to top, #000, transparent)',
          }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(60% 50% at 50% 42%, color-mix(in srgb, var(--color-mustard) 7%, transparent), transparent 70%)',
          }}
        />
        <BrandMark />
        <div className="relative text-center">
          <h1 className="text-[44px] font-bold uppercase leading-none tracking-[0.06em] text-cream">Qué tal?</h1>
          <p className="mt-3 text-[17px] text-cream/75">
            {isAdmin ? 'Métricas y reportes — acceso restringido' : 'Mensajería y despacho para operadores'}
          </p>
        </div>
        <p className="absolute inset-x-0 bottom-[92px] text-center font-mono text-xs font-medium tracking-[0.08em] text-muted">
          TAXI LASER SERVICE · ATLANTA, GA
        </p>
      </section>

      {/* Panel del formulario */}
      <main className="flex w-full flex-col items-center px-5 pb-7 pt-10 md:w-[540px] md:max-w-full md:shrink-0 md:justify-center md:px-10 md:py-12">
        <div className="flex w-full max-w-[380px] flex-1 flex-col gap-5 md:flex-none">
          {/* Marca compacta — solo en celular */}
          <div className="flex flex-col items-center gap-3.5 pt-2 md:hidden">
            <BrandMark scale={0.66} />
            <div className="text-[28px] font-bold uppercase tracking-[0.06em]">Qué tal?</div>
            <div aria-hidden="true" className="h-3.5 w-full rounded-[3px] opacity-[0.14]" style={checkerStyle(14)} />
          </div>

          {!showForgot ? (
            <>
              <div>
                <h2 className="text-2xl font-bold leading-tight md:text-[28px]">Ingresá a tu cuenta</h2>
                <p className="mt-1.5 text-[15px] text-muted">
                  {isAdmin
                    ? 'Entrá con la misma cuenta. Necesitás permiso de métricas.'
                    : 'Usá tu email y contraseña de operador.'}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="login-email" className={labelCls}>
                    Email
                  </label>
                  <div className={fieldWrap}>
                    <Mail size={18} aria-hidden="true" className="shrink-0 text-muted" />
                    <input
                      id="login-email"
                      type="email"
                      required
                      autoFocus
                      autoComplete="username"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="tu@taxilaserllc.com"
                      className={fieldInput}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="login-password" className={labelCls}>
                    Contraseña
                  </label>
                  <div className={`${fieldWrap} pr-1.5`}>
                    <Lock size={18} aria-hidden="true" className="shrink-0 text-muted" />
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={fieldInput}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                      aria-pressed={showPassword}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-cream/75 transition-colors hover:text-cream focus-visible:outline-2 focus-visible:outline-mustard"
                    >
                      {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-x-3">
                  <label className="inline-flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-cream/80">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                      className="h-5 w-5 accent-[var(--color-mustard)]"
                    />
                    Recordarme
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowForgot(true)}
                    className="inline-flex min-h-11 items-center text-sm font-medium text-cream underline underline-offset-[3px] transition-colors hover:text-mustard focus-visible:outline-2 focus-visible:outline-mustard"
                  >
                    ¿Olvidaste tu contraseña?
                  </button>
                </div>

                {error && (
                  <div
                    role="alert"
                    className="flex items-start gap-2.5 rounded-[10px] border border-alert bg-alert/10 px-3.5 py-3 text-sm text-cream"
                  >
                    <CircleAlert size={18} aria-hidden="true" className="mt-px shrink-0 text-alert" />
                    <span>{error}</span>
                  </div>
                )}

                <button type="submit" disabled={loading} className={primaryBtn}>
                  {loading && <Loader2 size={17} className="animate-spin" />}
                  {loading ? 'Ingresando...' : isAdmin ? 'Ingresar a Administración' : 'Ingresar'}
                </button>
              </form>

              {/* Destino del ingreso — en celular queda al pie */}
              <div className="flex flex-col gap-3 max-md:mt-auto">
                <div className="flex items-center gap-3 text-[13px] text-muted">
                  <div className="h-px flex-1 bg-panel-light" />
                  Ingresar a
                  <div className="h-px flex-1 bg-panel-light" />
                </div>
                <div
                  role="group"
                  aria-label="Destino del ingreso"
                  className="flex gap-1 rounded-xl border border-panel-light bg-asphalt p-1"
                >
                  <button
                    type="button"
                    onClick={() => changeIntent('mensajeria')}
                    aria-pressed={!isAdmin}
                    className={!isAdmin ? segOn : segOff}
                  >
                    <MessageSquare size={17} aria-hidden="true" /> Mensajería
                  </button>
                  <button
                    type="button"
                    onClick={() => changeIntent('administracion')}
                    aria-pressed={isAdmin}
                    className={isAdmin ? segOn : segOff}
                  >
                    <BarChart3 size={17} aria-hidden="true" /> Administración
                  </button>
                </div>
              </div>
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
                className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-medium text-muted transition-colors hover:text-mustard focus-visible:outline-2 focus-visible:outline-mustard"
              >
                <ArrowLeft size={15} aria-hidden="true" /> Volver al login
              </button>

              <div>
                <h2 className="text-2xl font-bold leading-tight md:text-[28px]">Recuperar contraseña</h2>
                <p className="mt-1.5 text-[15px] text-muted">
                  Ingresá tu email y te mandamos instrucciones para restablecerla.
                </p>
              </div>

              {forgotSent ? (
                <div
                  role="status"
                  className="flex items-start gap-2.5 rounded-[10px] border border-available/30 bg-available/10 px-3.5 py-3 text-sm text-available"
                >
                  <CheckCircle2 size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
                  <span>Listo — revisá tu correo (incluyendo spam) para continuar.</span>
                </div>
              ) : (
                <form onSubmit={handleForgotSubmit} className="flex flex-col gap-5">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="forgot-email" className={labelCls}>
                      Email
                    </label>
                    <div className={fieldWrap}>
                      <Mail size={18} aria-hidden="true" className="shrink-0 text-muted" />
                      <input
                        id="forgot-email"
                        type="email"
                        required
                        autoFocus
                        autoComplete="username"
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                        placeholder="tu@taxilaserllc.com"
                        className={fieldInput}
                      />
                    </div>
                  </div>

                  {forgotError && (
                    <div
                      role="alert"
                      className="flex items-start gap-2.5 rounded-[10px] border border-alert bg-alert/10 px-3.5 py-3 text-sm text-cream"
                    >
                      <CircleAlert size={18} aria-hidden="true" className="mt-px shrink-0 text-alert" />
                      <span>{forgotError}</span>
                    </div>
                  )}

                  <button type="submit" disabled={forgotLoading} className={primaryBtn}>
                    {forgotLoading && <Loader2 size={17} className="animate-spin" />}
                    {forgotLoading ? 'Enviando...' : 'Enviar instrucciones'}
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  )
}
