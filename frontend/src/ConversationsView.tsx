import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useMatch, useNavigate } from 'react-router-dom'
import {
  Send, X, CheckCircle2, RotateCcw, Check, CheckCheck, ArrowLeft, Info,
  MessageCircle, Smile, Paperclip, Mic, Square, Languages, Loader2, FileText, Lock, Ban, Copy,
  Search, ChevronDown, Sparkles, Reply,
} from 'lucide-react'
import { Suspense } from 'react'
import { lazyWithReload } from './lazyWithReload'
import { channelBrandColor, channelIconColor } from './channelColors'
import twemoji from 'twemoji'
import { SiWhatsapp, SiFacebook, SiInstagram } from '@icons-pack/react-simple-icons'
import ContactPanel from './ContactPanel'
import { supabase } from './supabaseClient'
import { useToast } from './Toast'
import { getFunctionErrorMessage } from './functionsError'
import { usePermissions } from './permissions'
import { phoneForCopy } from './phone'
import { atlantaDateISO, formatMessageTime } from './atlantaTime'

// El selector de emojis pesa bastante: se baja la primera vez que se abre.
const EmojiPicker = lazyWithReload(() => import('emoji-picker-react'))

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

export const channelAvatarColor: Record<Channel, string> = channelBrandColor

// Iniciales para el avatar de la lista: primera letra del primer nombre y,
// si el segundo "nombre" empieza con una letra, también esa. Si el nombre es
// un teléfono o no tiene letras, "#".
export function nameInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letter = (w?: string) => (w && /^\p{L}/u.test(w) ? w[0].toUpperCase() : '')
  const out = letter(words[0]) + letter(words[1])
  return out || '#'
}

const shortStatus: Record<ConversationStatus, string> = {
  esperando_operador: 'Esperando',
  esperando_informacion: 'Falta info',
  esperando_cliente: 'Esperando cliente',
  reclamo: 'Reclamo',
  cancelacion: 'Cancelación',
  cerrada: 'Cerrada',
}

const channelName: Record<Channel, string> = {
  whatsapp: 'WhatsApp',
  facebook: 'Messenger',
  instagram: 'Instagram',
  sms: 'SMS',
}

const channelShort: Record<Channel, string> = {
  sms: 'SMS',
  whatsapp: 'WA',
  facebook: 'FB',
  instagram: 'IG',
}

export function ChannelIcon({ channel, size = 14, color }: { channel: Channel; size?: number; color?: string }) {
  switch (channel) {
    case 'whatsapp':
      return <SiWhatsapp size={size} color={color ?? channelIconColor.whatsapp} />
    case 'facebook':
      return <SiFacebook size={size} color={color ?? channelIconColor.facebook} />
    case 'instagram':
      return <SiInstagram size={size} color={color ?? channelIconColor.instagram} />
    case 'sms':
      return <MessageCircle size={size} color={color ?? channelIconColor.sms} />
  }
}

export type Operator = {
  id: string
  full_name: string
  operator_code?: string | null
  presence?: 'available' | 'offline' | 'busy' | 'apoyo'
}

// Reproductor de audio con salida de emergencia: algunos celulares mandan
// notas de voz por MMS en formatos que Chrome no sabe reproducir (por ejemplo
// AMR o 3GP). En ese caso se ofrece descargar el archivo en vez de dejar un
// reproductor mudo.
function AudioAttachment({ url, name }: { url: string; name: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div className="flex flex-col gap-1 text-xs">
        <span className="opacity-80">El navegador no puede reproducir este formato de audio.</span>
        <a
          href={url}
          download
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 rounded-sm border border-cream/10 bg-cream/10 px-2 py-1 hover:opacity-80"
        >
          <Mic size={13} /> Descargar audio ({name})
        </a>
      </div>
    )
  }
  return <audio controls preload="metadata" src={url} onError={() => setFailed(true)} className="max-w-[220px]" />
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
  // Crudo (ISO), sin formatear — a diferencia de `time`. Se usa para
  // detectar en App.tsx si un UPDATE de Realtime trae un mensaje nuevo
  // (de cliente u operador/automático) y por lo tanto conviene volver a
  // pedir la fila completa con sus joins, en vez de pisar solo los
  // campos propios de `conversations`. Ver applyConversationPatch en
  // conversationsData.ts.
  lastMessageAtRaw?: string | null
  keepWithOperator?: boolean
  notes?: string | null
  hasActiveRide?: boolean
  activeRideUnit?: string | null
  activeRideColor?: string | null
  activeRidePlate?: string | null
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
  // Mensaje al que este responde (cita, como en WhatsApp) — id interno de messages.
  replyToId?: string
  // Fecha/hora exacta (ISO) — se usa para pedir los mensajes anteriores a este.
  createdAt?: string
  // El cliente citó un mensaje que no tenemos guardado: se muestra la cita sin texto.
  replyUnresolved?: boolean
  time: string
  date?: string
  // 'delivered'/'read' solo aplican a WhatsApp (es lo único que manda esos
  // eventos de status) — para los demás canales, un mensaje que no está
  // "sending" ni "failed" se considera simplemente "sent" y no se puede
  // saber más que eso.
  status?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed'
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

type Props = {
  conversations: Conversation[]
  setConversations: React.Dispatch<React.SetStateAction<Conversation[]>>
  operators: Operator[]
  operatorId: string | null
  operatorName: string
  isAdmin: boolean
  isSuperAdmin: boolean
  theme: string
  // Patrón de fondo del chat — preferencia aparte del tema de colores
  // (ver index.css, clases .chat-pattern-*, y ThemePicker.tsx).
  chatPattern: string
  filter: { kind: string; channel?: Channel }
  onSelectFilter: (f: { kind: string; channel?: Channel }) => void
  onRefreshConversations?: () => void
  // true mientras Inbox trae de Supabase la conversación de un link
  // (/chat/:id) que no está en la lista — frena el salto automático.
  resolvingSelection?: boolean
}

const filterTitle: Record<string, string> = {
  all: 'Todos',
  new: 'Sin leer',
  pending: 'Pendientes',
  mine: 'Mías',
  unassigned: 'Sin asignar',
  snoozed: 'Pospuestas',
}

// Cuántos mensajes se cargan por tramo en el chat abierto.
const THREAD_PAGE = 20

export default function ConversationsView({
  conversations,
  setConversations,
  operators,
  operatorId,
  operatorName,
  isAdmin,
  isSuperAdmin,
  theme,
  chatPattern,
  filter,
  onSelectFilter,
  onRefreshConversations,
  resolvingSelection = false,
}: Props) {
  const toast = useToast()
  // La conversación abierta sale de la URL (/chat/:conversationId), no de
  // un useState: así un link compartido o un F5 abren la misma. Elegir
  // otra conversación = navegar. `replace` para los cambios automáticos
  // (no son un "paso" del operador, no tienen que quedar en el historial).
  const navigate = useNavigate()
  const chatMatch = useMatch('/chat/:conversationId')
  const selectedId = chatMatch?.params.conversationId ?? null
  function setSelectedId(id: string | null, opts?: { replace?: boolean }) {
    if (id === selectedId) return
    navigate(id ? `/chat/${id}` : '/', opts)
  }

  // El canal (WA/FB/IG/SMS) es un recorte independiente de la bandeja
  // (Mías/Pendientes/etc) — nunca reemplaza la cuenta de los demás
  // canales, solo decide qué se muestra en la lista.
  // "Sin leer" es otro recorte solo visual de la lista (no toca la base).
  const [onlyUnread, setOnlyUnread] = useState(false)
  const byChannel = useMemo(
    () => (filter.channel ? conversations.filter((c) => c.channel === filter.channel) : conversations),
    [conversations, filter.channel],
  )
  const unreadCount = useMemo(() => byChannel.filter((c) => c.unread).length, [byChannel])
  const displayedConversations = useMemo(
    () => (onlyUnread ? byChannel.filter((c) => c.unread || c.id === selectedId) : byChannel),
    [byChannel, onlyUnread, selectedId],
  )
  const [thread, setThread] = useState<Message[]>([])
  const threadEndRef = useRef<HTMLDivElement>(null)
  // Hilo por tramos: al abrir un chat se cargan solo los últimos THREAD_PAGE
  // mensajes, y al subir se piden los anteriores de a THREAD_PAGE.
  const threadScrollRef = useRef<HTMLDivElement>(null)
  const [hasOlder, setHasOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const restoreScrollRef = useRef<{ height: number; top: number } | null>(null)
  const skipAutoScrollRef = useRef(false)
  const loadingOlderRef = useRef(false)
  const selectedIdRef = useRef<string | null>(null)
  // Mensajes citados que quedaron fuera del tramo cargado (para mostrar la cita igual).
  const [extraQuoted, setExtraQuoted] = useState<Record<string, Message>>({})
  const triedQuotedRef = useRef<Set<string>>(new Set())
  const [draft, setDraft] = useState('')
  // Mensaje que se está citando para la próxima respuesta (solo WhatsApp).
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [showEmoji, setShowEmoji] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [showReassignMenu, setShowReassignMenu] = useState(false)
  const [reassignSearch, setReassignSearch] = useState('')
  const [templates, setTemplates] = useState<{ id: string; title: string; body: string }[]>([])
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null)
  const [recording, setRecording] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  // Botón "Responder con IA" — Etapa 1, testing controlado por
  // superadmin (ver ia-configurable-clientes.md en el proyecto).
  const [aiResponding, setAiResponding] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  // IA externa (Neuralpreneur): estado de la conversación abierta. null = la
  // función todavía no está desplegada o no respondió -> se usa el botón de antes.
  const { can } = usePermissions()
  const [neural, setNeural] = useState<{ mode: string; paused: boolean; humanReplied: boolean; escalated: boolean; assigned: boolean } | null>(null)
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
    // "{{unidad}}" se completa solo con el dato de vehículo que ya
    // viene en vivo desde TaxiCaller (indicativo + auto + año, tal
    // cual lo manda su webhook de "asignado") — no hace falta tocar
    // nada de TaxiCaller ni de la base para que esto funcione.
    const withUnidad = withCode.replaceAll(
      '{{unidad}}',
      selected?.activeRideUnit || '(sin unidad asignada)',
    )
    // "{{color}}" y "{{placa}}" se completan con lo que mandó
    // TaxiCaller en el evento "esperando al pasajero" (el mismo que
    // dispara el SMS automático) — se guardan en el contacto apenas
    // llega ese evento, y siguen guardándose aunque el SMS automático
    // esté apagado desde Integrations, así que esto funciona igual con
    // el automático prendido o apagado.
    const withColor = withUnidad.replaceAll('{{color}}', selected?.activeRideColor || '(sin color)')
    const withPlaca = withColor.replaceAll('{{placa}}', selected?.activeRidePlate || '(sin placa)')
    setDraft((prev) => (prev ? `${prev} ${withPlaca}` : withPlaca))
    setShowTemplates(false)
    // Al elegir una plantilla el click queda en el panel de plantillas,
    // no en el textarea — así, si el operador aprieta Enter de una,
    // onKeyDown del textarea (que es donde vive el atajo de enviar) no
    // lo recibe y no pasa nada hasta que vuelva a clickear el chat. Se
    // devuelve el foco al textarea acá, después del próximo render (el
    // panel de plantillas recién se termina de desmontar en ese
    // momento), y el cursor se deja al final del texto para seguir
    // escribiendo o mandar directo con Enter.
    requestAnimationFrame(() => {
      const el = draftInputRef.current
      if (!el) return
      el.focus()
      const end = el.value.length
      el.setSelectionRange(end, end)
    })
  }

  useEffect(() => {
    // Inbox todavía está trayendo de Supabase la conversación de la URL
    // (link compartido que no está en la lista cargada): no saltar a otra.
    if (resolvingSelection) return
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
        setSelectedId(conversations[0]?.id ?? null, { replace: true })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, resolvingSelection])

  const selected = conversations.find((c) => c.id === selectedId)

  const whatsappWindowClosed =
    sendChannel === 'whatsapp' &&
    (selected?.lastContactMessageAt == null ||
      Date.now() - new Date(selected.lastContactMessageAt).getTime() > 24 * 60 * 60 * 1000)

  function dayLabel(isoDate: string): string {
    // isoDate ya viene en calendario de Atlanta (ver mapRow) — "hoy" y
    // "ayer" se comparan contra el mismo calendario, no el del navegador.
    const todayIso = atlantaDateISO(new Date())

    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayIso = atlantaDateISO(yesterday)

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
      replyToId: m.reply_to_message_id ?? undefined,
      replyUnresolved: !m.reply_to_message_id && !!m.reply_to_external_id,
      time: formatMessageTime(m.created_at),
      createdAt: m.created_at,
      date: atlantaDateISO(m.created_at), // yyyy-mm-dd en calendario de Atlanta, para agrupar por día de forma confiable
      attachment: m.attachment_url
        ? { url: m.attachment_url, name: m.attachment_name ?? 'archivo', kind: (m.attachment_kind ?? 'file') as AttachmentKind }
        : undefined,
      // Un mensaje que ya está guardado en la base (no es el optimista que
      // se agrega al mandar) nunca está "sending" ni "failed" — su estado
      // real es el que haya quedado en delivery_status ("sent" por
      // default para lo viejo que nunca tuvo este campo).
      status: m.sender_type === 'operator' ? (m.delivery_status ?? 'sent') : undefined,
    }
  }

  useEffect(() => {
    setHasOlder(false)
    setLoadingOlder(false)
    loadingOlderRef.current = false
    setExtraQuoted({})
    triedQuotedRef.current = new Set()
    restoreScrollRef.current = null
    skipAutoScrollRef.current = false
    if (!selectedId) {
      setThread([])
      return
    }

    let cancelled = false
    setReplyingTo(null)

    supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', selectedId)
      .order('created_at', { ascending: false })
      .limit(THREAD_PAGE)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.error('Error cargando mensajes:', error.message)
          return
        }
        const rows = data ?? []
        setHasOlder(rows.length >= THREAD_PAGE)
        setThread(rows.slice().reverse().map(mapRow))
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

  // Al abrir un chat, o al llegar un mensaje nuevo, va directo al final
  // del hilo — no tiene que scrollear a mano para ver el último mensaje.
  useEffect(() => {
    // Al sumar mensajes ANTERIORES arriba no hay que saltar al final.
    if (skipAutoScrollRef.current) {
      skipAutoScrollRef.current = false
      return
    }
    threadEndRef.current?.scrollIntoView({ block: 'end' })
  }, [selectedId, thread.length])

  selectedIdRef.current = selectedId

  // Estado de la IA externa en la conversación abierta (se refresca al abrirla
  // y cada vez que llega o sale un mensaje, porque un operador que responde la
  // deja en silencio).
  useEffect(() => {
    if (!selectedId) {
      setNeural(null)
      return
    }
    loadNeuralState(selectedId)
  }, [selectedId, thread.length])

  // Después de sumar mensajes arriba, mantiene en pantalla lo que se estaba leyendo.
  useLayoutEffect(() => {
    const saved = restoreScrollRef.current
    const el = threadScrollRef.current
    if (saved && el) {
      el.scrollTop = saved.top + (el.scrollHeight - saved.height)
      restoreScrollRef.current = null
    }
  }, [thread])

  async function loadOlder() {
    const forId = selectedId
    const oldest = thread[0]?.createdAt
    if (!forId || !oldest || loadingOlderRef.current || !hasOlder) return
    loadingOlderRef.current = true
    setLoadingOlder(true)
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', forId)
      .lt('created_at', oldest)
      .order('created_at', { ascending: false })
      .limit(THREAD_PAGE)
    loadingOlderRef.current = false
    if (selectedIdRef.current !== forId) return // cambió de chat mientras tanto
    setLoadingOlder(false)
    if (error) {
      console.error('Error cargando mensajes anteriores:', error.message)
      return
    }
    const rows = data ?? []
    setHasOlder(rows.length >= THREAD_PAGE)
    const known = new Set(thread.map((m) => m.id))
    const fresh = rows.slice().reverse().filter((r) => !known.has(r.id)).map(mapRow)
    if (fresh.length === 0) return
    const el = threadScrollRef.current
    if (el) restoreScrollRef.current = { height: el.scrollHeight, top: el.scrollTop }
    skipAutoScrollRef.current = true
    setThread((prev) => {
      const ids = new Set(prev.map((m) => m.id))
      return [...fresh.filter((m) => !ids.has(m.id)), ...prev]
    })
  }

  // Si un mensaje cita a otro que quedó fuera del tramo cargado, se lo trae
  // aparte para poder mostrar la cita (autor y texto) igual.
  useEffect(() => {
    const inThread = new Set(thread.map((m) => m.id))
    const missing = [
      ...new Set(
        thread
          .map((m) => m.replyToId)
          .filter((id): id is string => !!id && !inThread.has(id) && !triedQuotedRef.current.has(id)),
      ),
    ]
    if (missing.length === 0) return
    missing.forEach((id) => triedQuotedRef.current.add(id))
    let cancelled = false
    supabase
      .from('messages')
      .select('*')
      .in('id', missing)
      .then(({ data }) => {
        if (cancelled || !data) return
        setExtraQuoted((prev) => {
          const next = { ...prev }
          for (const r of data) next[r.id] = mapRow(r)
          return next
        })
      })
    return () => {
      cancelled = true
    }
  }, [thread])

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

    // Si la tenía Valeria, al pasársela a una persona la IA deja de atenderla.
    if (neural?.assigned) handleReleaseAi()

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

    // Cerrar una conversación la saca del inbox activo (App.tsx solo
    // trae las que NO están cerradas) — si era la única que había en la
    // pestaña/filtro donde estaba el operador, la pantalla se queda sin
    // nada que mostrar ("No hay conversaciones para mostrar"), de
    // golpe. Antes eso no tenía ningún aviso — el reporte de un
    // operador fue justo este: "se actualiza y queda en blanco", como
    // si se hubiera roto algo. No es un error, pero sin este aviso no
    // había forma de saber que fue justamente SU acción de cerrar la
    // que vació la pantalla.
    if (closing) {
      toast.success('Conversación cerrada.')
      // En Mías / Sin leer / Pendientes una conversación cerrada ya no
      // pertenece a la lista, pero seguía abierta por la URL (/chat/:id) y
      // por eso Inbox la volvía a mostrar arriba ("no se me va de Mías").
      // Se suelta la selección para que salga de la lista y el panel pase
      // a la siguiente. En las demás vistas (Todas, Historial, etc.) la
      // cerrada sigue siendo parte de la lista y se deja abierta.
      if (filter.kind === 'mine' || filter.kind === 'new' || filter.kind === 'pending') {
        setSelectedId(null, { replace: true })
      }
    }
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
    // Sacarla también de la URL — si no, el Inbox intentaría volver a
    // traer de Supabase una conversación que ya no existe.
    setSelectedId(null, { replace: true })
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

  // Ctrl+V (o Cmd+V) con una imagen copiada (de una captura de pantalla,
  // de otra conversación, de donde sea) la carga como adjunto, igual que
  // si se hubiera elegido con el clip — queda la misma miniatura de abajo
  // para confirmar antes de mandar. El texto pegado normal (copiar y
  // pegar palabras) sigue andando como siempre: esto no le toca nada si
  // no hay una imagen en el portapapeles.
  function handlePasteImage(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (pendingAttachment) return // ya hay un adjunto cargado, no se puede pegar otro encima
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (!file) continue
        e.preventDefault()
        setPendingAttachment({
          name: file.name || `imagen-pegada-${Date.now()}.png`,
          url: URL.createObjectURL(file),
          kind: 'image',
          blob: file,
        })
        return
      }
    }
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

  // Cuando el envío termina bien, la burbuja optimista (con el id
  // temporal) pasa a tener el id real del mensaje — pero el canal de
  // Realtime de arriba (suscripción a INSERT en "messages") es un
  // camino totalmente aparte, y puede llegar ANTES de que esta llamada
  // HTTP termine. Si eso pasa, cuando llega acá ya existe una fila con
  // el id real en el thread (la que agregó Realtime), y convertir
  // también la burbuja temporal a ese mismo id dejaba las DOS — el
  // duplicado que reportó el operador. Acá se chequea primero: si el
  // id real ya está en el thread, se saca la burbuja temporal en vez
  // de duplicarla.
  function reconcileSentMessage(tempId: string, finalId: string | undefined, patch: Partial<Message>) {
    setThread((prev) => {
      if (finalId && prev.some((m) => m.id === finalId && m.id !== tempId)) {
        return prev.filter((m) => m.id !== tempId)
      }
      return prev.map((m) => (m.id === tempId ? { ...m, ...patch, id: finalId ?? tempId } : m))
    })
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
    const tempId = `temp-${crypto.randomUUID()}`
    // La cita solo existe en WhatsApp (SMS no tiene forma de citar).
    const replyToSend = sendChannel === 'whatsapp' ? replyingTo : null

    // El mensaje aparece al toque, con un estado "Enviando..." — no
    // esperamos a que termine el viaje de red para mostrarlo.
    setThread((prev) => [
      ...prev,
      {
        id: tempId,
        from: 'operator',
        text: textToSend || undefined,
        senderOperatorId: operatorId ?? undefined,
        replyToId: replyToSend?.id,
        attachment: attachmentToSend
          ? { name: attachmentToSend.name, url: attachmentToSend.url, kind: attachmentToSend.kind }
          : undefined,
        time: formatMessageTime(new Date().toISOString()),
        status: 'sending',
      },
    ])
    setDraft('')
    setReplyingTo(null)
    setPendingAttachment(null)
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
          replyToMessageId: replyToSend?.id,
        },
      })

      if (error || data?.error) {
        markThreadStatus(tempId, { status: 'failed' })
        setSendError(await getFunctionErrorMessage(error, data))
        return
      }

      reconcileSentMessage(tempId, data.messageId, { status: 'sent' })
      // Avisa a App.tsx que el operador acaba de participar (se usa para
      // el auto-logout por inactividad — 10 min sin mandar un mensaje).
      window.dispatchEvent(new Event('operator-activity'))
    } else {
      const { data, error } = await supabase.functions.invoke('send-message', {
        body: { conversationId: selectedId, channel: sendChannel, text: textToSend, replyToMessageId: replyToSend?.id },
      })

      if (error || data?.error) {
        markThreadStatus(tempId, { status: 'failed' })
        setSendError(await getFunctionErrorMessage(error, data))
        return
      }

      reconcileSentMessage(tempId, data.messageId, { status: 'sent' })
      window.dispatchEvent(new Event('operator-activity'))
    }
  }

  // "Responder con IA" — manda la respuesta de la IA de verdad al cliente
  // (no es un borrador): ai-respond hace todo el trabajo (genera el texto,
  // lo envía por el canal que corresponda y lo guarda en el historial).
  // Acá solo se llama a la función y se muestra el resultado/error — el
  // mensaje nuevo llega solo por la suscripción de Realtime de siempre.
  async function loadNeuralState(forId: string) {
    const { data, error } = await supabase.functions.invoke('ai-dispatch', {
      body: { action: 'status', conversationId: forId },
    })
    if (selectedIdRef.current !== forId) return
    // Si la consulta falla (cortes de red, función arrancando) se conserva el
    // último estado conocido en vez de esconder los controles de la IA.
    if (error || !data?.ok) {
      console.warn('ai-dispatch status falló:', error?.message ?? data?.error)
      return
    }
    setNeural(data)
  }

  // Con Neuralpreneur prendida, el botón le pide la respuesta a la IA externa
  // (ai-dispatch con force) en vez de usar el motor anterior (ai-respond). La
  // respuesta llega sola por Realtime cuando la IA contesta.
  const NEURAL_REASONS: Record<string, string> = {
    test_mode_not_whitelisted: 'Modo prueba activo: este número no está en la lista de prueba.',
    channel_disabled: 'La IA no está habilitada para el canal de este cliente.',
    contact_blocked: 'Contacto bloqueado o dado de baja.',
    no_webhook_url: 'Falta cargar la URL del webhook en AI (Valeria).',
    mode_off: 'La IA está apagada.',
    not_inbound: 'No hay un mensaje del cliente para responder.',
  }

  async function handleNeuralRequest() {
    if (!selectedId || aiResponding) return
    setAiError(null)
    setAiResponding(true)
    try {
      const { data, error } = await supabase.functions.invoke('ai-dispatch', {
        body: { conversationId: selectedId, force: true },
      })
      if (error || !data?.ok) {
        setAiError(data?.reason ? (NEURAL_REASONS[data.reason] ?? data.reason) : await getFunctionErrorMessage(error, data))
      } else {
        toast.success('Pedido enviado a la IA: la respuesta aparece en unos segundos.')
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err))
    } finally {
      setAiResponding(false)
    }
  }

  // "Valeria (IA)" en el menú "Asignada a": la IA toma la conversación y atiende
  // lo que escriba el cliente hasta que un operador la retome o se la suelte.
  async function handleAssignToAi() {
    if (!selectedId) return
    const { data, error } = await supabase.functions.invoke('ai-dispatch', {
      body: { action: 'assign_ai', conversationId: selectedId },
    })
    if (error || !data?.ok) {
      toast.error(await getFunctionErrorMessage(error, data))
      return
    }
    toast.success(
      data.dispatched
        ? 'Asignada a Valeria: la IA ya está respondiendo.'
        : 'Asignada a Valeria: responderá al próximo mensaje del cliente.',
    )
    loadNeuralState(selectedId)
  }

  async function handleReleaseAi() {
    if (!selectedId) return
    await supabase.functions.invoke('ai-dispatch', { body: { action: 'release_ai', conversationId: selectedId } })
    loadNeuralState(selectedId)
  }

  async function handleNeuralPause(action: 'pause' | 'resume') {
    if (!selectedId) return
    setAiError(null)
    const { data, error } = await supabase.functions.invoke('ai-dispatch', {
      body: { action, conversationId: selectedId },
    })
    if (error || !data?.ok) {
      setAiError(await getFunctionErrorMessage(error, data))
      return
    }
    loadNeuralState(selectedId)
  }

  async function handleAiRespond() {
    if (!selectedId || aiResponding) return
    setAiError(null)
    setAiResponding(true)
    try {
      const { data, error } = await supabase.functions.invoke('ai-respond', {
        body: { conversationId: selectedId },
      })
      if (error || data?.error) {
        setAiError(await getFunctionErrorMessage(error, data))
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err))
    } finally {
      setAiResponding(false)
    }
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Columna: lista de conversaciones (ya filtrada desde arriba) */}
      <aside className={`ui-list w-full shrink-0 flex-col border-r border-panel-light bg-panel md:flex md:w-80 ${selectedId ? 'hidden md:flex' : 'flex'}`}>
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

          <div role="tablist" aria-label="Filtrar por lectura" className="mt-2.5 flex gap-1 rounded-md bg-asphalt p-1">
            {([
              [false, `Todas ${byChannel.length}`],
              [true, `Sin leer ${unreadCount}`],
            ] as const).map(([val, label]) => (
              <button
                key={label}
                type="button"
                role="tab"
                aria-selected={onlyUnread === val}
                onClick={() => setOnlyUnread(val)}
                className={`min-h-8 flex-1 rounded-sm px-2 text-xs font-medium transition-colors ${
                  onlyUnread === val ? 'bg-panel-light text-cream' : 'text-muted hover:text-cream'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

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
            <p className="p-4 text-sm text-muted">{onlyUnread ? 'No hay conversaciones sin leer.' : 'No hay conversaciones acá.'}</p>
          )}
          {displayedConversations.map((c) => (
            <button
              key={c.id}
              data-selected={c.id === selectedId && !bulkSelectMode ? 'true' : undefined}
              onClick={() => {
                if (bulkSelectMode) {
                  toggleSelectId(c.id)
                  return
                }
                setSelectedId(c.id)
                setShowEmoji(false)
                setSendError(null)
              }}
              className={`ui-row flex w-full items-start gap-3 border-b border-l-2 border-panel-light px-4 py-3 text-left transition-colors ${
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
                aria-hidden="true"
                className="ui-avatar flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-panel-light text-sm font-semibold text-cream"
              >
                {nameInitials(c.name)}
                <span aria-hidden="true" className="ui-only ui-chbadge" style={{ backgroundColor: channelAvatarColor[c.channel] }}>
                  <ChannelIcon channel={c.channel} size={8} color="white" />
                </span>
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`flex min-w-0 items-center gap-1.5 truncate ${c.unread ? 'font-semibold text-cream' : 'font-normal text-muted'}`}
                    title={statusConfig[c.status].label}
                  >
                    <span className="text-xs">{statusConfig[c.status].emoji}</span>
                    <span className="min-w-0 truncate">{c.name}</span>
                    {c.hasActiveRide && c.activeRideUnit && (
                      <span title={`Unidad asignada: ${c.activeRideUnit}`} className="inline-flex shrink-0 items-center rounded-md border border-mustard/50 bg-mustard/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-mustard">
                        {c.activeRideUnit.trim().split(/\s+/)[0]}
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
                  <span
                    title={channelLabel[c.channel]}
                    className="ui-hide ml-auto shrink-0 rounded-sm border px-1 font-mono text-[11px] font-semibold leading-4 text-cream"
                    style={{ borderColor: channelAvatarColor[c.channel] }}
                  >
                    {channelShort[c.channel]}
                  </span>
                  {c.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-mustard" aria-label="Sin leer" />}
                </div>
                <div className="ui-only ui-meta mt-1.5 flex-wrap items-center gap-1.5">
                  <span className={`ui-tag ${statusConfig[c.status].color}`}>
                    <span className="ui-tag-t">{shortStatus[c.status]}</span>
                  </span>
                  <span className="ui-tag text-muted">{channelName[c.channel]}</span>
                  {c.unread && <span className="ui-tag ui-tag-accent">Sin leer</span>}
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
            <div className="ui-chathead flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-panel-light bg-panel px-4 py-2.5">
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
                    title="Copiar número" aria-label="Copiar número"
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
              <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowReassignMenu((v) => !v)}
                  className="flex items-center gap-1.5 rounded-full border border-panel-light bg-asphalt px-3 py-1.5 text-xs text-cream outline-none transition-colors hover:border-mustard focus:border-mustard"
                >
                  <span className="ui-lbl text-muted">Asignada a</span>
                  {neural?.assigned && !neural.paused && !neural.humanReplied
                    ? 'Valeria (IA)'
                    : selected.assignedOperatorId
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
                      {(!neural || neural.mode !== 'off') && (reassignSearch.trim() === '' || 'valeria ia'.includes(reassignSearch.trim().toLowerCase())) && (
                        <button
                          type="button"
                          onClick={() => {
                            handleAssignToAi()
                            setShowReassignMenu(false)
                            setReassignSearch('')
                          }}
                          className={`mb-1 flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-xs transition-colors ${
                            neural?.assigned && !neural.paused && !neural.humanReplied
                              ? 'bg-panel-light text-mustard'
                              : 'text-cream hover:bg-panel-light/60'
                          }`}
                        >
                          <Sparkles size={12} className="shrink-0 text-mustard" /> Valeria (IA)
                        </button>
                      )}
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
              <div className="relative flex items-center gap-2">
                <button
                  onClick={() => setShowContactPanel(true)}
                  className="flex h-8 w-8 items-center justify-center max-md:h-11 max-md:w-11 rounded-full border border-panel-light text-muted transition-colors hover:border-mustard hover:text-mustard md:hidden"
                  title="Ver datos del contacto"
                >
                  <Info size={13} />
                </button>
                <button
                  onClick={toggleClosed}
                  data-act="close"
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
                  onClick={markAsRead}
                  data-act="read"
                  disabled={!selected.unread}
                  aria-label="Marcar como visto"
                  className="flex h-8 w-8 items-center justify-center max-md:h-11 max-md:w-11 rounded-full border border-panel-light text-sm leading-none transition-colors hover:border-mustard disabled:opacity-40"
                  title="Marcar como visto"
                >
                  <span aria-hidden="true">👁️</span><span className="ui-lbl">Visto</span>
                </button>
                {can('act.conv_delete') && (
                  <button
                    onClick={handleDelete}
                    data-act="delete"
                    aria-label="Borrar conversación (irreversible)"
                    className="flex h-8 w-8 items-center justify-center max-md:h-11 max-md:w-11 rounded-full border border-alert/40 text-sm leading-none transition-colors hover:bg-alert/10"
                    title="Borrar conversación (irreversible)"
                  >
                    <span aria-hidden="true">🗑️</span><span className="ui-lbl">Borrar</span>
                  </button>
                )}
              </div>
              </div>
            </div>

            <div className="ui-only ui-infostrip flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-panel-light px-5 py-2 text-[11px] text-muted">
              <Sparkles size={11} aria-hidden="true" />
              <b className={statusConfig[selected.status].color}>{statusConfig[selected.status].label}</b>
              <span>·</span>
              <span>
                {selected.assignedOperatorId
                  ? `Asignada a ${operators.find((o) => o.id === selected.assignedOperatorId)?.full_name ?? 'un operador'}`
                  : 'Sin asignar'}
              </span>
              <span>·</span>
              <span>Último mensaje {selected.time}</span>
            </div>

            {/* El patrón de fondo va en un wrapper INTERNO (alto natural,
                según el contenido), no en el contenedor que scrollea —
                puesto directo en el que tiene overflow-y-auto, el fondo
                queda "pegado" al visor y no se mueve junto con los
                mensajes al hacer scroll (es el comportamiento normal de
                un fondo puesto sobre el propio elemento que scrollea).
                Con el patrón en este wrapper de adentro, que es
                contenido normal DENTRO del scroll, se arrastra junto
                con los mensajes como corresponde. min-h-full además
                asegura que cubra toda la pantalla visible aunque haya
                pocos mensajes. */}
            <div
              ref={threadScrollRef}
              onScroll={(e) => {
                if (e.currentTarget.scrollTop < 150) void loadOlder()
              }}
              className="flex-1 overflow-y-auto"
            >
            <div className={`ui-thread chat-pattern-${chatPattern || 'dots'} relative min-h-full px-6 py-4`}>
              {hasOlder && (
                <div className="flex justify-center pb-3">
                  <button
                    type="button"
                    onClick={() => void loadOlder()}
                    disabled={loadingOlder}
                    className="rounded-full border border-panel-light bg-panel px-3 py-1 text-[11px] text-muted transition-colors hover:border-mustard hover:text-mustard disabled:opacity-60"
                  >
                    {loadingOlder ? 'Cargando…' : 'Ver mensajes anteriores'}
                  </button>
                </div>
              )}
              {thread.map((m, i) => {
                const showDaySeparator = m.date && m.date !== thread[i - 1]?.date
                return (
                  <div key={m.id} id={`msg-${m.id}`}>
                    {showDaySeparator && (
                      <div className="my-4 flex items-center gap-3">
                        <div className="h-px flex-1 bg-panel-light" />
                        <span className="text-[10px] font-semibold tracking-wide text-muted">
                          {dayLabel(m.date!)}
                        </span>
                        <div className="h-px flex-1 bg-panel-light" />
                      </div>
                    )}
                    <div className={`mb-3 flex items-end gap-1 ${m.from === 'operator' ? 'justify-end' : 'justify-start'}`}>
                      {m.from === 'contact' && (
                        <span aria-hidden="true" className="ui-only ui-msgavatar">{nameInitials(selected.name)}</span>
                      )}
                      <div className={`flex min-w-0 max-w-md flex-col ${m.from === 'operator' ? 'items-end' : 'items-start'}`}>
                      {m.from === 'operator' && m.senderOperatorId && (
                        <p className="mb-0.5 px-1 text-[11px] font-semibold text-muted">
                          {operators.find((o) => o.id === m.senderOperatorId)?.full_name ?? 'Operador'}
                        </p>
                      )}
                      <div
                        data-from={m.from}
                        className={`ui-bubble max-w-full break-words px-3 py-2 text-sm ${
                          m.from === 'operator' && !m.senderOperatorId && m.status !== 'sending'
                            ? 'rounded-xl border border-dashed border-muted/50 bg-asphalt text-cream'
                            : m.from === 'operator'
                              ? 'rounded-2xl border border-mustard/40 bg-[color-mix(in_srgb,var(--color-mustard)_18%,var(--color-asphalt))] text-cream'
                              : 'rounded-2xl bg-panel-light text-cream'
                        } ${m.status === 'sending' ? 'opacity-70' : ''} ${m.status === 'failed' ? 'border border-alert' : ''}`}
                      >
                    {m.from === 'operator' && !m.senderOperatorId && m.status !== 'sending' && (
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                        🤖 Mensaje automático
                      </p>
                    )}
                    {(m.replyToId || m.replyUnresolved) && (() => {
                      const quoted = m.replyToId ? (thread.find((x) => x.id === m.replyToId) ?? extraQuoted[m.replyToId]) : undefined
                      const quotedInThread = !!m.replyToId && thread.some((x) => x.id === m.replyToId)
                      const quotedAuthor = !quoted
                        ? null
                        : quoted.from === 'contact'
                          ? (selected?.name ?? 'Cliente')
                          : quoted.senderOperatorId
                            ? (operators.find((o) => o.id === quoted.senderOperatorId)?.full_name ?? 'Operador')
                            : 'Mensaje automático'
                      const quotedPreview = !quoted
                        ? 'Respondió a un mensaje anterior (no se pudo recuperar el texto)'
                        : quoted.text
                          ? quoted.text
                          : quoted.attachment?.kind === 'image'
                            ? '📷 Imagen'
                            : quoted.attachment?.kind === 'audio'
                              ? '🎤 Audio'
                              : quoted.attachment
                                ? `📎 ${quoted.attachment.name}`
                                : ''
                      return (
                        <button
                          type="button"
                          disabled={!quotedInThread}
                          onClick={() =>
                            document
                              .getElementById(`msg-${m.replyToId}`)
                              ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
                          }
                          title={quotedInThread ? 'Ir al mensaje citado' : undefined}
                          className="mb-1.5 block w-full rounded-sm border-l-2 border-mustard bg-cream/10 px-2 py-1 text-left"
                        >
                          {quotedAuthor && (
                            <span className="block text-[10px] font-semibold text-mustard">{quotedAuthor}</span>
                          )}
                          <span className="line-clamp-2 block break-words text-xs opacity-80">{quotedPreview}</span>
                        </button>
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
                          <AudioAttachment url={m.attachment.url} name={m.attachment.name} />
                        )}
                        {m.attachment.kind === 'file' && (
                          <a
                            href={m.attachment.url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1.5 rounded-sm border border-cream/10 bg-cream/10 px-2 py-1 text-xs hover:opacity-80"
                          >
                            <FileText size={13} /> {m.attachment.name}
                          </a>
                        )}
                      </div>
                    )}

                    {translations[m.id] && (
                      <p className="mt-1 border-t border-cream/10 pt-1 text-xs italic opacity-80">
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
                          {m.status === 'read' && <CheckCheck size={10} className="text-tick-read" />}
                        </p>
                      )}
                      {sendChannel === 'whatsapp' && m.status !== 'sending' && m.status !== 'failed' && !m.id.startsWith('temp-') && (
                        <button
                          type="button"
                          onClick={() => setReplyingTo(m)}
                          className="opacity-60 transition-opacity hover:opacity-100"
                          title="Responder citando este mensaje"
                        >
                          <Reply size={11} />
                        </button>
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
                </div>
                  </div>
              )})}
              <div ref={threadEndRef} />
            </div>
            </div>

            {typingOperators.length > 0 && (
              <p className="border-t border-panel-light bg-panel px-4 pt-2 text-xs italic text-mustard">
                ✍️ {typingOperators.join(', ')} {typingOperators.length === 1 ? 'está' : 'están'} respondiendo...
              </p>
            )}

            {replyingTo && sendChannel === 'whatsapp' && (
              <div className="flex items-start gap-2 border-t border-panel-light bg-panel px-4 pt-3">
                <div className="min-w-0 flex-1 rounded-sm border-l-2 border-mustard bg-asphalt px-2 py-1">
                  <span className="block text-[10px] font-semibold text-mustard">
                    Respondiendo a{' '}
                    {replyingTo.from === 'contact'
                      ? (selected?.name ?? 'Cliente')
                      : replyingTo.senderOperatorId
                        ? (operators.find((o) => o.id === replyingTo.senderOperatorId)?.full_name ?? 'Operador')
                        : 'Mensaje automático'}
                  </span>
                  <span className="line-clamp-2 block break-words text-xs text-muted">
                    {replyingTo.text ??
                      (replyingTo.attachment?.kind === 'image'
                        ? '📷 Imagen'
                        : replyingTo.attachment?.kind === 'audio'
                          ? '🎤 Audio'
                          : replyingTo.attachment
                            ? `📎 ${replyingTo.attachment.name}`
                            : '')}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setReplyingTo(null)}
                  className="mt-1 text-muted hover:text-alert"
                  title="Cancelar cita"
                >
                  <X size={14} />
                </button>
              </div>
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

            {aiError && (
              <p className="border-t border-panel-light bg-panel px-4 pt-2 text-xs text-alert">IA: {aiError}</p>
            )}

            {/* Etapa 1 de la IA configurable — testing controlado, solo
                vos lo ves. Manda la respuesta de verdad al cliente (no es
                un borrador) — ver ia-configurable-clientes.md. */}
            {neural && neural.mode !== 'off' && !selected.blocked && (
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-panel-light bg-panel px-4 pt-2">
                <span className="mr-auto text-[11px] text-muted">
                  {neural.paused
                    ? neural.escalated
                      ? 'IA: escaló la conversación, espera a un operador'
                      : 'IA: pausada en esta conversación'
                    : neural.humanReplied
                      ? 'IA: en silencio, un operador ya respondió'
                      : neural.assigned
                        ? 'IA: Valeria atiende esta conversación'
                        : neural.mode === 'all'
                        ? 'IA: activa en esta conversación'
                        : 'IA: disponible bajo pedido'}
                </span>
                {neural.assigned && (
                  <button
                    onClick={handleReleaseAi}
                    className="rounded-full border border-panel-light px-3 py-1.5 text-[11px] font-medium text-muted transition-colors hover:border-mustard hover:text-mustard"
                  >
                    Quitar a Valeria
                  </button>
                )}
                {neural.mode === 'all' && (
                  <button
                    onClick={() => handleNeuralPause(neural.paused || neural.humanReplied ? 'resume' : 'pause')}
                    className="rounded-full border border-panel-light px-3 py-1.5 text-[11px] font-medium text-muted transition-colors hover:border-mustard hover:text-mustard"
                  >
                    {neural.paused || neural.humanReplied ? 'Devolver a la IA' : 'Pausar IA'}
                  </button>
                )}
                <button
                  onClick={handleNeuralRequest}
                  disabled={aiResponding}
                  title="Le pide a la IA que responda a este cliente ahora"
                  aria-label="Pedir respuesta a la IA"
                  className="flex items-center gap-1.5 rounded-full border border-mustard/40 px-3 py-1.5 text-[11px] font-medium text-mustard transition-colors hover:bg-mustard/10 disabled:opacity-50"
                >
                  {aiResponding ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  {aiResponding ? 'Pidiendo...' : 'Pedir respuesta a la IA'}
                </button>
              </div>
            )}

            {isSuperAdmin && !selected.blocked && !(neural && neural.mode !== 'off') && (
              <div className="flex items-center justify-end border-t border-panel-light bg-panel px-4 pt-2">
                <button
                  onClick={handleAiRespond}
                  disabled={aiResponding}
                  title="Genera y manda una respuesta de la IA en esta conversación (solo vos la ves — etapa de prueba)" aria-label="Genera y manda una respuesta de la IA en esta conversación (solo vos la ves — etapa de prueba)"
                  className="flex items-center gap-1.5 rounded-full border border-mustard/40 px-3 py-1.5 text-[11px] font-medium text-mustard transition-colors hover:bg-mustard/10 disabled:opacity-50"
                >
                  {aiResponding ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  {aiResponding ? 'Respondiendo...' : 'Responder con IA'}
                </button>
              </div>
            )}

            {selected.blocked ? (
              <div className="flex items-center gap-2 border-t border-panel-light bg-panel px-4 py-3 text-sm text-alert">
                <Ban size={16} /> Contacto bloqueado — no se le pueden mandar mensajes. Desbloqueá desde el panel de
                contacto para volver a escribirle.
              </div>
            ) : (
            <form
              onSubmit={handleSend}
              className="ui-composer relative flex items-center gap-2.5 border-t border-panel-light bg-panel px-4 py-4"
            >
              {showEmoji && (
                <div className="absolute bottom-full left-4 z-10 mb-2">
                  <Suspense fallback={null}>
                    <EmojiPicker
                      onEmojiClick={handleEmojiClick}
                      theme={(theme === 'light' || theme === 'sand' || theme === 'rosa' || theme === 'ig' ? 'light' : 'dark') as any}
                    />
                  </Suspense>
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
                <Smile size={22} /><span className="ui-lbl">Emoji</span>
              </button>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowTemplates((v) => !v)}
                  className="shrink-0 text-muted transition-colors hover:text-mustard"
                  title="Plantillas"
                >
                  <FileText size={22} /><span className="ui-lbl">Plantillas</span>
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
                <Paperclip size={22} /><span className="ui-lbl">Adjuntar</span>
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
                {recording ? <Square size={21} /> : <Mic size={22} />}<span className="ui-lbl">{recording ? 'Detener' : 'Audio'}</span>
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
                onPaste={handlePasteImage}
                placeholder={recording ? 'Grabando audio...' : 'Escribir un mensaje...'}
                rows={1}
                // flex-1 + min-w-0: sin esto, en una ventana angosta o con
                // zoom alto del navegador, los íconos de al lado (todos
                // shrink-0, nunca se achican) se comen todo el ancho y el
                // campo de texto queda reducido a casi nada — con esto, es
                // el textarea el que ocupa siempre el espacio que sobra.
                className="max-h-40 min-w-0 flex-1 resize-none overflow-y-auto rounded-2xl border border-panel-light bg-asphalt px-5 py-3.5 text-base leading-normal text-cream placeholder-muted outline-none focus:border-mustard"
              />

              <button
                type="button"
                onClick={handleTranslateDraft}
                disabled={!draft.trim() || translatingDraft}
                className="shrink-0 text-muted transition-colors hover:text-mustard disabled:opacity-40"
                title="Traducir antes de enviar" aria-label="Traducir antes de enviar"
              >
                {translatingDraft ? <Loader2 size={20} className="animate-spin" /> : <Languages size={20} />}<span className="ui-lbl">Traducir</span>
              </button>

              <span className="ui-only ui-hint">
                {channelName[sendChannel ?? selected.channel]} · Enter para enviar, Shift + Enter para nueva línea
              </span>

              <button
                type="submit"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-mustard text-asphalt transition-opacity hover:opacity-90"
              >
                <Send size={19} /><span className="ui-lbl">Enviar</span>
              </button>
            </form>
            )}
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center text-sm text-muted">
            <p>No hay conversaciones para mostrar acá</p>
            <p className="text-xs">Probá con otra pestaña (arriba a la izquierda) o esperá a que entre una nueva.</p>
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
