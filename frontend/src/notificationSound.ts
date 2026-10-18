import { useSyncExternalStore } from 'react'
import { supabase } from './supabaseClient'

// Sonido de aviso de mensaje nuevo, elegible por cada operador.
//
// - Los sonidos se sintetizan con Web Audio (no hay archivos que cargar).
// - La elección se guarda en el navegador (por operador) y, si existe la
//   columna operators.notification_sound (ver SQL aparte), también en la base,
//   así lo acompaña al operador a cualquier computadora. Si la columna todavía
//   no existe, todo sigue funcionando solo con el navegador.

type Note = {
  freq: number
  /** si se indica, la frecuencia se desliza hasta este valor durante la nota */
  freqEnd?: number
  start: number
  dur: number
  type?: OscillatorType
  gain?: number
}

export type NotificationSoundDef = { id: string; label: string; description: string; notes: Note[] }

export const notificationSounds: NotificationSoundDef[] = [
  {
    id: 'clasico',
    label: 'Clásico',
    description: 'El pitido de siempre',
    notes: [{ freq: 880, start: 0, dur: 0.15, gain: 0.15 }],
  },
  {
    id: 'campana',
    label: 'Campana',
    description: 'Tono de campana, suave',
    notes: [
      { freq: 1318, start: 0, dur: 0.9, gain: 0.14 },
      { freq: 1976, start: 0, dur: 0.6, gain: 0.06 },
    ],
  },
  {
    id: 'gota',
    label: 'Gota',
    description: 'Corto y discreto',
    notes: [{ freq: 1400, freqEnd: 520, start: 0, dur: 0.18, gain: 0.18 }],
  },
  {
    id: 'doble',
    label: 'Doble toque',
    description: 'Dos pitidos seguidos',
    notes: [
      { freq: 988, start: 0, dur: 0.11, gain: 0.15 },
      { freq: 988, start: 0.17, dur: 0.11, gain: 0.15 },
    ],
  },
  {
    id: 'subida',
    label: 'Subida',
    description: 'Tres notas ascendentes',
    notes: [
      { freq: 523, start: 0, dur: 0.14, gain: 0.15 },
      { freq: 659, start: 0.12, dur: 0.14, gain: 0.15 },
      { freq: 784, start: 0.24, dur: 0.26, gain: 0.15 },
    ],
  },
  {
    id: 'burbuja',
    label: 'Burbuja',
    description: 'Sube rápido, tipo pop',
    notes: [{ freq: 380, freqEnd: 1100, start: 0, dur: 0.14, gain: 0.2 }],
  },
  {
    id: 'radio',
    label: 'Radio',
    description: 'Chirrido de radio de taxi',
    notes: [
      { freq: 1500, start: 0, dur: 0.07, type: 'square', gain: 0.07 },
      { freq: 1100, start: 0.1, dur: 0.07, type: 'square', gain: 0.07 },
    ],
  },
  {
    id: 'alerta',
    label: 'Alerta',
    description: 'Más insistente, para ambientes ruidosos',
    notes: [
      { freq: 740, start: 0, dur: 0.14, type: 'triangle', gain: 0.22 },
      { freq: 988, start: 0.16, dur: 0.14, type: 'triangle', gain: 0.22 },
      { freq: 740, start: 0.32, dur: 0.14, type: 'triangle', gain: 0.22 },
      { freq: 988, start: 0.48, dur: 0.2, type: 'triangle', gain: 0.22 },
    ],
  },
]

const DEFAULT_ID = 'clasico'
const isValid = (id: unknown): id is string => typeof id === 'string' && notificationSounds.some((s) => s.id === id)

let ctx: AudioContext | null = null

export function playNotificationSound(id?: string) {
  try {
    const def = notificationSounds.find((s) => s.id === (id ?? current)) ?? notificationSounds[0]
    ctx = ctx ?? new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    const now = ctx.currentTime
    for (const n of def.notes) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = n.type ?? 'sine'
      const t0 = now + n.start
      osc.frequency.setValueAtTime(n.freq, t0)
      if (n.freqEnd) osc.frequency.exponentialRampToValueAtTime(n.freqEnd, t0 + n.dur)
      const peak = n.gain ?? 0.15
      gain.gain.setValueAtTime(0.0001, t0)
      gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.dur)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t0)
      osc.stop(t0 + n.dur + 0.02)
    }
  } catch {
    // Si el navegador bloquea el audio (sin interacción previa), no pasa nada.
  }
}

// ---- Preferencia guardada ----

let operatorId: string | null = null
let current: string = readStored()
const listeners = new Set<() => void>()

function storageKey() {
  return operatorId ? `notificationSound:${operatorId}` : 'notificationSound'
}

function readStored(): string {
  try {
    const v = localStorage.getItem(storageKey()) ?? localStorage.getItem('notificationSound')
    if (isValid(v)) return v
  } catch { /* localStorage no disponible */ }
  return DEFAULT_ID
}

function writeStored(id: string) {
  try {
    localStorage.setItem(storageKey(), id)
  } catch { /* localStorage no disponible */ }
}

function emit() {
  listeners.forEach((l) => l())
}

/** App lo llama cuando ya sabe qué operador inició sesión. */
export function initNotificationSound(id: string) {
  operatorId = id
  current = readStored()
  emit()
  // Si la columna no existe todavía, la consulta devuelve error y se ignora.
  supabase
    .from('operators')
    .select('notification_sound')
    .eq('id', id)
    .maybeSingle()
    .then(({ data, error }) => {
      if (error || !data) return
      const saved = (data as { notification_sound?: string | null }).notification_sound
      if (isValid(saved) && saved !== current) {
        current = saved
        writeStored(saved)
        emit()
      }
    })
}

export function setNotificationSound(id: string) {
  if (!isValid(id)) return
  current = id
  writeStored(id)
  emit()
  if (operatorId) {
    supabase
      .from('operators')
      .update({ notification_sound: id })
      .eq('id', operatorId)
      .then(({ error }) => {
        if (error) console.warn('No se pudo guardar el sonido en la base (¿falta el SQL?):', error.message)
      })
  }
}

export function useNotificationSound(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}
