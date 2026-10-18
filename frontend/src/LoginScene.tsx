import { useEffect, useRef } from 'react'
import { channelIconColor } from './channelColors'

// Escena animada del panel de marca del login (solo se ve en pantallas
// anchas). Sin librerías: usa la API de animaciones del navegador (WAAPI),
// una sola línea de tiempo de 7,5 s que se reproduce UNA vez y queda
// congelada en el último cuadro (la marca) hasta que se recargue la página.
//
//   0–1,5 s   se dibujan las calles
//   1–5 s     un taxi recorre la ruta; llegan mensajes de cada canal
//   5,4–7,3 s los mensajes se juntan al centro y aparece la marca
//
// Usa los colores del tema activo (variables CSS), así que funciona con
// cualquier tema. Se pausa si la pestaña está oculta o el panel no se ve, y
// con "reducir movimiento" queda quieta en la imagen final.

const W = 1280
const H = 720
const D = 7.5 // duración (s): se reproduce una vez y queda en el último cuadro

const ROUTE: [number, number][] = [
  [220, 1000], [220, 420], [520, 420], [520, 180], [880, 180], [880, 420], [1080, 420], [1080, 610],
]
const R = 34
function roundedPath(p: [number, number][]) {
  let d = `M${p[0][0]} ${p[0][1]}`
  for (let i = 1; i < p.length - 1; i++) {
    const [x0, y0] = p[i - 1]
    const [x1, y1] = p[i]
    const [x2, y2] = p[i + 1]
    const l1 = Math.hypot(x1 - x0, y1 - y0)
    const l2 = Math.hypot(x2 - x1, y2 - y1)
    d += ` L${x1 + ((x0 - x1) / l1) * R} ${y1 + ((y0 - y1) / l1) * R} Q${x1} ${y1} ${x1 + ((x2 - x1) / l2) * R} ${y1 + ((y2 - y1) / l2) * R}`
  }
  const last = p[p.length - 1]
  return `${d} L${last[0]} ${last[1]}`
}
const ROUTE_D = roundedPath(ROUTE)
const END = ROUTE[ROUTE.length - 1]

// Se extienden más allá de los 1280×720 para cubrir paneles de cualquier forma.
const STREETS = [
  'M-600 180 L1900 180', 'M-600 420 L1900 420', 'M-600 610 L1900 610', 'M-600 840 L1900 840', 'M-600 -120 L1900 -120',
  'M220 -500 L220 1300', 'M520 -500 L520 1300', 'M880 -500 L880 1300', 'M1080 -500 L1080 1300',
  'M-420 1100 L1100 -420', 'M200 1240 L1800 -360',
]

const BUBBLES = [
  { left: 250, top: 92, ch: 'whatsapp' as const, label: 'WhatsApp', text: '¿Qué tal? Necesito un taxi', at: 1.4 },
  { left: 560, top: 236, ch: 'sms' as const, label: 'SMS', text: "Where's my cab?", at: 2.1 },
  { left: 900, top: 92, ch: 'instagram' as const, label: 'Instagram', text: 'Pickup at the airport', at: 2.8 },
  { left: 90, top: 470, ch: 'facebook' as const, label: 'Messenger', text: 'Ya lo veo, gracias', at: 3.5 },
  { left: 690, top: 520, ch: 'whatsapp' as const, label: 'WhatsApp', text: 'Tomorrow at 6 AM?', at: 4.2 },
]

// [segundo, propiedades, easing hacia el siguiente punto]
type Step = [number, Keyframe, string?]
function track(el: Element, steps: Step[]) {
  const first = steps[0]
  const last = steps[steps.length - 1]
  const all: Step[] = [...steps]
  if (first[0] > 0) all.unshift([0, first[1], undefined])
  if (last[0] < D) all.push([D, last[1], undefined])
  return el.animate(
    all.map(([t, props, easing]) => ({ offset: t / D, ...props, ...(easing ? { easing } : {}) })),
    { duration: D * 1000, iterations: 1, fill: 'both' },
  )
}

const POP = 'cubic-bezier(0.34, 1.56, 0.64, 1)'
const OUT = 'cubic-bezier(0.22, 1, 0.36, 1)'
const IN = 'cubic-bezier(0.55, 0, 1, 0.45)'
const LIN = 'linear'

export default function LoginScene({ subtitle }: { subtitle: string }) {
  const root = useRef<HTMLDivElement>(null)
  const scene = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const rootEl = root.current
    const sceneEl = scene.current
    if (!rootEl || !sceneEl || typeof sceneEl.animate !== 'function') return
    const q = <T extends Element>(sel: string) => sceneEl.querySelector(sel) as T
    const qa = (sel: string) => Array.from(sceneEl.querySelectorAll(sel))
    const anims: Animation[] = []
    const add = (a: Animation) => anims.push(a)

    // calles
    qa('[data-street]').forEach((el, i) => {
      const s = 0.1 + i * 0.12
      add(track(el, [
        [0, { strokeDashoffset: 1 }],
        [s, { strokeDashoffset: 1 }, 'ease-in-out'],
        [s + 1.4, { strokeDashoffset: 0 }],
      ]))
    })
    // el mapa completo: se atenúa cuando aparece la marca y se apaga al final
    add(track(q('[data-map]'), [
      [0, { opacity: 1 }], [5.4, { opacity: 1 }, 'ease'], [6.2, { opacity: 0.22 }],
    ]))
    // ruta
    qa('[data-route]').forEach((el) =>
      add(track(el, [
        [0, { strokeDashoffset: 1 }], [1.2, { strokeDashoffset: 1 }, LIN], [5.2, { strokeDashoffset: 0 }],
      ])),
    )
    // taxi
    add(track(q('[data-taxi]'), [
      [0, { offsetDistance: '0%', opacity: 0 }], [1.19, { offsetDistance: '0%', opacity: 0 }],
      [1.2, { offsetDistance: '0%', opacity: 1 }, LIN], [5.2, { offsetDistance: '100%', opacity: 1 }],
      [5.4, { offsetDistance: '100%', opacity: 1 }, 'ease'], [5.9, { offsetDistance: '100%', opacity: 0 }],
    ]))
    // pines y pulsos
    const pin = (sel: string, at: number) =>
      add(track(q(sel), [
        [0, { opacity: 0, transform: 'scale(0)' }], [at, { opacity: 0, transform: 'scale(0)' }, POP],
        [at + 0.4, { opacity: 1, transform: 'scale(1)' }], [5.4, { opacity: 1, transform: 'scale(1)' }, 'ease'],
        [5.9, { opacity: 0, transform: 'scale(1)' }],
      ]))
    pin('[data-pin-a]', 1.0)
    pin('[data-pin-b]', 5.0)
    const ring = (sel: string, at: number) =>
      add(track(q(sel), [
        [0, { opacity: 0, transform: 'scale(1)' }], [at - 0.01, { opacity: 0, transform: 'scale(1)' }],
        [at, { opacity: 0.9, transform: 'scale(1)' }, OUT],
        [at + 0.9, { opacity: 0, transform: 'scale(3.2)' }],
      ]))
    ring('[data-ring-a]', 1.0)
    ring('[data-ring-b]', 5.1)

    // burbujas: aparecen, esperan y se juntan al centro
    qa('[data-bubble]').forEach((el, i) => {
      const b = BUBBLES[i]
      const h = el as HTMLElement
      const dx = W / 2 - (b.left + h.offsetWidth / 2)
      const dy = H / 2 - 30 - (b.top + h.offsetHeight / 2)
      const hide = 'translate(0px, 12px) scale(0.2)'
      const show = 'translate(0px, 0px) scale(1)'
      const gone = `translate(${dx}px, ${dy}px) scale(0.15)`
      const out = 5.4 + i * 0.04
      add(track(el, [
        [0, { opacity: 0, transform: hide }], [b.at, { opacity: 0, transform: hide }, POP],
        [b.at + 0.65, { opacity: 1, transform: show }], [out, { opacity: 1, transform: show }, IN],
        [out + 0.7, { opacity: 0, transform: gone }],
      ]))
    })

    // marca
    const tile = (sel: string, from: string, at: number) =>
      add(track(q(sel), [
        [0, { opacity: 0, transform: from }], [at, { opacity: 0, transform: from }, POP],
        [at + 0.75, { opacity: 1, transform: 'translate(0px, 0px) rotate(0deg) scale(1)' }],
      ]))
    tile('[data-t1]', 'translate(-60px, -50px) rotate(-16deg) scale(0.75)', 5.7)
    tile('[data-t2]', 'translate(60px, 50px) rotate(16deg) scale(0.75)', 5.82)
    const rise = (sel: string, at: number, dy: number) =>
      add(track(q(sel), [
        [0, { opacity: 0, transform: `translateY(${dy}px)` }], [at, { opacity: 0, transform: `translateY(${dy}px)` }, OUT],
        [at + 0.55, { opacity: 1, transform: 'translateY(0px)' }],
      ]))
    rise('[data-h1]', 6.3, 22)
    rise('[data-sub]', 6.45, 16)
    rise('[data-foot]', 6.7, 10)

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let visible = true
    const apply = () => {
      const run = visible && !document.hidden && rootEl.clientWidth > 0 && !reduced
      // Una animación terminada se deja como está (play() la reiniciaría).
      anims.forEach((a) => {
        if (a.playState === 'finished') return
        if (run) a.play()
        else a.pause()
      })
    }
    // Con "reducir movimiento" se muestra directamente el último cuadro.
    if (reduced) anims.forEach((a) => (a.currentTime = D * 1000))

    // La escena es de 1280×720: se escala para que el contenido (mensajes y
    // marca) entre completo en el panel; las calles siguen más allá del borde.
    const fit = () => {
      const w = rootEl.clientWidth
      const h = rootEl.clientHeight
      if (!w || !h) return
      sceneEl.style.transform = `translate(-50%, -50%) scale(${Math.max(0.45, Math.min(w / 1130, h / 640))})`
    }
    const ro = new ResizeObserver(() => {
      fit()
      apply()
    })
    ro.observe(rootEl)
    const onVis = () => apply()
    document.addEventListener('visibilitychange', onVis)
    fit()
    apply()

    return () => {
      ro.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      anims.forEach((a) => a.cancel())
    }
  }, [])

  const hidden: React.CSSProperties = { opacity: 0 }
  const bubbleBase: React.CSSProperties = {
    position: 'absolute',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '11px 16px 11px 12px',
    borderRadius: '16px 16px 16px 4px',
    background: 'var(--color-panel-light)',
    border: '1px solid color-mix(in srgb, var(--color-cream) 14%, transparent)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
    fontSize: 19,
    fontWeight: 600,
    whiteSpace: 'nowrap',
    color: 'var(--color-cream)',
    opacity: 0,
  }
  const tileBase: React.CSSProperties = {
    position: 'absolute',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 115,
    height: 100,
    borderRadius: 27,
    fontSize: 60,
    fontWeight: 700,
    lineHeight: 1,
    color: 'var(--color-asphalt)',
    opacity: 0,
  }
  const pinBase: React.CSSProperties = { position: 'absolute', width: 18, height: 18, marginLeft: -9, marginTop: -9, borderRadius: '50%', opacity: 0 }
  const streetColor = 'color-mix(in srgb, var(--color-cream) 7%, var(--color-panel))'

  return (
    <div ref={root} aria-hidden="true" className="absolute inset-0 overflow-hidden">
      <div ref={scene} style={{ position: 'absolute', left: '50%', top: '50%', width: W, height: H, transformOrigin: '50% 50%' }}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} data-map style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
          <g fill="none" stroke={streetColor} strokeWidth={12} strokeLinecap="round">
            {STREETS.map((d) => (
              <path key={d} d={d} data-street pathLength={1} style={{ strokeDasharray: 1, strokeDashoffset: 1 }} />
            ))}
          </g>
          <path d={ROUTE_D} data-route pathLength={1} fill="none" stroke="var(--color-mustard)" strokeOpacity={0.28} strokeWidth={22} strokeLinecap="round" strokeLinejoin="round" style={{ strokeDasharray: 1, strokeDashoffset: 1 }} />
          <path d={ROUTE_D} data-route pathLength={1} fill="none" stroke="var(--color-mustard)" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" style={{ strokeDasharray: 1, strokeDashoffset: 1 }} />
        </svg>

        <div data-ring-a style={{ ...pinBase, left: 220, top: 610, background: 'none', border: '2px solid var(--color-mustard)' }} />
        <div data-ring-b style={{ ...pinBase, left: END[0], top: END[1] - 2, background: 'none', border: '2px solid var(--color-mustard)' }} />
        <div data-pin-a style={{ ...pinBase, left: 220, top: 610, background: 'var(--color-cream)' }} />
        <div data-pin-b style={{ ...pinBase, left: END[0], top: END[1] - 2, background: 'var(--color-mustard)' }} />

        <div
          data-taxi
          ref={(el) => {
            if (el) {
              el.style.setProperty('offset-path', `path('${ROUTE_D}')`)
              el.style.setProperty('offset-rotate', 'auto')
            }
          }}
          style={{ position: 'absolute', left: 0, top: 0, width: 50, height: 26, opacity: 0 }}
        >
          <div style={{ position: 'absolute', inset: 0, borderRadius: 9, background: 'var(--color-mustard)', boxShadow: '0 0 0 2px var(--color-asphalt), 0 6px 12px rgba(0,0,0,0.35)' }} />
          <div style={{ position: 'absolute', left: 14, right: 12, top: 4, bottom: 4, borderRadius: 5, background: 'var(--color-asphalt)' }} />
          <div style={{ position: 'absolute', left: 21, top: 9, width: 9, height: 8, borderRadius: 3, background: 'var(--color-cream)' }} />
        </div>

        {BUBBLES.map((b) => (
          <div key={b.left + b.text} data-bubble style={{ ...bubbleBase, left: b.left, top: b.top }}>
            <i style={{ width: 12, height: 12, borderRadius: '50%', flex: 'none', background: channelIconColor[b.ch] }} />
            <div>
              <small className="font-mono" style={{ display: 'block', fontSize: 11, letterSpacing: '0.08em', color: 'var(--color-muted)', textTransform: 'uppercase', marginBottom: 2 }}>
                {b.label}
              </small>
              {b.text}
            </div>
          </div>
        ))}

        {/* Marca */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 26 }}>
          <div style={{ position: 'relative', width: 200, height: 170 }}>
            <div data-t1 style={{ ...tileBase, left: 0, top: 0, background: 'var(--color-mustard)' }}>¿</div>
            <div data-t2 style={{ ...tileBase, right: 0, bottom: 0, background: 'var(--color-cream)', border: '6px solid var(--color-panel)', boxSizing: 'content-box', margin: '0 -6px -6px 0' }}>?</div>
          </div>
          <div data-h1 style={{ ...hidden, fontSize: 66, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', lineHeight: 1, color: 'var(--color-cream)' }}>
            Qué tal?
          </div>
          <div data-sub style={{ ...hidden, fontSize: 25, color: 'color-mix(in srgb, var(--color-cream) 75%, transparent)', marginTop: -6 }}>{subtitle}</div>
        </div>
        <div data-foot className="font-mono" style={{ ...hidden, position: 'absolute', left: 0, right: 0, bottom: 104, textAlign: 'center', fontSize: 16, fontWeight: 500, letterSpacing: '0.08em', color: 'var(--color-muted)' }}>
          TAXI LASER SERVICE · ATLANTA, GA
        </div>
      </div>
    </div>
  )
}
