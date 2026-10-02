// frontend/src/atlantaTime.ts
//
// La empresa opera en Atlanta, así que toda hora de mensaje/conversación
// que se muestra en el CRM tiene que ser la hora de ATLANTA (America/
// New_York), no la del navegador de quien esté mirando la pantalla —
// antes `toLocaleTimeString('es-AR', ...)` usaba el huso del navegador
// sin querer (el 'es-AR' solo define el FORMATO en español, no el huso),
// así que a alguien mirando desde Argentina un mensaje recién llegado le
// aparecía con la hora de Argentina en vez de la de Atlanta.
//
// Todos los husos de EE.UU. están en un offset de horas ENTERAS respecto
// a UTC, pero para formatear no hace falta ni siquiera calcular ese
// offset a mano — con pasarle timeZone a Intl/toLocale* alcanza, y él
// solo contempla EDT/EST según la fecha.
const ATLANTA_TZ = 'America/New_York'

// Fecha calendario (YYYY-MM-DD) tal cual cae ese instante EN ATLANTA —
// para agrupar mensajes por día (separadores "HOY"/"AYER", etc) de forma
// consistente sin importar el huso de quien esté mirando. Nunca usar
// `iso.slice(0, 10)` para esto: ese string trae la fecha en UTC, que
// cerca de la medianoche puede caer en un día distinto al de Atlanta.
export function atlantaDateISO(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return new Intl.DateTimeFormat('en-CA', { timeZone: ATLANTA_TZ }).format(d)
}

// Hora corta, ej: "14:32"
export function formatMessageTime(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: ATLANTA_TZ,
  })
}

// Fecha corta, ej: "02/10/2026"
export function formatMessageDate(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('es-AR', { timeZone: ATLANTA_TZ })
}

// Fecha larga, ej: "2 de octubre de 2026"
export function formatMessageDateLong(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: ATLANTA_TZ,
  })
}

// Fecha + hora corta, ej: "02/10, 14:32"
export function formatMessageDateTimeShort(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: ATLANTA_TZ,
  })
}

// Fecha + hora completa, ej: "2/10/2026, 14:32:05"
export function formatMessageDateTimeFull(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('es-AR', { timeZone: ATLANTA_TZ })
}

// Hora del día (0-23) de un instante, SEGÚN ATLANTA — nunca usar
// date.getHours(), que da la hora del navegador.
export function atlantaHour(d: Date): number {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: ATLANTA_TZ, hour: '2-digit', hour12: false }).format(d)
  const h = parseInt(s, 10)
  return h === 24 ? 0 : h
}

// Día de la semana (0=domingo) de un instante, según Atlanta.
export function atlantaWeekdayIndex(d: Date): number {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: ATLANTA_TZ, weekday: 'short' }).format(d)
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return map[s] ?? 0
}

function atlantaOffsetHours(atUtc: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: ATLANTA_TZ, timeZoneName: 'shortOffset' }).formatToParts(
    atUtc,
  )
  const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-5'
  const match = tzPart.match(/GMT([+-]\d+)/)
  return match ? parseInt(match[1], 10) : -5
}

// Instante UTC (como ISO string) del comienzo de un día calendario de
// Atlanta (ej: "2026-10-02" → la medianoche real de Atlanta ese día,
// convertida a UTC) — para construir los límites de un rango de consulta
// contra columnas timestamptz sin importar el huso de quien lo pida.
export function atlantaDayStartUtcIso(dateStr: string): string {
  const offset = atlantaOffsetHours(new Date(`${dateStr}T12:00:00Z`))
  const naiveUtcMs = Date.parse(`${dateStr}T00:00:00Z`)
  return new Date(naiveUtcMs - offset * 3_600_000).toISOString()
}
