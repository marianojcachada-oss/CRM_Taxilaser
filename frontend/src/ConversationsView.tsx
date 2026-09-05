import { useEffect, useRef, useState } from 'react'
import {
  Send, X, EyeOff, CheckCircle2, RotateCcw, Trash2, Clock, Check, Pin, ArrowLeft, Info,
  MessageCircle, Smile, Paperclip, Mic, Square, Languages, Loader2, FileText,
} from 'lucide-react'
import EmojiPicker from 'emoji-picker-react'
import { SiWhatsapp, SiFacebook, SiInstagram } from '@icons-pack/react-simple-icons'
import ContactPanel from './ContactPanel'
import { supabase } from './supabaseClient'
import { useToast } from './Toast'
import { getFunctionErrorMessage } from './functionsError'

export type Channel = 'whatsapp' | 'facebook' | 'instagram' | 'sms'

export type ConversationStatus =
  | 'esperando_operador'
  | 'esperando_informacion'
  | 'esperando_cliente'
  | 'reclamo'
  | 'cerrada'

export const statusConfig: Record<ConversationStatus, { emoji: string; label: string; color: string }> = {
  esperando_operador: { emoji: '🟢', label: 'Cliente esperando respuesta', color: 'text-available' },
  esperando_informacion: { emoji: '🟡', label: 'Cliente esperando información', color: 'text-warning' },
  esperando_cliente: { emoji: '🔵', label: 'Esperando respuesta del cliente', color: 'text-info' },
  reclamo: { emoji: '🔴', label: 'Cliente enojado', color: 'text-alert' },
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

export function ChannelIcon({ channel, size = 14 }: { channel: Channel; size?: number }) {
  switch (channel) {
    case 'whatsapp':
      return <SiWhatsapp size={size} color="#25D366" />
    case 'facebook':
      return <SiFacebook size={size} color="#1877F2" />
    case 'instagram':
      return <SiInstagram size={size} color="#E1306C" />
    case 'sms':
      return <MessageCircle size={size} color="#FF7A00" />
  }
}

export type Operator = { id: string; full_name: string }

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
  status?: 'sending' | 'sent' | 'failed'
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
  theme: string
  filter: { kind: string; channel?: Channel }
  onSelectFilter: (f: { kind: 'channel'; channel: Channel }) => void
}

const filterTitle: Record<string, string> = {
  new: 'Nuevas',
  pending: 'Pendientes',
  mine: 'Mías',
  channel: 'Filtradas',
  snoozed: 'Pospuestas',
}

export default function ConversationsView({
  conversations,
  setConversations,
  operators,
  operatorId,
  operatorName,
  isAdmin,
  theme,
  filter,
  onSelectFilter,
}: Props) {
  const toast = useToast()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [thread, setThread] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [showEmoji, setShowEmoji] = useState(false)
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null)
  const [recording, setRecording] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [translations, setTranslations] = useState<Record<string, string>>({})
  const [translatingId, setTranslatingId] = useState<string | null>(null)
  const [translatingDraft, setTranslatingDraft] = useState(false)
  const [availableChannels, setAvailableChannels] = useState<Channel[]>([])
  const [sendChannel, setSendChannel] = useState<Channel | null>(null)
  const [typingOperators, setTypingOperators] = useState<string[]>([])
  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false)
  const [customSnooze, setCustomSnooze] = useState('')
  const [showContactPanel, setShowContactPanel] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const presenceChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  useEffect(() => {
    if (!conversations.some((c) => c.id === selectedId)) {
      setSelectedId(conversations[0]?.id ?? null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations])

  const selected = conversations.find((c) => c.id === selectedId)

  const whatsappWindowClosed =
    sendChannel === 'whatsapp' &&
    (selected?.lastContactMessageAt == null ||
      Date.now() - new Date(selected.lastContactMessageAt).getTime() > 24 * 60 * 60 * 1000)

  function mapRow(m: any): Message {
    return {
      id: m.id,
      from: m.sender_type === 'operator' ? 'operator' : 'contact',
      text: m.content ?? undefined,
      sentViaChannel: m.sent_via_channel ?? null,
      senderOperatorId: m.sender_operator_id ?? undefined,
      time: new Date(m.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
      date: new Date(m.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }),
      attachment: m.attachment_url
        ? { url: m.attachment_url, name: m.attachment_name ?? 'archivo', kind: (m.attachment_kind ?? 'file') as AttachmentKind }
        : undefined,
    }
  }

  useEffect(() => {
    if (!selectedId) {
      setThread([])
      return
    }

    let cancelled = false

    supabase
      .from('messages')
      .select('id, sender_type, sender_operator_id, content, created_at, attachment_url, attachment_name, attachment_kind, sent_via_channel')
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
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [selectedId])

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
        setAvailableChannels(allChannels.filter((c) => known.has(c)))
      })
  }, [selected?.id, selected?.contactId, selected?.channel])

  useEffect(() => {
    if (presenceChannelRef.current) {
      supabase.removeChannel(presenceChannelRef.current)
      presenceChannelRef.current = null
    }
    setTypingOperators([])

    if (!selectedId || !operatorId) return

    const channel = supabase.channel(`typing_${selectedId}`, {
      config: { presence: { key: operatorId } },
    })

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<{ name: string }>()
        const names = Object.entries(state)
          .filter(([key]) => key !== operatorId)
          .map(([, entries]) => entries[0]?.name)
          .filter(Boolean) as string[]
        setTypingOperators(names)
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
      if (draft.trim()) {
        channel.track({ name: operatorName })
      } else {
        channel.untrack()
      }
    }, 250)

    return () => clearTimeout(timeout)
  }, [draft, operatorName])

  async function markAsRead() {
    if (!selectedId) return
    setConversations((prev) => prev.map((c) => (c.id === selectedId ? { ...c, unread: false } : c)))
    await supabase.from('conversations').update({ unread: false }).eq('id', selectedId)
  }

  async function reassign(newOperatorId: string) {
    if (!selectedId) return
    const op = operators.find((o) => o.id === newOperatorId)
    setConversations((prev) =>
      prev.map((c) =>
        c.id === selectedId
          ? { ...c, assignedOperatorId: newOperatorId, assignedToName: op?.full_name ?? null }
          : c,
      ),
    )
    await supabase.from('conversations').update({ assigned_operator_id: newOperatorId }).eq('id', selectedId)
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

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedId || !operatorId || !sendChannel) return
    if (!draft.trim() && !pendingAttachment) return

    const textToSend = draft.trim()
    const attachmentToSend = pendingAttachment
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
      },
    ])
    setDraft('')
    setPendingAttachment(null)
    setShowEmoji(false)
    setSendError(null)
    presenceChannelRef.current?.untrack()

    if (attachmentToSend) {
      const path = `${selectedId}/${crypto.randomUUID()}-${attachmentToSend.name}`
      const { error: uploadError } = await supabase.storage.from('attachments').upload(path, attachmentToSend.blob)

      if (uploadError) {
        markThreadStatus(tempId, { status: 'failed' })
        setSendError('No se pudo subir el adjunto: ' + uploadError.message)
        return
      }

      const { data: urlData } = supabase.storage.from('attachments').getPublicUrl(path)

      const { data: inserted, error: insertError } = await supabase
        .from('messages')
        .insert({
          conversation_id: selectedId,
          sender_type: 'operator',
          sender_operator_id: operatorId,
          content: textToSend || null,
          attachment_url: urlData.publicUrl,
          attachment_name: attachmentToSend.name,
          attachment_kind: attachmentToSend.kind,
          sent_via_channel: sendChannel,
        })
        .select('id')
        .single()

      if (insertError) {
        markThreadStatus(tempId, { status: 'failed' })
        setSendError('No se pudo enviar: ' + insertError.message)
        return
      }

      markThreadStatus(tempId, { id: inserted.id, status: 'sent' })
    } else {
      const { data, error } = await supabase.functions.invoke('send-message', {
        body: { conversationId: selectedId, channel: sendChannel, text: textToSend },
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
            {conversations.length} {conversations.length === 1 ? 'conversación' : 'conversaciones'}
            {filter.kind === 'mine' && ' · round robin activo'}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-mustard px-3 py-1 text-xs font-medium text-asphalt">
              Todos {conversations.length}
            </span>
            {allChannels.map((ch) => {
              const count = conversations.filter((c) => c.channel === ch).length
              const active = filter.kind === 'channel' && filter.channel === ch
              return (
                <button
                  key={ch}
                  onClick={() => onSelectFilter({ kind: 'channel', channel: ch })}
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
          {conversations.length === 0 && (
            <p className="p-4 text-sm text-muted">No hay conversaciones acá.</p>
          )}
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setSelectedId(c.id)
                setShowEmoji(false)
                setSendError(null)
              }}
              className={`flex w-full items-start gap-3 border-b border-panel-light px-4 py-3 text-left transition-colors ${
                c.id === selectedId ? 'bg-panel-light' : 'hover:bg-panel-light/60'
              }`}
            >
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
                style={{ backgroundColor: channelAvatarColor[c.channel] }}
              >
                {c.name.slice(0, 2).toUpperCase()}
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
                    {c.lastMessage}
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
                  style={{ backgroundColor: channelAvatarColor[selected.channel] }}
                >
                  {selected.name.slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <p className="text-sm font-semibold text-cream">{selected.name}</p>
                  <p className="flex items-center gap-1 text-xs text-muted">
                    <ChannelIcon channel={selected.channel} size={11} /> {channelLabel[selected.channel]} · {selected.phone}
                  </p>
                </div>
              </div>
              <select
                value={selected.assignedOperatorId ?? ''}
                onChange={(e) => reassign(e.target.value)}
                className="rounded-full border border-panel-light bg-asphalt px-3 py-1.5 text-xs text-cream outline-none focus:border-mustard"
              >
                <option value="" disabled>
                  Sin asignar
                </option>
                {operators.map((op) => (
                  <option key={op.id} value={op.id}>
                    {op.full_name}
                  </option>
                ))}
              </select>
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
                  title={selected.keepWithOperator ? 'No rota al cambiar de turno (tocá para sacar)' : 'Mantener conmigo al cambiar de turno'}
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

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {thread.map((m) => (
                <div
                  key={m.id}
                  className={`mb-3 flex ${m.from === 'operator' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-md px-3 py-2 text-sm ${
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
                    {m.text && <p>{m.text}</p>}

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
                          {m.status === 'sent' && <Check size={10} />}
                          {m.from === 'operator' && m.sentViaChannel && m.sentViaChannel !== selected.channel && (
                            <> · vía {channelLabel[m.sentViaChannel]}</>
                          )}
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
                </div>
              ))}
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

            <form
              onSubmit={handleSend}
              className="relative flex items-center gap-1.5 border-t border-panel-light bg-panel px-4 py-3"
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
                <select
                  value={sendChannel ?? selected.channel}
                  onChange={(e) => setSendChannel(e.target.value as Channel)}
                  title="Por qué canal enviar esta respuesta"
                  className="shrink-0 rounded-sm border border-panel-light bg-asphalt px-1.5 py-2 text-xs text-cream outline-none focus:border-mustard"
                >
                  {availableChannels.map((ch) => (
                    <option key={ch} value={ch}>
                      {channelLabel[ch]}
                    </option>
                  ))}
                </select>
              )}

              <button
                type="button"
                onClick={() => setShowEmoji((v) => !v)}
                className="shrink-0 text-muted transition-colors hover:text-mustard"
                title="Emojis"
              >
                <Smile size={18} />
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!!pendingAttachment}
                className="shrink-0 text-muted transition-colors hover:text-mustard disabled:opacity-40"
                title={pendingAttachment ? 'Ya hay un adjunto cargado' : 'Adjuntar archivo'}
              >
                <Paperclip size={18} />
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
                {recording ? <Square size={17} /> : <Mic size={18} />}
              </button>

              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={recording ? 'Grabando audio...' : 'Escribir un mensaje...'}
                className="w-full rounded-full border border-panel-light bg-asphalt px-4 py-2.5 text-sm text-cream placeholder-muted outline-none focus:border-mustard"
              />

              <button
                type="button"
                onClick={handleTranslateDraft}
                disabled={!draft.trim() || translatingDraft}
                className="shrink-0 text-muted transition-colors hover:text-mustard disabled:opacity-40"
                title="Traducir antes de enviar"
              >
                {translatingDraft ? <Loader2 size={17} className="animate-spin" /> : <Languages size={17} />}
              </button>

              <button
                type="submit"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-mustard text-asphalt transition-opacity hover:opacity-90"
              >
                <Send size={16} />
              </button>
            </form>
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
