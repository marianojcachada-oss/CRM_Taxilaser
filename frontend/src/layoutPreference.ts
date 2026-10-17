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
