import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Send, X, EyeOff, CheckCircle2, RotateCcw, Trash2, Clock, Check, CheckCheck, Pin, ArrowLeft, Info,
  MessageCircle, Smile, Paperclip, Mic, Square, Languages, Loader2, FileText, Lock, Ban, Copy,
  Search, ChevronDown, Reply,
} from 'lucide-react'
import EmojiPicker from 'emoji-picker-react'
import twemoji from 'twemoji'
import { SiWhatsapp, SiFacebook, SiInstagram } from '@icons-pack/react-simple-icons'
import ContactPanel from './ContactPanel'
import { supabase } from './supabaseClient'
import { useToast } from './Toast'
import { getFunctionErrorMessage } from './functionsError'
import { phoneForCopy } from './phone'

export type Channel = 'whatsapp' | 'facebook' | 'instagram' | 'sms'

export type ConversationStatus =
  | 'esperando_operador'
  | 'esperando_informacion'
  | 'esperando_cliente'
  | 'reclamo'
  | 'cancelacion'
  | 'cerrada'

export const statusConfig: Record<ConversationStatus, { emoji: string; label: string; color: string }> = {
  esperando_operador: { emoji: '🟢', label: 'Cliente esperando respuesta', color: 'text-available' },
  esperando_informacion: { emoji: '🟡', label: 'Cliente esperando información', color: 'text-warning' },
  esperando_cliente: { emoji: '🔵', label: 'Esperando respuesta del cliente', color: 'text-info' },
  reclamo: { emoji: '🔴', label: 'Cliente enojado', color: 'text-alert' },
  cancelacion: { emoji: '🟠', label: 'Posible cancelación', color: 'text-alert' },
  cerrada: { emoji: '⚫', label: 'Cerrada', color: 'text-muted' },
}

export const channelLabel: Record<Channel, string> = {
  whatsapp: 'WA',
  facebook: 'FB',
  instagram: 'IG',
  sms: 'SMS (RingCentral)',
}

const allChannels: Channel[] = ['whatsapp', 'facebook', 'instagram', 'sms']

export const channelAvatarColor: Record<Channel, string> = {
  whatsapp: '#25D366',
  facebook: '#1877F2',
  instagram: '#E1306C',
  sms: '#6B6459',
}

export function ChannelIcon({ channel, size = 14, color }: { channel: Channel; size?: number; color?: string }) {
  switch (channel) {
    case 'whatsapp':
      return <SiWhatsapp size={size} color={color ?? '#25D366'} />
    case 'facebook':
      return <SiFacebook size={size} color={color ?? '#1877F2'} />
    case 'instagram':
      return <SiInstagram size={size} color={color ?? '#E1306C'} />
    case 'sms':
      return <MessageCircle size={size} color={color ?? '#FF7A00'} />
  }
}

export type Operator = {
  id: string
  full_name: string
  operator_code?: string | null
  presence?: 'available' | 'offline' | 'busy'
}

const urlPattern = /(https?:\/\/[^\s]+)/g

// Los emojis se dibujan con imágenes propias (Twemoji) en vez de
// depender de la fuente instalada en la compu de cada operador — si al
// sistema operativo le falta la fuente de emojis (pasa bastante en
// Windows/Linux desactualizados), el emoji se ve como un cuadradito
// aunque el dato haya llegado perfecto. Así se ve siempre igual para
// todos, sea cual sea la máquina.
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function EmojiText({ text }: { text: string }) {
  const html = twemoji.parse(escapeHtml(text), {
    className: 'inline-block h-[1.2em] w-[1.2em] align-text-bottom mx-0.5',
  })
  return <span dangerouslySetInnerHTML={{ __html: html }} />
}

function Linkify({ text }: { text: string }) {
  const parts = text.split(urlPattern)
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noreferrer"
            className="break-all underline decoration-1 underline-offset-2 hover:opacity-80"
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </a>
        ) : (
          <EmojiText key={i} text={part} />
        ),
      )}
    </>
  )
}

export type Conversation = {
  id: string
  contactId: string
  name: string
  phone: string
  channel: Channel
  lastMessage: string
  time: string
  createdAt: string
  unread: boolean
  status: ConversationStatus
  assignedOperatorId: string | null
  assignedToName: string | null
  blocked: boolean
  team: string | null
  vip: boolean
  tags: string[]
  preferredChannels: string[]
  needsAssignment: boolean
  totalInvertido?: string | null
  serviciosCompletados?: number | null
  serviciosCancelados?: number | null
  snoozedUntil?: string | null
  lastContactMessageAt?: string | null
  keepWithOperator?: boolean
  notes?: string | null
  hasActiveRide?: boolean
  activeRideUnit?: string | null
  activeRideEtaMinutes?: number | null
  activeRideEtaReceivedAt?: string | null
  activeRideStatus?: string | null
  activeRideFare?: string | null
  activeRideCompletedAt?: string | null
}

type AttachmentKind = 'image' | 'audio' | 'file'
type Attachment = { name: string; url: string; kind: AttachmentKind }
type PendingAttachment = Attachment & { blob: Blob }

export type Message = {
  id: string
  from: 'contact' | 'operator'
  text?: string
  attachment?: Attachment
  sentViaChannel?: Channel | null
  senderOperatorId?: string
  time: string
  date?: string
  // 'delivered'/'read' solo aplican a WhatsApp (es lo único que manda esos
  // eventos de status) — para los demás canales, un mensaje que no está
  // "sending" ni "failed" se considera simplemente "sent" y no se puede
  // saber más que eso.
  status?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed'
  // A qué mensaje responde (cita), si es que responde a alguno — solo
  // tiene sentido para WhatsApp. La vista previa de lo citado no se pide
  // aparte a la base: se busca por este id dentro de "thread", que ya
  // tiene cargada toda la conversación.
  replyToMessageId?: string
}

async function translateText(text: string, targetLang: 'es' | 'en'): Promise<string> {
  const { data, error } = await supabase.functions.invoke('translate', {
    body: { text, target: targetLang },
  })
  if (error || !data?.translated) {
    throw new Error(await getFunctionErrorMessage(error, data))
  }
  return data.translated as string
}

function getSnoozeDate(preset: '15m' | '1h' | 'tomorrow' | 'monday'): Date {
  const now = new Date()
  if (preset === '15m') return new Date(now.getTime() + 15 * 60_000)
  if (preset === '1h') return new Date(now.getTime() + 60 * 60_000)
  if (preset === 'tomorrow') {
    const d = new Date(now)
    d.setDate(d.getDate() + 1)
    d.setHours(9, 0, 0, 0)
    return d
  }
  // monday
  const d = new Date(now)
  const daysUntilMonday = (8 - d.getDay()) % 7 || 7
  d.setDate(d.getDate() + daysUntilMonday)
  d.setHours(9, 0, 0, 0)
  return d
}

type Props = {
  conversations: Conversation[]
  setConversations: React.Dispatch<React.SetStateAction<Conversation[]>>
  operators: Operator[]
  operatorId: string | null
  operatorName: string
  isAdmin: boolean
  isSuperAdmin: boolean
  theme: string
  filter: { kind: string; channel?: Channel }
  onSelectFilter: (f: { kind: string; channel?: Channel }) => void
  onRefreshConversations?: () => void
}

const filterTitle: Record<string, string> = {
  all: 'Todos',
  new: 'Sin leer',
  pending: 'Pendientes',
  mine: 'Mías',
  unassigned: 'Sin asignar',
  snoozed: 'Pospuestas',
}

export default function ConversationsView({
  conversations,
  setConversations,
  operators,
  operatorId,
  operatorName,
  isAdmin,
  isSuperAdmin,
  theme,
  filter,
  onSelectFilter,
  onRefreshConversations,
}: Props) {
  const toast = useToast()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // El canal (WA/FB/IG/SMS) es un recorte independiente de la bandeja
  // (Mías/Pendientes/etc) — nunca reemplaza la cuenta de los demás
  // canales, solo decide qué se muestra en la lista.
  const displayedConversations = useMemo(
    () => (filter.channel ? conversations.filter((c) => c.channel === filter.channel) : conversations),
    [conversations, filter.channel],
  )
  const [thread, setThread] = useState<Message[]>([])
  const threadEndRef = useRef<HTMLDivElement>(null)
  const threadContainerRef = useRef<HTMLDivElement>(null)
  // Si el operador está mirando el final del chat ahora mismo — se guarda
  // en un ref (no en un state) porque se lee desde el efecto de "llegó un
  // mensaje nuevo" sin que ese efecto tenga que depender de él ni
  // volver a dispararse cada vez que cambia.
  const isAtBottomRef = useRef(true)
  const prevThreadLengthRef = useRef(0)
  const [showJumpToBottom, setShowJumpToBottom] = useState(false)
  const [draft, setDraft] = useState('')
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [showEmoji, setShowEmoji] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [showReassignMenu, setShowReassignMenu] = useState(false)
  const [reassignSearch, setReassignSearch] = useState('')
  const [templates, setTemplates] = useState<{ id: string; title: string; body: string }[]>([])
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null)
  const [recording, setRecording] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [translations, setTranslations] = useState<Record<string, string>>({})
  const [translatingId, setTranslatingId] = useState<string | null>(null)
  const [translatingDraft, setTranslatingDraft] = useState(false)
  const [availableChannels, setAvailableChannels] = useState<Channel[]>([])
  const [bulkSelectMode, setBulkSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [linkedChannels, setLinkedChannels] = useState<Set<Channel>>(new Set())
  const [sendChannel, setSendChannel] = useState<Channel | null>(null)
  const [typingOperators, setTypingOperators] = useState<string[]>([])
  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false)
  const [customSnooze, setCustomSnooze] = useState('')
  const [showContactPanel, setShowContactPanel] = useState(false)
  const [headerPhoneCopied, setHeaderPhoneCopied] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const draftInputRef = useRef<HTMLTextAreaElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const presenceChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  // Evita volver a mandar el mismo aviso en cada pausa al tipear si ya
  // estaba marcado como "escribiendo".
  const isTypingRef = useRef(false)
  // Quién más está escribiendo ahora mismo en esta conversación, y el
  // timer que lo saca solo si nunca llega el aviso de "dejó de escribir"
  // (por ejemplo, cerró la pestaña con texto cargado en el campo).
  const typingTimersRef = useRef<Map<string, { name: string; timer: ReturnType<typeof setTimeout> }>>(new Map())

  // Auto-crece el textarea del mensaje a medida que se escribe (incluye
  // los saltos de línea de Shift+Enter), como en WhatsApp — hasta un
  // máximo de ~6 líneas, después scrollea adentro del campo.
  useEffect(() => {
    const el = draftInputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [draft])

  useEffect(() => {
    supabase
      .from('message_templates')
      .select('id, title, body')
      .order('created_at', { ascending: false })
      .then(({ data }) => setTemplates(data ?? []))
  }, [])

  function insertTemplate(body: string) {
    const myCode = operators.find((o) => o.id === operatorId)?.operator_code
    const withCode = body.replaceAll('{{codigo}}', myCode || '(sin código cargado)')
    setDraft((prev) => (prev ? `${prev} ${withCode}` : withCode))
    setShowTemplates(false)
  }

  useEffect(() => {
    if (!conversations.some((c) => c.id === selectedId)) {
      // Si el operador está en medio de escribir algo (o tiene un adjunto
      // cargado), NO lo sacamos de la conversación así nomás — esto era lo
      // que pasaba en Round Robin: llegaba un mensaje nuevo, la lista se
      // recalculaba, la conversación abierta quedaba momentáneamente
      // afuera de esa lista (por el reordenamiento, una reasignación,
      // etc.) y saltaba solo a otra — pero lo que estabas escribiendo
      // seguía cargado en el campo, así que terminaba mandándose en el
      // chat equivocado sin que se note. Si no hay nada escrito, no pasa
      // nada por seguir el comportamiento de siempre.
      const isComposing = draft.trim().length > 0 || pendingAttachment != null
      if (!selectedId || !isComposing) {
        setSelectedId(conversations[0]?.id ?? null)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations])

  const selected = conversations.find((c) => c.id === selectedId)

  const whatsappWindowClosed =
    sendChannel === 'whatsapp' &&
    (selected?.lastContactMessageAt == null ||
      Date.now() - new Date(selected.lastContactMessageAt).getTime() > 24 * 60 * 60 * 1000)

  function dayLabel(isoDate: string): string {
    const today = new Date()
    const todayIso = today.toISOString().slice(0, 10)

    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayIso = yesterday.toISOString().slice(0, 10)

    if (isoDate === todayIso) return 'HOY'
    if (isoDate === yesterdayIso) return 'AYER'

    const [year, month, day] = isoDate.split('-').map(Number)
    const date = new Date(year, month - 1, day)
    return date
      .toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })
      .toUpperCase()
  }

  function mapRow(m: any): Message {
    return {
      id: m.id,
      from: m.sender_type === 'operator' ? 'operator' : 'contact',
      text: m.content ?? undefined,
      sentViaChannel: m.sent_via_channel ?? null,
      senderOperatorId: m.sender_operator_id ?? undefined,
      time: new Date(m.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
      date: m.created_at.slice(0, 10), // yyyy-mm-dd, para poder agrupar por día de forma confiable
      attachment: m.attachment_url
        ? { url: m.attachment_url, name: m.attachment_name ?? 'archivo', kind: (m.attachment_kind ?? 'file') as AttachmentKind }
        : undefined,
      // Un mensaje que ya está guardado en la base (no es el optimista que
      // se agrega al mandar) nunca está "sending" ni "failed" — su estado
      // real es el que haya quedado en delivery_status ("sent" por
      // default para lo viejo que nunca tuvo este campo).
      status: m.sender_type === 'operator' ? (m.delivery_status ?? 'sent') : undefined,
      replyToMessageId: m.reply_to_message_id ?? undefined,
    }
  }

  useEffect(() => {
    // Una cita "enganchada" en el composer es del chat que se estaba viendo
    // — no tiene sentido que sobreviva a cambiar de conversación.
    setReplyingTo(null)

    if (!selectedId) {
      setThread([])
      return
    }

    let cancelled = false

    supabase
      .from('messages')
      .select('id, sender_type, sender_operator_id, content, created_at, attachment_url, attachment_name, attachment_kind, sent_via_channel, delivery_status, reply_to_message_id')
      .eq('conversation_id', selectedId)
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.error('Error cargando mensajes:', error.message)
          return
        }
        setThread((data ?? []).map(mapRow))
      })

    const channel = supabase
      .channel(`messages_${selectedId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${selectedId}` },
        (payload) => {
          setThread((prev) => {
            if (prev.some((m) => m.id === payload.new.id)) return prev
            return [...prev, mapRow(payload.new)]
          })
        },
      )
      .on(
        // Sin esto, un cambio de "entregado" a "leído" (o el primer
        // "entregado" en sí) nunca se veía reflejado en un chat que ya
        // estaba abierto — solo aparecía al recargar la página.
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${selectedId}` },
        (payload) => {
          setThread((prev) => prev.map((m) => (m.id === payload.new.id ? mapRow(payload.new) : m)))
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [selectedId])

  function scrollThreadToBottom(smooth: boolean) {
    threadEndRef.current?.scrollIntoView({ block: 'end', behavior: smooth ? 'smooth' : 'auto' })
  }

  function handleThreadScroll() {
    const el = threadContainerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const atBottom = distanceFromBottom < 80 // margen chico, no hace falta estar al píxel exacto
    isAtBottomRef.current = atBottom
    setShowJumpToBottom(!atBottom)
  }

  // Al ABRIR un chat, siempre se arranca viendo el último mensaje — eso no
  // cambia. Lo que sí cambia: esto ya no depende de thread.length, así que
  // no vuelve a saltar solo cada vez que llega un mensaje nuevo con el
  // chat ya abierto (ver el efecto de abajo para eso).
  useEffect(() => {
    scrollThreadToBottom(false)
    isAtBottomRef.current = true
    setShowJumpToBottom(false)
  }, [selectedId])

  // Cuando llega un mensaje nuevo (el hilo creció): si lo mandó el propio
  // operador, siempre se ve (recién lo escribió). Si es del cliente, solo
  // salta solo cuando ya se estaba mirando el final del chat — si el
  // operador estaba leyendo mensajes viejos más arriba, no se lo saca de
  // ahí de golpe; en vez de eso aparece la flechita para bajar cuando
  // quiera.
  useEffect(() => {
    const grew = thread.length > prevThreadLengthRef.current
    prevThreadLengthRef.current = thread.length
    if (!grew) return

    const lastMessage = thread[thread.length - 1]
    if (lastMessage?.from === 'operator' || isAtBottomRef.current) {
      scrollThreadToBottom(true)
    } else {
      setShowJumpToBottom(true)
    }
  }, [thread.length])

  // El canal de envío arranca en selected.channel (fijo, el que tenía
  // la conversación al crearse), pero como SMS y WhatsApp comparten una
  // misma conversación, un cliente puede escribir por SMS y después
  // pasarse a WhatsApp sin que ese campo se entere. Esto lo corrige: al
  // cargar (o actualizarse) el hilo, sigue el canal del ÚLTIMO mensaje
  // real del cliente — así la respuesta sale por donde el cliente
  // efectivamente está mirando, en vez de por un canal viejo que ya no
  // usa (la causa más probable de "en RingCentral figura enviado pero
  // el cliente dice que no le llegó nada").
  useEffect(() => {
    if (!selected || (selected.channel !== 'sms' && selected.channel !== 'whatsapp')) return

    const lastContactMsg = [...thread].reverse().find((m) => m.from === 'contact')
    const lastChannel = lastContactMsg?.sentViaChannel
    if ((lastChannel === 'sms' || lastChannel === 'whatsapp') && lastChannel !== sendChannel) {
      setSendChannel(lastChannel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread, selected?.channel])

  useEffect(() => {
    if (!selected) {
      setAvailableChannels([])
      setSendChannel(null)
      return
    }

    setSendChannel(selected.channel)

    supabase
      .from('contact_channels')
      .select('channel')
      .eq('contact_id', selected.contactId)
      .then(({ data }) => {
        const known = new Set((data ?? []).map((r: any) => r.channel as Channel))
        known.add(selected.channel)
        // SMS y WhatsApp siempre están disponibles para escribir (se le
        // puede mandar un mensaje a cualquier teléfono, haya escrito por
        // ese canal antes o no). Facebook/Instagram solo si hay un
        // contact_channels vinculado — eso lo refleja `known`.
        known.add('sms')
        known.add('whatsapp')
        setAvailableChannels(allChannels.filter((c) => known.has(c)))
        setLinkedChannels(known)
      })
  }, [selected?.id, selected?.contactId, selected?.channel])

  useEffect(() => {
    if (presenceChannelRef.current) {
      supabase.removeChannel(presenceChannelRef.current)
      presenceChannelRef.current = null
    }
    typingTimersRef.current.forEach((t) => clearTimeout(t.timer))
    typingTimersRef.current.clear()
    setTypingOperators([])
    isTypingRef.current = false // canal nuevo -> todavía no se mandó ningún aviso en él

    if (!selectedId || !operatorId) return

    // Se usa Broadcast en vez de Presence para el indicador de "está
    // escribiendo...": Presence (track()/untrack()) cuenta contra una
    // cuota chica de Realtime por proyecto, y con un par de operadores
    // tipeando ya se agotaba (ClientPresenceRateLimitReached en los
    // logs). Broadcast es otro canal de Realtime, sin esa cuota.
    const channel = supabase.channel(`typing_${selectedId}`, {
      config: { broadcast: { self: false } },
    })

    channel
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const from = payload as { operatorId?: string; name?: string; typing?: boolean }
        if (!from.operatorId || from.operatorId === operatorId) return

        const existing = typingTimersRef.current.get(from.operatorId)
        if (existing) clearTimeout(existing.timer)

        if (!from.typing) {
          typingTimersRef.current.delete(from.operatorId)
        } else if (from.name) {
          // Si nunca llega el aviso de "dejó de escribir" (cerró la
          // pestaña, se cayó la conexión), se lo saca solo a los pocos
          // segundos en vez de quedar pegado como "escribiendo...".
          const timer = setTimeout(() => {
            typingTimersRef.current.delete(from.operatorId!)
            setTypingOperators(Array.from(typingTimersRef.current.values()).map((v) => v.name))
          }, 6000)
          typingTimersRef.current.set(from.operatorId, { name: from.name, timer })
        }

        setTypingOperators(Array.from(typingTimersRef.current.values()).map((v) => v.name))
      })
      .subscribe()

    presenceChannelRef.current = channel

    return () => {
      supabase.removeChannel(channel)
      presenceChannelRef.current = null
    }
  }, [selectedId, operatorId])

  useEffect(() => {
    const channel = presenceChannelRef.current
    if (!channel) return

    const timeout = setTimeout(() => {
      const hasText = draft.trim().length > 0
      // Solo se manda un aviso en el cambio real de estado (empezó a
      // escribir / borró todo) — no en cada pausa mientras sigue con
      // texto en el campo.
      if (hasText && !isTypingRef.current) {
        channel.send({ type: 'broadcast', event: 'typing', payload: { operatorId, name: operatorName, typing: true } })
        isTypingRef.current = true
      } else if (!hasText && isTypingRef.current) {
        channel.send({ type: 'broadcast', event: 'typing', payload: { operatorId, name: operatorName, typing: false } })
        isTypingRef.current = false
      }
    }, 250)

    return () => clearTimeout(timeout)
  }, [draft, operatorName, operatorId])

  async function copyHeaderPhone() {
    if (!selected) return
    await navigator.clipboard.writeText(phoneForCopy(selected.phone))
    setHeaderPhoneCopied(true)
    setTimeout(() => setHeaderPhoneCopied(false), 1500)
  }

  async function markAsRead() {
    if (!selectedId) return
    const { error, data } = await supabase
      .from('conversations')
      .update({ unread: false })
      .eq('id', selectedId)
      .select('id')
    if (error || !data || data.length === 0) {
      // Si esto falla (0 filas), probablemente la conversación quedó sin
      // asignar (rotación de turno) antes de que llegara el click — se
      // resuelve sola en el próximo refresh porque ahora el operador puede
      // reclamarla, pero avisamos en vez de fallar en silencio.
      toast.error('No se pudo marcar como visto, reintentando...')
      onRefreshConversations?.()
      return
    }
    setConversations((prev) => prev.map((c) => (c.id === selectedId ? { ...c, unread: false } : c)))
  }

  async function reassign(newOperatorId: string) {
    if (!selectedId || !selected) return
    const op = operators.find((o) => o.id === newOperatorId)
    const previousOperatorId = selected.assignedOperatorId

    setConversations((prev) =>
      prev.map((c) =>
        c.id === selectedId
          ? { ...c, assignedOperatorId: newOperatorId, assignedToName: op?.full_name ?? null }
          : c,
      ),
    )
    const { error, data } = await supabase
      .from('conversations')
      .update({ assigned_operator_id: newOperatorId })
      .eq('id', selectedId)
      .select('id')

    if (error || !data || data.length === 0) {
      // El update no pegó de verdad (RLS, condición de carrera, lo que
      // sea) — antes esto quedaba invisible: se veía reasignado del
      // lado de quien lo hizo, pero en la base seguía como estaba.
      toast.error('No se pudo reasignar — revertido. Probá de nuevo.')
      setConversations((prev) =>
        prev.map((c) =>
          c.id === selectedId ? { ...c, assignedOperatorId: previousOperatorId } : c,
        ),
      )
      onRefreshConversations?.()
      return
    }

    // La reasignación manual también mueve carga real entre operadores —
    // si no ajustamos esto acá, el contador de "carga actual" que usa el
    // round robin para repartir de forma pareja queda desincronizado.
    if (previousOperatorId && previousOperatorId !== newOperatorId) {
      await supabase.rpc('decrement_operator_load', { operator_id: previousOperatorId })
    }
    if (newOperatorId !== previousOperatorId) {
      await supabase.rpc('increment_operator_load', { operator_id: newOperatorId })
    }
  }

  async function toggleKeepWithOperator() {
    if (!selectedId || !selected) return
    const next = !selected.keepWithOperator
    setConversations((prev) =>
      prev.map((c) => (c.id === selectedId ? { ...c, keepWithOperator: next } : c)),
    )
    await supabase.from('conversations').update({ keep_with_operator: next }).eq('id', selectedId)
  }

  async function toggleClosed() {
    if (!selected) return
    const closing = selected.status !== 'cerrada'
    const newStatus: ConversationStatus = closing ? 'cerrada' : 'esperando_operador'

    setConversations((prev) =>
      prev.map((c) => (c.id === selectedId ? { ...c, status: newStatus, unread: closing ? false : c.unread } : c)),
    )
    await supabase
      .from('conversations')
      .update(closing ? { status: newStatus, unread: false } : { status: newStatus })
      .eq('id', selectedId)
  }

  async function handleDelete() {
    if (!selected) return
    const confirmed = window.confirm(
      `¿Borrar la conversación con ${selected.name}? Esto elimina también todos sus mensajes y no se puede deshacer.`,
    )
    if (!confirmed) return

    const { error } = await supabase.from('conversations').delete().eq('id', selected.id)
    if (error) {
      toast.error('No se pudo borrar: ' + error.message)
      return
    }
    setConversations((prev) => prev.filter((c) => c.id !== selected.id))
  }

  function toggleSelectId(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function exitBulkSelect() {
    setBulkSelectMode(false)
    setSelectedIds(new Set())
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return
    const confirmed = window.confirm(
      `¿Borrar ${selectedIds.size} conversaciones? Esto elimina también todos sus mensajes y no se puede deshacer.`,
    )
    if (!confirmed) return

    setBulkDeleting(true)
    const ids = Array.from(selectedIds)
    const { error } = await supabase.from('conversations').delete().in('id', ids)
    setBulkDeleting(false)

    if (error) {
      toast.error('No se pudo borrar: ' + error.message)
      return
    }

    setConversations((prev) => prev.filter((c) => !selectedIds.has(c.id)))
    if (selectedId && selectedIds.has(selectedId)) setSelectedId(null)
    toast.success(`${ids.length} conversaciones borradas.`)
    exitBulkSelect()
  }

  async function applySnooze(until: Date | null) {
    if (!selectedId) return
    setConversations((prev) =>
      prev.map((c) => (c.id === selectedId ? { ...c, snoozedUntil: until ? until.toISOString() : null } : c)),
    )
    await supabase
      .from('conversations')
      .update({ snoozed_until: until ? until.toISOString() : null })
      .eq('id', selectedId)
    setShowSnoozeMenu(false)
    setCustomSnooze('')
  }

  function handleEmojiClick(emojiData: { emoji: string }) {
    setDraft((d) => d + emojiData.emoji)
  }

  function handleFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPendingAttachment({
      name: file.name,
      url: URL.createObjectURL(file),
      kind: file.type.startsWith('image/') ? 'image' : 'file',
      blob: file,
    })
    e.target.value = ''
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      audioChunksRef.current = []
      recorder.ondataavailable = (e) => audioChunksRef.current.push(e.data)
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        setPendingAttachment({
          name: `nota-de-voz-${Date.now()}.webm`,
          url: URL.createObjectURL(blob),
          kind: 'audio',
          blob,
        })
        stream.getTracks().forEach((t) => t.stop())
      }
      recorder.start()
      mediaRecorderRef.current = recorder
      setRecording(true)
    } catch {
      toast.error('No se pudo acceder al micrófono. Revisá los permisos del navegador.')
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop()
    setRecording(false)
  }

  async function handleTranslateMessage(id: string, text: string) {
    if (translations[id]) {
      setTranslations((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      return
    }
    setTranslatingId(id)
    try {
      const translated = await translateText(text, 'es')
      setTranslations((prev) => ({ ...prev, [id]: translated }))
    } catch (err) {
      setTranslations((prev) => ({
        ...prev,
        [id]: `⚠️ No se pudo traducir: ${err instanceof Error ? err.message : String(err)}`,
      }))
    }
    setTranslatingId(null)
  }

  async function handleTranslateDraft() {
    if (!draft.trim()) return
    setTranslatingDraft(true)
    try {
      const translated = await translateText(draft, 'en')
      setDraft(translated)
    } catch (err) {
      setSendError(`No se pudo traducir: ${err instanceof Error ? err.message : String(err)}`)
    }
    setTranslatingDraft(false)
  }

  function markThreadStatus(tempId: string, patch: Partial<Message>) {
    setThread((prev) => prev.map((m) => (m.id === tempId ? { ...m, ...patch } : m)))
  }

  function retryMessage(m: Message) {
    setThread((prev) => prev.filter((msg) => msg.id !== m.id))
    setDraft(m.text ?? '')
  }

  async function handleSend(e: React.SyntheticEvent) {
    e.preventDefault()
    if (!selectedId || !operatorId || !sendChannel) return
    if (!draft.trim() && !pendingAttachment) return
    if (selected?.blocked) {
      setSendError('Este contacto está bloqueado — no se le pueden mandar mensajes.')
      return
    }

    const textToSend = draft.trim()
    const attachmentToSend = pendingAttachment
    // Solo tiene sentido mandar la cita si el canal de esta respuesta es
    // WhatsApp — si el cliente venía por SMS y no cambió a WhatsApp, no
    // hay forma de citar nada aunque hubiera quedado "enganchado" algo
    // de antes.
    const replyToMessageIdToSend = sendChannel === 'whatsapp' ? replyingTo?.id : undefined
    const tempId = `temp-${crypto.randomUUID()}`

    // El mensaje aparece al toque, con un estado "Enviando..." — no
    // esperamos a que termine el viaje de red para mostrarlo.
    setThread((prev) => [
      ...prev,
      {
        id: tempId,
        from: 'operator',
        text: textToSend || undefined,
        senderOperatorId: operatorId ?? undefined,
        attachment: attachmentToSend
          ? { name: attachmentToSend.name, url: attachmentToSend.url, kind: attachmentToSend.kind }
          : undefined,
        time: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
        status: 'sending',
        replyToMessageId: replyToMessageIdToSend,
      },
    ])
    setDraft('')
    setPendingAttachment(null)
    setReplyingTo(null)
    setShowEmoji(false)
    setSendError(null)
    if (isTypingRef.current) {
      presenceChannelRef.current?.send({
        type: 'broadcast',
        event: 'typing',
        payload: { operatorId, name: operatorName, typing: false },
      })
      isTypingRef.current = false
    }

    if (attachmentToSend) {
      const path = `${selectedId}/${crypto.randomUUID()}-${attachmentToSend.name}`
      const { error: uploadError } = await supabase.storage.from('attachments').upload(path, attachmentToSend.blob)

      if (uploadError) {
        markThreadStatus(tempId, { status: 'failed' })
        setSendError('No se pudo subir el adjunto: ' + uploadError.message)
        return
      }

      const { data: urlData } = supabase.storage.from('attachments').getPublicUrl(path)

      const { data, error } = await supabase.functions.invoke('send-message', {
        body: {
          conversationId: selectedId,
          channel: sendChannel,
          text: textToSend,
          attachmentUrl: urlData.publicUrl,
          attachmentName: attachmentToSend.name,
          attachmentKind: attachmentToSend.kind,
          replyToMessageId: replyToMessageIdToSend,
        },
      })

      if (error || data?.error) {
        markThreadStatus(tempId, { status: 'failed' })
        setSendError(await getFunctionErrorMessage(error, data))
        return
      }

      markThreadStatus(tempId, { id: data.messageId ?? tempId, status: 'sent' })
    } else {
      const { data, error } = await supabase.functions.invoke('send-message', {
        body: { conversationId: selectedId, channel: sendChannel, text: textToSend, replyToMessageId: replyToMessageIdToSend },
      })

      if (error || data?.error) {
        markThreadStatus(tempId, { status: 'failed' })
        setSendError(await getFunctionErrorMessage(error, data))
        return
      }

      markThreadStatus(tempId, { id: data.messageId ?? tempId, status: 'sent' })
    }
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Columna: lista de conversaciones (ya filtrada desde arriba) */}
      <aside className={`w-full shrink-0 flex-col border-r border-panel-light bg-panel md:flex md:w-80 ${selectedId ? 'hidden md:flex' : 'flex'}`}>
        <div className="border-b border-panel-light px-4 py-3">
          <h2 className="text-base font-bold text-cream">{filterTitle[filter.kind] ?? 'Mensajes'}</h2>
          <p className="mt-0.5 text-xs text-muted">
            {displayedConversations.length} {displayedConversations.length === 1 ? 'conversación' : 'conversaciones'}
            {filter.kind === 'mine' && ' · round robin activo'}
          </p>

          {isSuperAdmin && (
            <div className="mt-2">
              {!bulkSelectMode ? (
                <button
                  onClick={() => setBulkSelectMode(true)}
                  className="rounded-sm border border-panel-light px-2.5 py-1 text-[11px] text-muted hover:border-alert hover:text-alert"
                >
                  Seleccionar conversaciones para borrar
                </button>
              ) : (
                <div className="flex flex-wrap items-center gap-2 rounded-sm border border-alert/40 bg-alert/10 px-2.5 py-1.5">
                  <span className="text-xs text-cream">{selectedIds.size} seleccionadas</span>
                  <button
                    onClick={handleBulkDelete}
                    disabled={selectedIds.size === 0 || bulkDeleting}
                    className="rounded-sm bg-alert px-2.5 py-1 text-[11px] font-medium text-asphalt disabled:opacity-40"
                  >
                    {bulkDeleting ? 'Borrando...' : 'Borrar seleccionadas'}
                  </button>
                  <button
                    onClick={exitBulkSelect}
                    className="rounded-sm border border-panel-light px-2.5 py-1 text-[11px] text-muted hover:text-cream"
                  >
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <button
              onClick={() => onSelectFilter({ kind: filter.kind })}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                !filter.channel ? 'bg-mustard text-asphalt' : 'border border-panel-light text-muted hover:border-mustard hover:text-mustard'
              }`}
            >
              Todos {conversations.length}
            </button>
            {allChannels.map((ch) => {
              const count = conversations.filter((c) => c.channel === ch).length
              const active = filter.channel === ch
              return (
                <button
                  key={ch}
                  onClick={() => onSelectFilter(active ? { kind: filter.kind } : { kind: filter.kind, channel: ch })}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
                    active
                      ? 'border-mustard bg-mustard/10 text-mustard'
                      : 'border-panel-light text-muted hover:border-mustard hover:text-mustard'
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: channelAvatarColor[ch] }} />
                  {channelLabel[ch].split(' ')[0]} {count}
                </button>
              )
            })}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {displayedConversations.length === 0 && (
            <p className="p-4 text-sm text-muted">No hay conversaciones acá.</p>
          )}
          {displayedConversations.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                if (bulkSelectMode) {
                  toggleSelectId(c.id)
                  return
                }
                setSelectedId(c.id)
                setShowEmoji(false)
                setSendError(null)
              }}
              className={`flex w-full items-start gap-3 border-b border-l-2 border-panel-light px-4 py-3 text-left transition-colors ${
                c.status === 'cancelacion' ? 'border-l-alert bg-alert/10 hover:bg-alert/15' : 'border-l-transparent'
              } ${
                bulkSelectMode
                  ? selectedIds.has(c.id)
                    ? 'bg-alert/10'
                    : 'hover:bg-panel-light/60'
                  : c.id === selectedId
                    ? 'bg-panel-light'
                    : 'hover:bg-panel-light/60'
              }`}
            >
              {bulkSelectMode && (
                <span
                  className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border-2 ${
                    selectedIds.has(c.id) ? 'border-alert bg-alert' : 'border-panel-light'
                  }`}
                >
                  {selectedIds.has(c.id) && <Check size={13} className="text-asphalt" />}
                </span>
              )}
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
                style={{ backgroundColor: channelAvatarColor[c.channel] }}
              >
                <ChannelIcon channel={c.channel} size={16} color="white" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`flex min-w-0 items-center gap-1.5 truncate ${c.unread ? 'font-semibold text-cream' : 'font-normal text-muted'}`}
                    title={statusConfig[c.status].label}
                  >
                    <span className="text-xs">{statusConfig[c.status].emoji}</span>
                    <span className="truncate">{c.name}</span>
                    {c.unread && (
                      <span className="shrink-0 rounded-full bg-mustard px-1.5 py-0.5 text-[9px] font-bold uppercase text-asphalt">
                        Nuevo
                      </span>
                    )}
                    {c.vip && <span title="Cliente VIP">⭐</span>}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-muted">{c.time}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className={`truncate text-sm ${c.unread ? 'text-cream' : 'text-muted'}`}>
                    <EmojiText text={c.lastMessage} />
                  </span>
                  {c.unread && <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-mustard" />}
                </div>
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* Columna: hilo de conversación */}
      <main className={`flex-1 flex-col ${selectedId ? 'flex' : 'hidden md:flex'}`}>
        {selected ? (
          <>
            <div className="flex items-center justify-between border-b border-panel-light bg-panel px-4 py-2.5">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelectedId(null)}
                  className="text-cream md:hidden"
                  title="Volver a la lista"
                >
                  <ArrowLeft size={16} />
                </button>
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
                  style={{ backgroundColor: channelAvatarColor[sendChannel ?? selected.channel] }}
                >
                  <ChannelIcon channel={sendChannel ?? selected.channel} size={16} color="white" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-cream">{selected.name}</p>
                  <button
                    type="button"
                    onClick={copyHeaderPhone}
                    title="Copiar número"
                    className="flex items-center gap-1 text-xs text-muted transition-colors hover:text-mustard"
                  >
                    <ChannelIcon channel={sendChannel ?? selected.channel} size={11} />{' '}
                    {channelLabel[sendChannel ?? selected.channel]} · {selected.phone}
                    {headerPhoneCopied ? (
                      <Check size={11} className="text-available" />
                    ) : (
                      <Copy size={11} />
                    )}
                  </button>
                </div>
              </div>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowReassignMenu((v) => !v)}
                  className="flex items-center gap-1.5 rounded-full border border-panel-light bg-asphalt px-3 py-1.5 text-xs text-cream outline-none transition-colors hover:border-mustard focus:border-mustard"
                >
                  {selected.assignedOperatorId
                    ? (operators.find((o) => o.id === selected.assignedOperatorId)?.full_name ?? 'Asignado')
                    : 'Sin asignar'}
                  <ChevronDown size={12} className="text-muted" />
                </button>

                {showReassignMenu && (
                  <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-sm border border-panel-light bg-panel p-1.5 shadow-lg">
                    <div className="mb-1 flex items-center gap-1.5 rounded-sm border border-panel-light bg-asphalt px-2 py-1.5">
                      <Search size={12} className="shrink-0 text-muted" />
                      <input
                        autoFocus
                        value={reassignSearch}
                        onChange={(e) => setReassignSearch(e.target.value)}
                        placeholder="Buscar dispatcher..."
                        className="w-full bg-transparent text-xs text-cream placeholder-muted outline-none"
                      />
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {operators
                        .filter((op) => {
                          const q = reassignSearch.trim().toLowerCase()
                          if (!q) return true
                          return (
                            op.full_name.toLowerCase().includes(q) ||
                            (op.operator_code ?? '').toLowerCase().includes(q)
                          )
                        })
                        .map((op) => (
                          <button
                            key={op.id}
                            type="button"
                            onClick={() => {
                              reassign(op.id)
                              setShowReassignMenu(false)
                              setReassignSearch('')
                            }}
                            className={`block w-full truncate rounded-sm px-2 py-1.5 text-left text-xs transition-colors ${
                              op.id === selected.assignedOperatorId
                                ? 'bg-panel-light text-mustard'
                                : 'text-cream hover:bg-panel-light/60'
                            }`}
                          >
                            {op.operator_code ? `${op.operator_code} · ${op.full_name}` : op.full_name}
                          </button>
                        ))}
                      {operators.filter((op) => {
                        const q = reassignSearch.trim().toLowerCase()
                        if (!q) return true
                        return (
                          op.full_name.toLowerCase().includes(q) ||
                          (op.operator_code ?? '').toLowerCase().includes(q)
                        )
                      }).length === 0 && (
                        <p className="px-2 py-2 text-xs text-muted">Sin resultados</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-b border-panel-light bg-panel px-4 py-2">
              <div className="relative flex items-center gap-2">
                <button
                  onClick={() => setShowContactPanel(true)}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-panel-light text-muted transition-colors hover:border-mustard hover:text-mustard md:hidden"
                  title="Ver datos del contacto"
                >
                  <Info size={13} />
                </button>
                <button
                  onClick={markAsRead}
                  disabled={!selected.unread}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-panel-light text-muted transition-colors hover:border-mustard hover:text-mustard disabled:opacity-40"
                  title="Marcar como visto"
                >
                  <EyeOff size={13} />
                </button>
                <button
                  onClick={toggleClosed}
                  className={`flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                    selected.status === 'cerrada'
                      ? 'border-available/40 text-available hover:bg-available/10'
                      : 'border-alert/40 text-alert hover:bg-alert/10'
                  }`}
                >
                  {selected.status === 'cerrada' ? (
                    <>
                      <RotateCcw size={12} /> Reabrir
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={12} /> Cerrar conversación
                    </>
                  )}
                </button>
                <button
                  onClick={toggleKeepWithOperator}
                  className={`flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${
                    selected.keepWithOperator
                      ? 'border-mustard bg-mustard/10 text-mustard'
                      : 'border-panel-light text-muted hover:border-mustard hover:text-mustard'
                  }`}
                  title={
                    selected.keepWithOperator
                      ? 'Pineada conmigo (se pinea sola al responder o marcar visto; tocá para soltarla)'
                      : 'Mantener conmigo al cambiar de turno'
                  }
                >
                  <Pin size={13} />
                </button>
                {isAdmin && (
                  <button
                    onClick={() => setShowSnoozeMenu((v) => !v)}
                    className={`flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${
                      selected.snoozedUntil
                        ? 'border-mustard bg-mustard/10 text-mustard'
                        : 'border-panel-light text-muted hover:border-mustard hover:text-mustard'
                    }`}
                    title={
                      selected.snoozedUntil
                        ? `Pospuesta hasta ${new Date(selected.snoozedUntil).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
                        : 'Posponer conversación'
                    }
                  >
                    <Clock size={13} />
                  </button>
                )}
                {isAdmin && (
                  <button
                    onClick={handleDelete}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-alert/40 text-alert transition-colors hover:bg-alert/10"
                    title="Borrar conversación (irreversible)"
                  >
                    <Trash2 size={13} />
                  </button>
                )}

                {showSnoozeMenu && (
                  <div className="absolute right-0 top-full z-10 mt-1 w-56 rounded-sm border border-panel-light bg-panel p-2 shadow-lg">
                    <button
                      onClick={() => applySnooze(getSnoozeDate('15m'))}
                      className="block w-full rounded-sm px-2 py-1.5 text-left text-xs text-cream hover:bg-panel-light"
                    >
                      15 minutos
                    </button>
                    <button
                      onClick={() => applySnooze(getSnoozeDate('1h'))}
                      className="block w-full rounded-sm px-2 py-1.5 text-left text-xs text-cream hover:bg-panel-light"
                    >
                      1 hora
                    </button>
                    <button
                      onClick={() => applySnooze(getSnoozeDate('tomorrow'))}
                      className="block w-full rounded-sm px-2 py-1.5 text-left text-xs text-cream hover:bg-panel-light"
                    >
                      Mañana 9am
                    </button>
                    <button
                      onClick={() => applySnooze(getSnoozeDate('monday'))}
                      className="block w-full rounded-sm px-2 py-1.5 text-left text-xs text-cream hover:bg-panel-light"
                    >
                      Próximo lunes 9am
                    </button>
                    <div className="mt-1 flex items-center gap-1 border-t border-panel-light pt-2">
                      <input
                        type="datetime-local"
                        value={customSnooze}
                        onChange={(e) => setCustomSnooze(e.target.value)}
                        className="w-full rounded-sm border border-panel-light bg-asphalt px-1.5 py-1 text-xs text-cream outline-none focus:border-mustard"
                      />
                      <button
                        onClick={() => customSnooze && applySnooze(new Date(customSnooze))}
                        disabled={!customSnooze}
                        className="shrink-0 rounded-sm bg-mustard px-2 py-1 text-xs text-asphalt disabled:opacity-40"
                      >
                        OK
                      </button>
                    </div>
                    {selected.snoozedUntil && (
                      <button
                        onClick={() => applySnooze(null)}
                        className="mt-1 block w-full rounded-sm px-2 py-1.5 text-left text-xs text-alert hover:bg-alert/10"
                      >
                        Quitar snooze
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="relative flex-1 overflow-hidden">
            <div ref={threadContainerRef} onScroll={handleThreadScroll} className="h-full overflow-y-auto px-6 py-4">
              {thread.map((m, i) => {
                const showDaySeparator = m.date && m.date !== thread[i - 1]?.date
                return (
                  <div key={m.id}>
                    {showDaySeparator && (
                      <div className="my-4 flex items-center gap-3">
                        <div className="h-px flex-1 bg-panel-light" />
                        <span className="text-[10px] font-semibold tracking-wide text-muted">
                          {dayLabel(m.date!)}
                        </span>
                        <div className="h-px flex-1 bg-panel-light" />
                      </div>
                    )}
                    <div className={`group mb-3 flex items-end gap-1 ${m.from === 'operator' ? 'justify-end' : 'justify-start'}`}>
                      {m.from === 'operator' && sendChannel === 'whatsapp' && (
                        <button
                          onClick={() => setReplyingTo(m)}
                          className="mb-1 shrink-0 rounded-full p-1 text-muted opacity-0 transition-opacity hover:text-cream group-hover:opacity-100"
                          title="Responder a este mensaje"
                        >
                          <Reply size={14} />
                        </button>
                      )}
                      <div
                        className={`max-w-md break-words px-3 py-2 text-sm ${
                          m.from === 'operator'
                            ? 'rounded-2xl bg-mustard text-asphalt'
                            : 'rounded-2xl bg-panel-light text-cream'
                        } ${m.status === 'sending' ? 'opacity-70' : ''} ${m.status === 'failed' ? 'border border-alert' : ''}`}
                      >
                        {m.from === 'operator' && m.senderOperatorId && (
                          <p className="mb-0.5 text-[10px] font-semibold opacity-70">
                            {operators.find((o) => o.id === m.senderOperatorId)?.full_name ?? 'Operador'}
                          </p>
                        )}
                    {m.from === 'operator' && !m.senderOperatorId && m.status !== 'sending' && (
                      <p className="mb-0.5 text-[10px] font-semibold italic opacity-70">
                        🤖 Mensaje enviado automáticamente
                      </p>
                    )}
                    {m.replyToMessageId && (() => {
                      const quoted = thread.find((t) => t.id === m.replyToMessageId)
                      return (
                        <div
                          className={`mb-1.5 rounded-sm border-l-2 px-2 py-1 text-xs opacity-80 ${
                            m.from === 'operator' ? 'border-asphalt/40 bg-black/10' : 'border-mustard/60 bg-black/20'
                          }`}
                        >
                          <p className="truncate">
                            {quoted
                              ? quoted.text || (quoted.attachment ? `📎 ${quoted.attachment.name}` : 'Mensaje')
                              : 'Mensaje citado'}
                          </p>
                        </div>
                      )
                    })()}
                    {m.text && <p className="break-words">{<Linkify text={m.text} />}</p>}

                    {m.attachment && (
                      <div className="mt-2">
                        {m.attachment.kind === 'image' && (
                          <a href={m.attachment.url} target="_blank" rel="noreferrer" title="Ver en grande">
                            <img
                              src={m.attachment.url}
                              alt={m.attachment.name}
                              className="max-w-[240px] cursor-zoom-in rounded-sm transition-opacity hover:opacity-90"
                            />
                          </a>
                        )}
                        {m.attachment.kind === 'audio' && (
                          <audio controls src={m.attachment.url} className="max-w-[220px]" />
                        )}
                        {m.attachment.kind === 'file' && (
                          <a
                            href={m.attachment.url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1.5 rounded-sm border border-black/10 bg-black/10 px-2 py-1 text-xs hover:opacity-80"
                          >
                            <FileText size={13} /> {m.attachment.name}
                          </a>
                        )}
                      </div>
                    )}

                    {translations[m.id] && (
                      <p className="mt-1 border-t border-black/10 pt-1 text-xs italic opacity-80">
                        {translations[m.id]}
                      </p>
                    )}

                    <div className="mt-1 flex items-center gap-2">
                      {m.status === 'sending' && (
                        <p className="flex items-center gap-1 font-mono text-[10px] italic opacity-70">
                          <Loader2 size={10} className="animate-spin" /> Enviando...
                        </p>
                      )}
                      {m.status === 'failed' && (
                        <button
                          onClick={() => retryMessage(m)}
                          className="font-mono text-[10px] text-alert underline"
                        >
                          Error al enviar — Reintentar
                        </button>
                      )}
                      {m.status !== 'sending' && m.status !== 'failed' && (
                        <p className="flex items-center gap-1 font-mono text-[10px] opacity-60">
                          {m.time}
                          {/* Un solo check: se mandó pero todavía no llegó confirmación
                              de entrega (WhatsApp/RingCentral no avisaron nada más). */}
                          {m.status === 'sent' && <Check size={10} />}
                          {/* Doble check gris: confirmado como entregado — WhatsApp al
                              teléfono del cliente, o RingCentral al operador móvil. */}
                          {m.status === 'delivered' && <CheckCheck size={10} />}
                          {/* Doble check celeste: el cliente ya lo leyó — mismo color
                              que usa WhatsApp para esto. */}
                          {m.status === 'read' && <CheckCheck size={10} className="text-sky-400" />}
                        </p>
                      )}
                      {m.from === 'contact' && m.text && (
                        <button
                          onClick={() => handleTranslateMessage(m.id, m.text!)}
                          className="opacity-60 transition-opacity hover:opacity-100"
                          title="Traducir mensaje"
                        >
                          {translatingId === m.id ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : (
                            <Languages size={11} />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                  {/* Antes esto solo se mostraba en los mensajes del operador — pero
                      como SMS y WhatsApp comparten una misma conversación, un cliente
                      puede escribir por SMS un rato y después por WhatsApp sin que se
                      note en pantalla. Mostrarlo también en los mensajes DEL CLIENTE es
                      lo que permite notar el cambio y contestarle por el canal correcto
                      (si no, la respuesta sale por un canal que el cliente ya no mira, y
                      "no le llega" aunque en RingCentral figure como enviado). */}
                  {m.sentViaChannel && (
                    <span
                      className="mb-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-panel-light bg-panel"
                      title={`${m.from === 'contact' ? 'Escrito por' : 'Enviado por'} ${channelLabel[m.sentViaChannel]}`}
                    >
                      <ChannelIcon channel={m.sentViaChannel} size={11} />
                    </span>
                  )}
                  {m.from === 'contact' && sendChannel === 'whatsapp' && (
                    <button
                      onClick={() => setReplyingTo(m)}
                      className="mb-1 shrink-0 rounded-full p-1 text-muted opacity-0 transition-opacity hover:text-cream group-hover:opacity-100"
                      title="Responder a este mensaje"
                    >
                      <Reply size={14} />
                    </button>
                  )}
                </div>
                  </div>
              )})}
              <div ref={threadEndRef} />
            </div>

            {showJumpToBottom && (
              <button
                onClick={() => {
                  scrollThreadToBottom(true)
                  setShowJumpToBottom(false)
                }}
                className="absolute bottom-4 right-6 flex h-9 w-9 items-center justify-center rounded-full border border-panel-light bg-panel text-cream shadow-lg transition-opacity hover:opacity-90"
                title="Ir al último mensaje"
              >
                <ChevronDown size={18} />
              </button>
            )}
            </div>

            {typingOperators.length > 0 && (
              <p className="border-t border-panel-light bg-panel px-4 pt-2 text-xs italic text-mustard">
                ✍️ {typingOperators.join(', ')} {typingOperators.length === 1 ? 'está' : 'están'} respondiendo...
              </p>
            )}

            {pendingAttachment && (
              <div className="flex flex-wrap gap-2 border-t border-panel-light bg-panel px-4 pt-3">
                <div className="flex items-center gap-1.5 rounded-sm border border-panel-light bg-asphalt px-2 py-1 text-xs text-muted">
                  {pendingAttachment.kind === 'image' && (
                    <img src={pendingAttachment.url} alt={pendingAttachment.name} className="h-6 w-6 rounded-sm object-cover" />
                  )}
                  {pendingAttachment.kind === 'audio' && <Mic size={12} />}
                  {pendingAttachment.kind === 'file' && <FileText size={12} />}
                  <span className="max-w-[160px] truncate">{pendingAttachment.name}</span>
                  <button onClick={() => setPendingAttachment(null)} className="hover:text-alert">
                    <X size={12} />
                  </button>
                </div>
              </div>
            )}

            {sendError && (
              <p className="border-t border-panel-light bg-panel px-4 pt-2 text-xs text-alert">{sendError}</p>
            )}

            {whatsappWindowClosed && !sendError && (
              <p className="border-t border-panel-light bg-panel px-4 pt-2 text-xs text-warning">
                ⚠️ Pasaron más de 24hs desde el último mensaje del cliente por WhatsApp — Meta va a rechazar
                texto libre. Hace falta un template aprobado para reabrir la conversación.
              </p>
            )}

            {selected.blocked ? (
              <div className="flex items-center gap-2 border-t border-panel-light bg-panel px-4 py-3 text-sm text-alert">
                <Ban size={16} /> Contacto bloqueado — no se le pueden mandar mensajes. Desbloqueá desde el panel de
                contacto para volver a escribirle.
              </div>
            ) : (
            <>
            {replyingTo && (
              <div className="flex items-center gap-2 border-t border-panel-light bg-panel px-4 pt-2.5">
                <Reply size={13} className="shrink-0 text-mustard" />
                <div className="min-w-0 flex-1 border-l-2 border-mustard/60 pl-2">
                  <p className="text-[10px] font-semibold text-mustard">Respondiendo a</p>
                  <p className="truncate text-xs text-muted">
                    {replyingTo.text || (replyingTo.attachment ? `📎 ${replyingTo.attachment.name}` : 'Mensaje')}
                  </p>
                </div>
                <button
                  onClick={() => setReplyingTo(null)}
                  className="shrink-0 text-muted hover:text-cream"
                  title="Cancelar respuesta"
                >
                  <X size={14} />
                </button>
              </div>
            )}
            <form
              onSubmit={handleSend}
              className={`relative flex items-center gap-2.5 bg-panel px-4 py-4 ${replyingTo ? 'pt-2.5' : 'border-t border-panel-light'}`}
            >
              {showEmoji && (
                <div className="absolute bottom-full left-4 z-10 mb-2">
                  <EmojiPicker
                    onEmojiClick={handleEmojiClick}
                    theme={(theme === 'light' || theme === 'sand' ? 'light' : 'dark') as any}
                  />
                </div>
              )}

              {availableChannels.length > 1 && (
                <div className="flex shrink-0 items-center gap-1" title="Por qué canal enviar esta respuesta">
                  {allChannels.map((ch) => {
                    const isLinked = linkedChannels.has(ch)
                    const isActive = (sendChannel ?? selected.channel) === ch
                    return (
                      <button
                        key={ch}
                        type="button"
                        disabled={!isLinked}
                        onClick={() => (isLinked ? setSendChannel(ch) : toast.error(`Para mandar por ${channelLabel[ch]} primero vinculá el perfil desde el panel de contacto (Vincular redes sociales).`))}
                        title={
                          isLinked
                            ? `Enviar por ${channelLabel[ch]}`
                            : `${channelLabel[ch]} bloqueado — vinculá el perfil desde el panel de contacto`
                        }
                        className={`flex h-8 w-8 items-center justify-center rounded-sm border transition-colors ${
                          isActive && isLinked
                            ? 'border-mustard bg-mustard/10'
                            : isLinked
                              ? 'border-panel-light hover:border-mustard/50'
                              : 'cursor-pointer border-panel-light opacity-40 hover:opacity-70'
                        }`}
                      >
                        {isLinked ? (
                          <ChannelIcon channel={ch} size={15} color={isActive ? 'var(--color-mustard)' : undefined} />
                        ) : (
                          <Lock size={14} className="text-muted" />
                        )}
                      </button>
                    )
                  })}
                </div>
              )}

              <button
                type="button"
                onClick={() => setShowEmoji((v) => !v)}
                className="shrink-0 text-muted transition-colors hover:text-mustard"
                title="Emojis"
              >
                <Smile size={22} />
              </button>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowTemplates((v) => !v)}
                  className="shrink-0 text-muted transition-colors hover:text-mustard"
                  title="Plantillas"
                >
                  <FileText size={22} />
                </button>
                {showTemplates && (
                  <div className="absolute bottom-full left-0 z-10 mb-2 w-64 rounded-sm border border-panel-light bg-panel p-1.5 shadow-lg">
                    {templates.length === 0 && (
                      <p className="px-2 py-2 text-xs text-muted">No hay plantillas cargadas todavía.</p>
                    )}
                    {templates.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => insertTemplate(t.body)}
                        className="block w-full rounded-sm px-2 py-1.5 text-left text-xs text-cream hover:bg-panel-light"
                      >
                        <span className="font-medium">{t.title}</span>
                        <span className="mt-0.5 block truncate text-muted">{t.body}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!!pendingAttachment}
                className="shrink-0 text-muted transition-colors hover:text-mustard disabled:opacity-40"
                title={pendingAttachment ? 'Ya hay un adjunto cargado' : 'Adjuntar archivo'}
              >
                <Paperclip size={22} />
              </button>
              <input ref={fileInputRef} type="file" onChange={handleFilesSelected} className="hidden" />

              <button
                type="button"
                onClick={recording ? stopRecording : startRecording}
                disabled={!recording && !!pendingAttachment}
                className={`shrink-0 transition-colors disabled:opacity-40 ${
                  recording ? 'text-alert' : 'text-muted hover:text-mustard'
                }`}
                title={recording ? 'Detener grabación' : 'Grabar audio'}
              >
                {recording ? <Square size={21} /> : <Mic size={22} />}
              </button>

              <textarea
                ref={draftInputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  // Enter solo manda el mensaje; Shift+Enter (o Ctrl/Cmd+Enter)
                  // inserta un salto de línea, como en WhatsApp.
                  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                    e.preventDefault()
                    handleSend(e)
                  }
                }}
                placeholder={recording ? 'Grabando audio...' : 'Escribir un mensaje...'}
                rows={1}
                className="max-h-40 w-full resize-none overflow-y-auto rounded-2xl border border-panel-light bg-asphalt px-5 py-3.5 text-base leading-normal text-cream placeholder-muted outline-none focus:border-mustard"
              />

              <button
                type="button"
                onClick={handleTranslateDraft}
                disabled={!draft.trim() || translatingDraft}
                className="shrink-0 text-muted transition-colors hover:text-mustard disabled:opacity-40"
                title="Traducir antes de enviar"
              >
                {translatingDraft ? <Loader2 size={20} className="animate-spin" /> : <Languages size={20} />}
              </button>

              <button
                type="submit"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-mustard text-asphalt transition-opacity hover:opacity-90"
              >
                <Send size={19} />
              </button>
            </form>
            </>
            )}
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted">
            No hay conversaciones para mostrar
          </div>
        )}
      </main>

      {selected && (
        <div
          className={`${
            showContactPanel ? 'fixed inset-0 z-40 flex' : 'hidden'
          } md:static md:z-auto md:flex`}
        >
          <div
            onClick={() => setShowContactPanel(false)}
            className="flex-1 bg-black/50 md:hidden"
          />
          <ContactPanel conversation={selected} onClose={() => setShowContactPanel(false)} />
        </div>
      )}
    </div>
  )
}
