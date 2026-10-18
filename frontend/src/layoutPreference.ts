import { useSyncExternalStore } from 'react'

// Interfaz alterna: "clasico" es la de siempre, "espacio" es el rediseño
// "Espacio de trabajo". Se guarda en localStorage (por navegador) a propósito
// y no en la tabla operators: App.tsx carga el operador con una lista fija de
// columnas, y pedir una columna que no exista en la base rompería el login.
export type LayoutId = 'clasico' | 'espacio'

export const layouts: { id: LayoutId; label: string; description: string }[] = [
  { id: 'clasico', label: 'Clásica', description: 'La interfaz de siempre.' },
  {
    id: 'espacio',
    label: 'Espacio de trabajo',
    description: 'Navegación por secciones y canales, lista y chat más aireados.',
  },
]

const KEY = 'layoutPreference'
const listeners = new Set<() => void>()

function read(): LayoutId {
  try {
    return localStorage.getItem(KEY) === 'espacio' ? 'espacio' : 'clasico'
  } catch {
    return 'clasico'
  }
}

let current: LayoutId = read()

function apply() {
  if (typeof document === 'undefined') return
  if (current === 'espacio') document.documentElement.dataset.layout = 'espacio'
  else delete document.documentElement.dataset.layout
}
apply()

function emit() {
  listeners.forEach((l) => l())
}

export function setLayout(id: LayoutId) {
  current = id
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // Sin storage (modo privado, etc.): el cambio vale hasta recargar.
  }
  apply()
  emit()
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return
    current = read()
    apply()
    cb()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', onStorage)
  }
}

export function useLayout(): LayoutId {
  return useSyncExternalStore(subscribe, () => current, () => 'clasico' as LayoutId)
}

// ---------------------------------------------------------------------------
// Tamaño de la interfaz (ambas versiones). Escala todo junto: Tailwind usa rem,
// así que cambiar el tamaño de letra de <html> agranda o achica todo. "auto"
// deja el tamaño normal y solo agranda un poco en pantallas muy anchas.
// ---------------------------------------------------------------------------
export type ScaleId = 'auto' | 'compact' | 'normal' | 'large' | 'xlarge'

export const scales: { id: ScaleId; label: string }[] = [
  { id: 'auto', label: 'Automático' },
  { id: 'compact', label: 'Compacto' },
  { id: 'normal', label: 'Normal' },
  { id: 'large', label: 'Grande' },
  { id: 'xlarge', label: 'Muy grande' },
]

const SCALE_KEY = 'uiScalePreference'
const scaleListeners = new Set<() => void>()

function readScale(): ScaleId {
  try {
    const v = localStorage.getItem(SCALE_KEY)
    return scales.some((s) => s.id === v) ? (v as ScaleId) : 'auto'
  } catch {
    return 'auto'
  }
}

let currentScale: ScaleId = readScale()

function applyScale() {
  if (typeof document === 'undefined') return
  if (currentScale === 'auto') delete document.documentElement.dataset.scale
  else document.documentElement.dataset.scale = currentScale
}
applyScale()

export function setScale(id: ScaleId) {
  currentScale = id
  try {
    localStorage.setItem(SCALE_KEY, id)
  } catch {
    // sin storage: vale hasta recargar
  }
  applyScale()
  scaleListeners.forEach((l) => l())
}

function subscribeScale(cb: () => void) {
  scaleListeners.add(cb)
  const onStorage = (e: StorageEvent) => {
    if (e.key !== SCALE_KEY) return
    currentScale = readScale()
    applyScale()
    cb()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    scaleListeners.delete(cb)
    window.removeEventListener('storage', onStorage)
  }
}

export function useScale(): ScaleId {
  return useSyncExternalStore(subscribeScale, () => currentScale, () => 'auto' as ScaleId)
}
