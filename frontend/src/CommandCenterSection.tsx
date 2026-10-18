import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { supabase } from './supabaseClient'
import { atlantaDateISO } from './atlantaTime'

// Command Center = el día de hoy (hora de Atlanta). Antes traía TODAS las
// conversaciones, mensajes y contactos de la historia en cada carga: con el
// volumen actual la pantalla se colgaba. Ahora cada consulta se limita al día
// (o es un conteo en el servidor, sin traer filas) y las que traen filas están
// paginadas y con tope.

const ATLANTA_TZ = 'America/New_York'
const SLA_MINUTES = 30 // umbral de "vencido" — ajustable más adelante desde acá
const PAGE = 1000
const MAX_PAGES = 8 // tope de seguridad: 8.000 filas por consulta

// Instante UTC en que empezó el día de hoy en Atlanta (00:00 hora de Atlanta).
function atlantaDayStart(): Date {
  const dateStr = atlantaDateISO(new Date())
  // A las 04:30 UTC todavía es "medianoche" del día de Atlanta en cualquier
  // época del año, incluso en los días de cambio de horario (2 am).
  const probe = new Date(`${dateStr}T04:30:00Z`)
  const offset =
    new Intl.DateTimeFormat('en-US', { timeZone: ATLANTA_TZ, timeZoneName: 'longOffset' })
      .formatToParts(probe)
      .find((p) => p.type === 'timeZoneName')?.value.replace('GMT', '') || '-05:00'
  return new Date(`${dateStr}T00:00:00${offset}`)
}

function atlantaHour(iso: string): number {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: ATLANTA_TZ, hour: 'numeric', hourCycle: 'h23' }).format(
    new Date(iso),
  )
  return parseInt(h, 10) % 24
}

async function fetchPaged<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  maxPages = MAX_PAGES,
) {
  const out: T[] = []
  for (let i = 0; i < maxPages; i++) {
    const { data, error } = await build(i * PAGE, i * PAGE + PAGE - 1)
    if (error) throw error
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

type TodayMessage = {
  conversation_id: string
  sender_type: string
  sender_operator_id: string | null
  created_at: string
}

// Mensajes de hoy. Se traen por separado los de clientes y los de operadores
// (antes era una sola consulta con tope de 8.000 filas: en un día movido se
// cortaba a media jornada y el gráfico por hora quedaba vacío desde ahí).
// Cada una tiene su propio tope, y se ordena también por id para que la
// paginación no repita ni se salte filas con la misma hora exacta.
async function fetchTodayMessages(startISO: string): Promise<TodayMessage[]> {
  const MAX = 30 // hasta 30.000 filas por tipo
  const bySender = (sender: 'contact' | 'operator') =>
    fetchPaged<TodayMessage>(
      (from, to) =>
        supabase
          .from('messages')
          .select('conversation_id, sender_type, sender_operator_id, created_at')
          .eq('sender_type', sender)
          .gte('created_at', startISO)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      MAX,
    )
  const [fromContacts, fromOperators] = await Promise.all([bySender('contact'), bySender('operator')])
  return [...fromContacts, ...fromOperators].sort((x, y) => x.created_at.localeCompare(y.created_at))
}

function formatMinutes(mins: number | null): string {
  if (mins === null) return 'Sin datos'
  if (mins < 60) return `${Math.round(mins)}m`
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  return `${h}h ${m}m`
}

function Tile({ label, value, hint, alert }: { label: string; value: string; hint?: string; alert?: boolean }) {
  return (
    <div className="ui-tile rounded-sm border border-panel-light bg-panel p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 font-mono text-2xl font-semibold ${alert ? 'text-alert' : 'text-cream'}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted">{hint}</p>}
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="ui-tile rounded-sm border border-panel-light bg-panel p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
      {children}
    </div>
  )
}

function Bar({ label, value, display }: { label: string; value: number; display: string }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="font-mono text-cream">{display}</span>
      </div>
      <div className="h-1.5 w-full rounded-sm bg-asphalt">
        <div className="h-1.5 rounded-sm bg-mustard" style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

const CAPACITY_KEY = 'ccMessagesPerOperatorHour'

function readCapacity(): number {
  try {
    const n = Number(localStorage.getItem(CAPACITY_KEY))
    if (Number.isFinite(n) && n >= 1 && n <= 500) return Math.round(n)
  } catch { /* localStorage no disponible */ }
  return 20
}

// CONVERSACIONES con mensajes entrantes (de clientes) por hora de Atlanta: cada
// conversación cuenta UNA vez por hora, sin importar cuántos mensajes mande.
// Sirve para decidir cuántos operadores poner en cada franja: se define cuántas
// conversaciones por hora atiende un operador (editable, se recuerda en este
// navegador) y debajo de cada barra queda el número de operadores que haría falta. El promedio de los
// 7 días anteriores se carga solo si se pide (es la consulta más pesada).
function InboundHoursPanel({ hours, nowHour, uniqueTotal }: { hours: number[]; nowHour: number; uniqueTotal: number }) {
  const [capacity, setCapacity] = useState(readCapacity)
  const [week, setWeek] = useState<{ avg: number[]; capped: boolean } | null>(null)
  const [weekLoading, setWeekLoading] = useState(false)
  const [weekError, setWeekError] = useState<string | null>(null)

  function changeCapacity(raw: string) {
    const n = Math.min(500, Math.max(1, Math.round(Number(raw) || 1)))
    setCapacity(n)
    try {
      localStorage.setItem(CAPACITY_KEY, String(n))
    } catch { /* localStorage no disponible */ }
  }

  async function loadWeek() {
    setWeekLoading(true)
    setWeekError(null)
    try {
      const end = atlantaDayStart()
      const start = new Date(end.getTime() - 7 * 24 * 3600_000)
      const MAX_WEEK_PAGES = 20
      const rows = await fetchPaged<{ conversation_id: string; created_at: string }>(
        (from, to) =>
          supabase
            .from('messages')
            .select('conversation_id, created_at')
            .eq('sender_type', 'contact')
            .gte('created_at', start.toISOString())
            .lt('created_at', end.toISOString())
            .order('created_at', { ascending: true })
            .range(from, to),
        MAX_WEEK_PAGES,
      )
      const sums = new Array<number>(24).fill(0)
      // Una conversación cuenta una vez por hora de cada día.
      const seen = new Set<string>()
      for (const r of rows) {
        const key = `${atlantaDateISO(new Date(r.created_at))}|${atlantaHour(r.created_at)}|${r.conversation_id}`
        if (seen.has(key)) continue
        seen.add(key)
        sums[atlantaHour(r.created_at)]++
      }
      setWeek({ avg: sums.map((n) => n / 7), capped: rows.length >= PAGE * MAX_WEEK_PAGES })
    } catch (err) {
      setWeekError(err instanceof Error ? err.message : 'No se pudo cargar el promedio')
    } finally {
      setWeekLoading(false)
    }
  }

  const total = uniqueTotal
  const scaleMax = Math.max(1, ...hours, ...(week?.avg ?? []))
  const peakValue = Math.max(...hours)
  const peakHour = peakValue > 0 ? hours.indexOf(peakValue) : -1
  const needed = (n: number) => (n > 0 ? Math.ceil(n / capacity) : 0)
  const hourLabel = (h: number) => `${h}:00–${h}:59`

  return (
    <Panel title="Conversaciones con mensajes entrantes por hora (hoy, hora de Atlanta)">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
        <span>
          Conversaciones distintas hoy: <span className="font-mono text-cream">{total}</span>
        </span>
        <span>
          Pico:{' '}
          <span className="font-mono text-cream">
            {peakHour >= 0 ? `${hourLabel(peakHour)} (${peakValue} conv. → ${needed(peakValue)} op.)` : 'sin datos'}
          </span>
        </span>
        <label className="flex items-center gap-1.5">
          Un operador atiende ~
          <input
            type="number"
            min={1}
            max={500}
            value={capacity}
            onChange={(e) => changeCapacity(e.target.value)}
            className="w-14 rounded-sm border border-panel-light bg-asphalt px-1.5 py-0.5 text-center font-mono text-cream focus:border-mustard focus:outline-none"
          />
          conversaciones/hora
        </label>
        <button
          onClick={loadWeek}
          disabled={weekLoading}
          className="rounded-sm border border-panel-light px-2 py-1 transition-colors hover:border-mustard hover:text-mustard disabled:opacity-50"
        >
          {weekLoading ? 'Cargando…' : week ? 'Recalcular promedio 7 días' : 'Comparar con promedio de 7 días'}
        </button>
      </div>

      <div className="flex flex-col gap-[3px]" role="img" aria-label="Conversaciones con mensajes entrantes por hora de hoy">
        <div className="grid grid-cols-[repeat(24,minmax(0,1fr))] gap-[3px] text-center font-mono text-[9px] text-cream">
          {hours.map((n, h) => (
            <span key={h}>{n > 0 ? n : ''}</span>
          ))}
        </div>
        <div className="grid h-32 grid-cols-[repeat(24,minmax(0,1fr))] items-stretch gap-[3px]">
          {hours.map((n, h) => (
            <div
              key={h}
              className="relative flex flex-col justify-end"
              title={`${hourLabel(h)} — ${n} conversaciones${week ? ` · prom. 7 días: ${week.avg[h].toFixed(1)}` : ''}`}
            >
              <div
                className={`w-full rounded-sm ${h === nowHour ? 'bg-mustard' : 'bg-mustard/55'}`}
                style={{ height: `${Math.max(n > 0 ? 4 : 1, (n / scaleMax) * 100)}%` }}
              />
              {week && week.avg[h] > 0 && (
                <div
                  className="absolute inset-x-0 border-t-2 border-cream/80"
                  style={{ bottom: `${(week.avg[h] / scaleMax) * 100}%` }}
                />
              )}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-[repeat(24,minmax(0,1fr))] gap-[3px] text-center font-mono text-[9px] text-muted">
          {hours.map((_, h) => (
            <span key={h}>{h % 3 === 0 ? h : ''}</span>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-[repeat(24,minmax(0,1fr))] gap-[3px] text-center font-mono text-[9px] text-mustard">
          {hours.map((n, h) => (
            <span key={h} title={`${hourLabel(h)}: ${needed(n)} operadores`}>
              {needed(n) > 0 ? needed(n) : '·'}
            </span>
          ))}
        </div>
        <p className="text-[10px] text-muted">
          Fila de arriba: conversaciones distintas que escribieron en esa hora (una conversación cuenta una vez por hora, mande los mensajes que mande). Fila dorada de abajo: operadores necesarios con {capacity} conversaciones/hora por operador.
          {week && ' La línea clara en cada barra es el promedio de los 7 días anteriores.'}
        </p>
        {week?.capped && (
          <p className="text-[10px] text-alert">El promedio es aproximado: se llegó al tope de filas leídas.</p>
        )}
        {weekError && <p className="text-[10px] text-alert">Error: {weekError}</p>}
      </div>
    </Panel>
  )
}

const channelNames: Record<string, string> = {
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  instagram: 'Instagram',
  facebook: 'Messenger',
}

type DayAggregates = {
  inbound: number
  inboundConversations: number | null // conversaciones distintas con mensaje entrante hoy
  outbound: number
  inboundHours: number[]
  agents: [string, number][] // [operator_id, mensajes enviados]
  avgResponse: number | null
  avgResolution: number | null
  channelCounts: Record<string, number>
}

// Camino rápido: una sola función en la base (command_center_day, ver
// command_center_day.sql) cuenta todo del día y devuelve solo los números.
// Si esa función todavía no existe en la base, se usa el camino de respaldo
// de abajo, que trae las filas y cuenta en el navegador (más lento).
async function loadDayAggregates(startISO: string): Promise<DayAggregates> {
  const { data, error } = await supabase.rpc('command_center_day', { p_start: startISO })
  if (!error && data && typeof data === 'object') {
    const d = data as {
      inbound?: number
      inbound_conversations?: number
      outbound?: number
      inbound_hours?: number[]
      agents?: { id: string; count: number }[]
      avg_response_min?: number | null
      avg_resolution_min?: number | null
      channels?: Record<string, number>
    }
    const hours = new Array<number>(24).fill(0)
    ;(d.inbound_hours ?? []).slice(0, 24).forEach((n, i) => (hours[i] = Number(n) || 0))
    return {
      inbound: Number(d.inbound) || 0,
      inboundConversations: d.inbound_conversations == null ? null : Number(d.inbound_conversations),
      outbound: Number(d.outbound) || 0,
      inboundHours: hours,
      agents: (d.agents ?? []).map((a) => [a.id, Number(a.count) || 0] as [string, number]),
      avgResponse: d.avg_response_min == null ? null : Number(d.avg_response_min),
      avgResolution: d.avg_resolution_min == null ? null : Number(d.avg_resolution_min),
      channelCounts: d.channels ?? {},
    }
  }
  return loadDayAggregatesClientSide(startISO)
}

async function loadDayAggregatesClientSide(startISO: string): Promise<DayAggregates> {
  const [messages, channelRows, closedRows] = await Promise.all([
    fetchTodayMessages(startISO),
    fetchPaged<{ channel: string }>((from, to) =>
      supabase.from('conversations').select('channel').gte('last_message_at', startISO).range(from, to),
    ),
    fetchPaged<{ created_at: string; closed_at: string }>((from, to) =>
      supabase.from('conversations').select('created_at, closed_at').gte('closed_at', startISO).range(from, to),
    ),
  ])

  // Primera respuesta de HOY: por conversación, del primer mensaje del
  // cliente de hoy a la primera respuesta de un operador después de él.
  const byConversation = new Map<string, TodayMessage[]>()
  for (const m of messages) {
    const list = byConversation.get(m.conversation_id) ?? []
    list.push(m)
    byConversation.set(m.conversation_id, list)
  }
  const responseDurations: number[] = []
  for (const list of byConversation.values()) {
    const firstContact = list.find((m) => m.sender_type === 'contact')
    if (!firstContact) continue
    const firstReply = list.find(
      (m) => m.sender_type === 'operator' && new Date(m.created_at) > new Date(firstContact.created_at),
    )
    if (!firstReply) continue
    responseDurations.push((new Date(firstReply.created_at).getTime() - new Date(firstContact.created_at).getTime()) / 60_000)
  }
  const resolution = closedRows.map((c) => (new Date(c.closed_at).getTime() - new Date(c.created_at).getTime()) / 60_000)

  const inboundHours = new Array<number>(24).fill(0)
  const seenHourConv = new Set<string>()
  const seenConv = new Set<string>()
  const perOperator = new Map<string, number>()
  let inbound = 0
  let outbound = 0
  for (const m of messages) {
    if (m.sender_type === 'contact') {
      inbound++
      seenConv.add(m.conversation_id)
      const h = atlantaHour(m.created_at)
      const key = `${h}|${m.conversation_id}`
      if (!seenHourConv.has(key)) {
        seenHourConv.add(key)
        inboundHours[h]++
      }
    } else if (m.sender_type === 'operator') {
      outbound++
      if (m.sender_operator_id) perOperator.set(m.sender_operator_id, (perOperator.get(m.sender_operator_id) ?? 0) + 1)
    }
  }
  const channelCounts: Record<string, number> = {}
  for (const c of channelRows) channelCounts[c.channel] = (channelCounts[c.channel] ?? 0) + 1
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

  return {
    inbound,
    inboundConversations: seenConv.size,
    outbound,
    inboundHours,
    agents: [...perOperator.entries()],
    avgResponse: avg(responseDurations),
    avgResolution: avg(resolution),
    channelCounts,
  }
}

type Stats = {
  active: number
  unanswered: number
  slaOverdue: number
  newConversations: number
  closedToday: number
  inbound: number
  inboundConversations: number
  outbound: number
  avgResponse: number | null
  avgResolution: number | null
  channels: { id: string; count: number }[]
  agents: { name: string; count: number }[]
  inboundHours: number[]
  totalContacts: number
  vipContacts: number
  newContacts: number
}

export default function CommandCenterSection() {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  const load = useCallback(async (initial: boolean) => {
    if (initial) setLoading(true)
    else setRefreshing(true)
    setError(null)
    try {
      const startISO = atlantaDayStart().toISOString()
      const slaISO = new Date(Date.now() - SLA_MINUTES * 60_000).toISOString()
      const head = { count: 'exact' as const, head: true }

      const [
        activeRes,
        unansweredRes,
        slaRes,
        newConvRes,
        closedRes,
        totalContactsRes,
        vipRes,
        newContactsRes,
        day,
        operatorsRes,
      ] = await Promise.all([
        supabase.from('conversations').select('id', head).neq('status', 'cerrada'),
        supabase.from('conversations').select('id', head).eq('unread', true),
        supabase.from('conversations').select('id', head).eq('unread', true).lt('last_message_at', slaISO),
        supabase.from('conversations').select('id', head).gte('created_at', startISO),
        supabase.from('conversations').select('id', head).gte('closed_at', startISO),
        supabase.from('contacts').select('id', head),
        supabase.from('contacts').select('id', head).eq('vip', true),
        supabase.from('contacts').select('id', head).gte('created_at', startISO),
        loadDayAggregates(startISO),
        supabase.from('operators').select('id, full_name'),
      ])

      for (const r of [
        activeRes,
        unansweredRes,
        slaRes,
        newConvRes,
        closedRes,
        totalContactsRes,
        vipRes,
        operatorsRes,
      ]) {
        if (r.error) throw r.error
      }

      const nameById = new Map((operatorsRes.data ?? []).map((o) => [o.id as string, o.full_name as string]))

      setStats({
        active: activeRes.count ?? 0,
        unanswered: unansweredRes.count ?? 0,
        slaOverdue: slaRes.count ?? 0,
        newConversations: newConvRes.count ?? 0,
        closedToday: closedRes.count ?? 0,
        inbound: day.inbound,
        // Si la función vieja de la base no manda el total, se aproxima con la suma de las horas.
        inboundConversations: day.inboundConversations ?? day.inboundHours.reduce((a, b) => a + b, 0),
        outbound: day.outbound,
        avgResponse: day.avgResponse,
        avgResolution: day.avgResolution,
        channels: ['whatsapp', 'sms', 'instagram', 'facebook'].map((id) => ({ id, count: day.channelCounts[id] ?? 0 })),
        agents: day.agents
          .map(([id, count]) => ({ name: nameById.get(id) ?? 'Operador', count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 8),
        inboundHours: day.inboundHours,
        totalContacts: totalContactsRes.count ?? 0,
        vipContacts: vipRes.count ?? 0,
        newContacts: newContactsRes.error ? 0 : (newContactsRes.count ?? 0),
      })
      setUpdatedAt(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : String(err))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    load(true)
    // Los conteos son livianos: se refresca solo cada minuto mientras la pestaña está abierta.
    const id = setInterval(() => {
      if (!document.hidden) load(false)
    }, 60_000)
    return () => clearInterval(id)
  }, [load])

  if (loading) return <p className="text-sm text-muted">Cargando el día de hoy…</p>
  if (error) return <p className="text-sm text-alert">Error: {error}</p>
  if (!stats) return null

  const maxAgent = Math.max(1, ...stats.agents.map((a) => a.count))
  const totalToday = stats.channels.reduce((a, c) => a + c.count, 0)
  const nowHour = atlantaHour(new Date().toISOString())

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          Hoy, hora de Atlanta
          {updatedAt && ` · actualizado ${updatedAt.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`}
        </p>
        <button
          onClick={() => load(false)}
          disabled={refreshing}
          className="flex items-center gap-1.5 rounded-sm border border-panel-light px-2.5 py-1.5 text-xs text-muted transition-colors hover:border-mustard hover:text-mustard disabled:opacity-50"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Actualizar
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Mensajes recibidos" value={String(stats.inbound)} hint="de clientes, hoy" />
        <Tile label="Mensajes enviados" value={String(stats.outbound)} hint="de operadores, hoy" />
        <Tile label="Conversaciones nuevas" value={String(stats.newConversations)} hint={`${stats.closedToday} cerradas hoy`} />
        <Tile label="1ª respuesta (prom.)" value={formatMinutes(stats.avgResponse)} hint="de las conversaciones de hoy" />
      </div>

      <InboundHoursPanel hours={stats.inboundHours} nowHour={nowHour} uniqueTotal={stats.inboundConversations} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel title="Ahora mismo">
          <div className="grid grid-cols-3 gap-3">
            <Tile label="Activas" value={String(stats.active)} />
            <Tile label="Sin responder" value={String(stats.unanswered)} alert={stats.unanswered > 0} />
            <Tile label={`SLA >${SLA_MINUTES}m`} value={String(stats.slaOverdue)} alert={stats.slaOverdue > 0} />
          </div>
          <p className="mt-3 text-[11px] text-muted">Resolución promedio de las cerradas hoy: {formatMinutes(stats.avgResolution)}</p>
        </Panel>

        <Panel title="Canales (conversaciones con actividad hoy)">
          {stats.channels.map((c) => (
            <Bar
              key={c.id}
              label={channelNames[c.id] ?? c.id}
              value={totalToday ? Math.round((c.count / totalToday) * 100) : 0}
              display={`${c.count}${totalToday ? ` (${Math.round((c.count / totalToday) * 100)}%)` : ''}`}
            />
          ))}
        </Panel>

        <Panel title="Operadores (mensajes enviados hoy)">
          {stats.agents.length === 0 && <p className="text-xs text-muted">Todavía no hay mensajes de operadores hoy.</p>}
          {stats.agents.map((a) => (
            <Bar key={a.name} label={a.name} value={Math.round((a.count / maxAgent) * 100)} display={String(a.count)} />
          ))}
        </Panel>

        <Panel title="Contactos">
          <div className="grid grid-cols-3 gap-3">
            <Tile label="Totales" value={stats.totalContacts.toLocaleString('es-AR')} />
            <Tile label="VIP" value={String(stats.vipContacts)} />
            <Tile label="Nuevos hoy" value={String(stats.newContacts)} />
          </div>
          <p className="mt-3 text-[11px] text-muted">
            Leads, ventas y revenue necesitan la integración con TaxiCaller para tener datos reales.
          </p>
        </Panel>
      </div>
    </div>
  )
}
