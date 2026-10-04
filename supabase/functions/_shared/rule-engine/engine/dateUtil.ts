const ATLANTA_TZ = 'America/New_York'

/** Hora actual en Atlanta (America/New_York), como {hour24, minute}. */
export function getCurrentAtlantaTime(now: Date = new Date()): { hour24: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ATLANTA_TZ,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  // Intl puede devolver hour=24 para medianoche en algunos entornos.
  return { hour24: hour === 24 ? 0 : hour, minute }
}

/**
 * Resuelve la "proxima ocurrencia logica" de una hora ambigua (sin AM/PM),
 * tal como pide el AI_SYSTEM_PROMPT v4: tomando como referencia la hora
 * actual de Atlanta, si la version PM de esa hora todavia no paso hoy, se
 * asume PM; si ya paso, se asume AM (de la madrugada siguiente) salvo que
 * la version AM de hoy todavia no haya pasado.
 *
 * Regla simple y explicable (no magia): de las dos interpretaciones
 * posibles (AM y PM) de la hora dada, se elige la que ocurre MAS PRONTO a
 * partir de ahora. Esto es exactamente lo que ilustra el ejemplo del
 * encargo: son las 9pm y el cliente dice "9:50" -> la version PM (9:50pm,
 * en 50 min) es mas cercana que la version AM (9:50am del dia siguiente,
 * en ~12h), entonces se propone PM.
 */
export function resolveNextOccurrence(
  hour12: number,
  minute: number,
  now: Date = new Date(),
): { hour24: number; minute: number; ampm: 'AM' | 'PM'; label: string } {
  const current = getCurrentAtlantaTime(now)
  const nowMinutes = current.hour24 * 60 + current.minute

  const amHour24 = hour12 % 12 // 12am -> 0
  const pmHour24 = (hour12 % 12) + 12 // 12pm -> 12

  const candidates: Array<{ hour24: number; ampm: 'AM' | 'PM' }> = [
    { hour24: amHour24, ampm: 'AM' },
    { hour24: pmHour24, ampm: 'PM' },
  ]

  let best = candidates[0]!
  let bestDelta = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    const candidateMinutes = candidate.hour24 * 60 + minute
    const delta = (candidateMinutes - nowMinutes + 24 * 60) % (24 * 60)
    if (delta < bestDelta) {
      bestDelta = delta
      best = candidate
    }
  }

  const displayHour = best.hour24 % 12 === 0 ? 12 : best.hour24 % 12
  const label = `${displayHour}:${String(minute).padStart(2, '0')} ${best.ampm}`
  return { hour24: best.hour24, minute, ampm: best.ampm, label }
}

/** Parsea un rawTime tipo "9:50" o "9:50 PM" en {hour12, minute, ampm?}. */
export function parseRawTime(rawTime: string): { hour: number; minute: number; ampm?: 'AM' | 'PM' } | null {
  const match = rawTime.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i)
  if (!match) return null
  const hour = Number(match[1])
  const minute = match[2] ? Number(match[2]) : 0
  const ampm = match[3] ? (match[3].toUpperCase() as 'AM' | 'PM') : undefined
  return { hour, minute, ampm }
}
