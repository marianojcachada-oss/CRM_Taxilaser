import { useEffect, useState } from 'react'
import { Copy, Check, Pencil, X, Ban, ShieldCheck, Star, Plus, ChevronDown } from 'lucide-react'
import type { Conversation } from './ConversationsView'
import { channelLabel, ChannelIcon, statusConfig, channelAvatarColor } from './ConversationsView'
import { phoneForCopy } from './phone'
import { supabase } from './supabaseClient'
import { useToast } from './Toast'
import ContactTimeline from './ContactTimeline'
import { getFunctionErrorMessage } from './functionsError'

// TODO: reemplazar por una llamada real a la API de Claude (vía una Edge
// Function de Supabase, para no exponer la API key en el frontend). Con el
// texto del último mensaje (o todo el hilo) alcanza para un resumen útil.
function summarizeIntent(lastMessage: string): string {
  const lower = lastMessage.toLowerCase()

  // Urgente / reclamo — va primero, para que no lo tape ninguna otra regla
  if (
    lower.includes('reclamo') ||
    lower.includes('denuncia') ||
    lower.includes('indignante') ||
    lower.includes('pésimo') ||
    lower.includes('pesimo') ||
    lower.includes('terrible') ||
    lower.includes('quiero hablar con') ||
    lower.includes('demanda')
  ) {
    return '🔴 Reclamo — priorizar respuesta.'
  }
  if (lower.includes('chofer') && (lower.includes('mal') || lower.includes('grose') || lower.includes('maltrat'))) {
    return '🔴 Queja sobre el trato del chofer — priorizar respuesta.'
  }
  if (lower.includes('accidente') || lower.includes('choc')) {
    return '🔴 Menciona un accidente/choque — atender de inmediato.'
  }

  // Cancelación / cambio de plan
  if (lower.includes('cancel')) {
    return 'Quiere cancelar el viaje.'
  }
  if (
    (lower.includes('cambi') && (lower.includes('direcci') || lower.includes('destino') || lower.includes('lugar'))) ||
    lower.includes('mejor que me busque')
  ) {
    return 'Quiere cambiar la dirección o el destino del viaje.'
  }

  // Objeto perdido
  if (lower.includes('olvid') || lower.includes('perdí') || lower.includes('perdi ') || lower.includes('dejé') || lower.includes('deje mi')) {
    return 'Puede haber olvidado algo en el auto — objeto perdido.'
  }

  // Demora / dónde está el chofer
  if (
    lower.includes('dónde está') ||
    lower.includes('donde esta') ||
    lower.includes('cuánto falta') ||
    lower.includes('cuanto falta') ||
    lower.includes('tarda mucho') ||
    lower.includes('hace rato') ||
    lower.includes('sigue esperando')
  ) {
    return 'Pregunta por la demora / dónde está el chofer.'
  }

  // Precio / pago
  if (
    lower.includes('cuánto') ||
    lower.includes('cuanto') ||
    lower.includes('precio') ||
    lower.includes('tarifa') ||
    lower.includes('cuesta') ||
    lower.includes('costo')
  ) {
    return 'Quiere saber el precio o tarifa del viaje.'
  }
  if (lower.includes('efectivo') || lower.includes('tarjeta') || lower.includes('cash') || lower.includes('recibo') || lower.includes('factura')) {
    return 'Consulta sobre forma de pago o recibo/factura.'
  }
  if (lower.includes('cobr') && (lower.includes('mal') || lower.includes('demás') || lower.includes('error'))) {
    return '🟡 Posible disputa de cobro — revisar la tarifa aplicada.'
  }

  // Pedido de viaje nuevo
  if (
    lower.includes('taxi') ||
    lower.includes('auto') ||
    lower.includes('necesito') ||
    lower.includes('reserv') ||
    lower.includes('me busca') ||
    lower.includes('me pasa a buscar')
  ) {
    return 'Está pidiendo un taxi.'
  }

  // Necesidades especiales
  if (lower.includes('silla de ruedas') || lower.includes('discapacidad') || lower.includes('accesib')) {
    return 'Menciona una necesidad de accesibilidad — confirmar que el vehículo sea apto.'
  }
  if (lower.includes('mascota') || lower.includes('perro') || lower.includes('gato')) {
    return 'Pregunta si puede viajar con mascota.'
  }
  if (lower.includes('equipaje') || lower.includes('maleta') || lower.includes('valija')) {
    return 'Menciona equipaje — puede necesitar un vehículo más grande.'
  }

  // Cierre / agradecimiento
  if (lower.includes('gracias') || lower.includes('perfecto') || lower.includes('genial') || lower.includes('buenísimo')) {
    return '🟢 Conversación probablemente resuelta.'
  }

  return 'Consulta general — revisar el hilo completo.'
}

// Sección plegable reutilizable — así el panel no es un scroll larguísimo
// apilando todo siempre abierto.
function Section({
  title,
  defaultOpen = false,
  badge,
  children,
}: {
  title: string
  defaultOpen?: boolean
  badge?: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="mb-1 border-b border-panel-light pb-3 last:border-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between py-1 text-left text-xs text-muted transition-colors hover:text-cream"
      >
        <span className="flex items-center gap-1.5 uppercase tracking-wide">
          {title}
          {badge}
        </span>
        <ChevronDown size={13} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  )
}

type PreviousConversation = { id: string; date: string; summary: string }

type Props = { conversation: Conversation; onClose?: () => void }

export default function ContactPanel({ conversation, onClose }: Props) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [blocked, setBlocked] = useState(conversation.blocked)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!conversation.hasActiveRide) return
    // Cada 30s alcanza y sobra para una cuenta regresiva de minutos — no
    // hace falta nada más seguido, y no pega contra el servidor para nada,
    // es una resta local con lo que ya tenemos.
    const interval = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(interval)
  }, [conversation.hasActiveRide])

  const etaRemaining = (() => {
    if (!conversation.hasActiveRide || conversation.activeRideEtaMinutes == null || !conversation.activeRideEtaReceivedAt) {
      return null
    }
    const elapsedMin = (now - new Date(conversation.activeRideEtaReceivedAt).getTime()) / 60_000
    return Math.max(0, Math.round(conversation.activeRideEtaMinutes - elapsedMin))
  })()
  const [previous, setPrevious] = useState<PreviousConversation[]>([])
  const [tags, setTags] = useState<string[]>(conversation.tags)
  const [preferredChannels, setPreferredChannels] = useState<string[]>(conversation.preferredChannels)
  const [linkChannelOpen, setLinkChannelOpen] = useState<'facebook' | 'instagram' | null>(null)
  const [linkSearch, setLinkSearch] = useState('')
  const [linkResults, setLinkResults] = useState<{ id: string; full_name: string | null }[]>([])
  const [linkSearching, setLinkSearching] = useState(false)
  const [linkedSocials, setLinkedSocials] = useState<{ facebook: boolean; instagram: boolean }>({
    facebook: false,
    instagram: false,
  })
  const [newTag, setNewTag] = useState('')
  const [addingTag, setAddingTag] = useState(false)
  const [savedNotes, setSavedNotes] = useState(conversation.notes ?? '')
  const [draftNotes, setDraftNotes] = useState(conversation.notes ?? '')
  const [savingNotes, setSavingNotes] = useState(false)

  useEffect(() => {
    setTags(conversation.tags)
  }, [conversation.tags])

  useEffect(() => {
    setPreferredChannels(conversation.preferredChannels)
  }, [conversation.preferredChannels])

  useEffect(() => {
    supabase
      .from('contact_channels')
      .select('channel')
      .eq('contact_id', conversation.contactId)
      .in('channel', ['facebook', 'instagram'])
      .then(({ data }) => {
        const set = new Set((data ?? []).map((r: any) => r.channel))
        setLinkedSocials({ facebook: set.has('facebook'), instagram: set.has('instagram') })
      })
  }, [conversation.contactId])

  async function searchContactsToLink() {
    if (!linkSearch.trim()) {
      setLinkResults([])
      return
    }
    setLinkSearching(true)
    // Solo tiene sentido vincular contactos que ya tengan ese canal
    // cargado — si no tiene contact_channels de esa red, no hay nada
    // para vincular.
    const { data } = await supabase
      .from('contacts')
      .select('id, full_name, contact_channels!inner(channel)')
      .ilike('full_name', `%${linkSearch.trim()}%`)
      .eq('contact_channels.channel', linkChannelOpen)
      .neq('id', conversation.contactId)
      .limit(8)
    setLinkResults((data ?? []).map((c: any) => ({ id: c.id, full_name: c.full_name })))
    setLinkSearching(false)
  }

  async function linkChannel(sourceContactId: string) {
    if (!linkChannelOpen) return
    const { data, error } = await supabase.functions.invoke('link-contact-channel', {
      body: { targetContactId: conversation.contactId, sourceContactId, channel: linkChannelOpen },
    })
    if (error || data?.error) {
      toast.error('No se pudo vincular: ' + (await getFunctionErrorMessage(error, data)))
      return
    }
    toast.success(`${channelLabel[linkChannelOpen]} vinculado — ya se puede mandar mensajes por ahí.`)
    setLinkedSocials((prev) => ({ ...prev, [linkChannelOpen]: true }))
    setLinkChannelOpen(null)
    setLinkSearch('')
    setLinkResults([])
  }


  useEffect(() => {
    setSavedNotes(conversation.notes ?? '')
    setDraftNotes(conversation.notes ?? '')
  }, [conversation.contactId, conversation.notes])

  useEffect(() => {
    setBlocked(conversation.blocked)
  }, [conversation.blocked])

  useEffect(() => {
    supabase
      .from('conversations')
      .select('id, last_message_preview, created_at')
      .eq('contact_id', conversation.contactId)
      .eq('status', 'cerrada')
      .neq('id', conversation.id)
      .order('created_at', { ascending: false })
      .limit(5)
      .then(({ data }) => {
        setPrevious(
          (data ?? []).map((row) => ({
            id: row.id,
            date: new Date(row.created_at).toLocaleDateString('es-AR'),
            summary: row.last_message_preview ?? '(sin mensaje)',
          })),
        )
      })
  }, [conversation.contactId, conversation.id])

  function startEditing() {
    setEditName(conversation.name)
    setEditPhone(conversation.phone)
    setEditing(true)
  }

  async function saveEditing() {
    const { error } = await supabase
      .from('contacts')
      .update({ full_name: editName, phone: editPhone })
      .eq('id', conversation.contactId)
    if (error) {
      toast.error('No se pudo guardar: ' + error.message)
      return
    }
    setEditing(false)
  }

  async function copyPhone() {
    await navigator.clipboard.writeText(phoneForCopy(conversation.phone))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  async function toggleBlocked() {
    const next = !blocked
    setBlocked(next)
    const { error } = await supabase.from('contacts').update({ blocked: next }).eq('id', conversation.contactId)
    if (error) {
      toast.error('No se pudo actualizar: ' + error.message)
      setBlocked(!next)
    }
  }

  async function saveNotes() {
    setSavingNotes(true)
    const { error } = await supabase.from('contacts').update({ notes: draftNotes }).eq('id', conversation.contactId)
    setSavingNotes(false)
    if (error) {
      toast.error('No se pudo guardar la nota: ' + error.message)
      return
    }
    setSavedNotes(draftNotes)
  }

  function cancelNotes() {
    setDraftNotes(savedNotes)
  }

  async function togglePreferredChannel(channel: string) {
    const next = preferredChannels.includes(channel)
      ? preferredChannels.filter((c) => c !== channel)
      : [...preferredChannels, channel]

    setPreferredChannels(next) // optimista

    const { error } = await supabase
      .from('contacts')
      .update({ preferred_channels: next })
      .eq('id', conversation.contactId)

    if (error) {
      toast.error('No se pudo guardar la preferencia de canal: ' + error.message)
      setPreferredChannels(preferredChannels) // revertir
    }
  }

  async function addTag() {
    const tag = newTag.trim()
    if (!tag || tags.includes(tag)) return

    setAddingTag(true)
    const nextTags = [...tags, tag]

    const { error } = await supabase.from('contacts').update({ tags: nextTags }).eq('id', conversation.contactId)
    if (error) {
      toast.error('No se pudo agregar el tag: ' + error.message)
      setAddingTag(false)
      return
    }

    setTags(nextTags)
    setNewTag('')
    setAddingTag(false)

    await supabase.from('contact_timeline').insert({
      contact_id: conversation.contactId,
      conversation_id: conversation.id,
      event_type: 'tag_added',
      description: `Tag agregado: ${tag}`,
    })
  }

  const reliability = (() => {
    if (conversation.serviciosCompletados == null && conversation.serviciosCancelados == null) return null
    const completados = conversation.serviciosCompletados ?? 0
    const cancelados = conversation.serviciosCancelados ?? 0
    const total = completados + cancelados
    const pct = total > 0 ? Math.round((completados / total) * 100) : null
    const color = pct === null ? 'text-muted' : pct >= 90 ? 'text-available' : pct >= 70 ? 'text-warning' : 'text-alert'
    return { completados, cancelados, pct, color }
  })()

  const hasName = conversation.name !== conversation.phone && conversation.name !== 'Sin nombre'

  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-l border-panel-light bg-panel px-4 py-4">
      {onClose && (
        <button
          onClick={onClose}
          className="mb-3 flex items-center gap-1 text-xs text-muted hover:text-mustard md:hidden"
        >
          <X size={13} /> Cerrar
        </button>
      )}
      {/* Identidad — siempre visible, no se pliega */}
      {!editing ? (
        <>
          <div className="mb-3 flex items-center gap-3">
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
              style={{ backgroundColor: hasName ? channelAvatarColor[conversation.channel] : '#4A4A4A' }}
            >
              {hasName ? <ChannelIcon channel={conversation.channel} size={18} color="white" /> : '?'}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="flex items-center gap-1.5 truncate font-medium">
                {hasName ? conversation.name : 'Contacto nuevo'}
                {conversation.vip && <Star size={13} className="fill-mustard text-mustard" />}
              </h2>
              <p className="flex items-center gap-1 font-mono text-xs text-muted">
                {conversation.phone}
                <button onClick={copyPhone} className="text-muted transition-colors hover:text-mustard" title="Copiar teléfono">
                  {copied ? <Check size={12} className="text-available" /> : <Copy size={12} />}
                </button>
              </p>
            </div>
            <button
              onClick={startEditing}
              className="shrink-0 text-muted transition-colors hover:text-mustard"
              title="Editar contacto"
            >
              <Pencil size={14} />
            </button>
          </div>

          <div className="mb-4 flex flex-wrap gap-1.5">
            <span className="flex items-center gap-1 rounded-full border border-panel-light px-2 py-0.5 text-[10px] text-cream">
              <ChannelIcon channel={conversation.channel} size={10} /> {channelLabel[conversation.channel]}
            </span>
            {conversation.vip && (
              <span className="rounded-full bg-mustard px-2 py-0.5 text-[10px] font-semibold text-asphalt">
                Cliente frecuente
              </span>
            )}
            {!hasName && (
              <button
                onClick={startEditing}
                className="rounded-full border border-mustard/40 px-2 py-0.5 text-[10px] font-medium text-mustard hover:bg-mustard/10"
              >
                Crear contacto
              </button>
            )}
          </div>

          <button
            onClick={toggleBlocked}
            className={`mb-4 flex items-center gap-1 rounded-sm border px-2 py-1 text-xs transition-colors ${
              blocked
                ? 'border-available/40 text-available hover:opacity-80'
                : 'border-alert/40 text-alert hover:opacity-80'
            }`}
          >
            {blocked ? (
              <>
                <ShieldCheck size={12} /> Desbloquear
              </>
            ) : (
              <>
                <Ban size={12} /> Bloquear
              </>
            )}
          </button>
        </>
      ) : (
        <div className="mb-4 flex flex-col gap-2">
          <div>
            <label className="mb-1 block text-xs text-muted">Nombre</label>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full rounded-sm border border-panel-light bg-asphalt px-2 py-1.5 text-sm text-cream outline-none focus:border-mustard"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Teléfono</label>
            <input
              type="text"
              value={editPhone}
              onChange={(e) => setEditPhone(e.target.value)}
              className="w-full rounded-sm border border-panel-light bg-asphalt px-2 py-1.5 font-mono text-sm text-cream outline-none focus:border-mustard"
            />
          </div>
          <div className="mt-1 flex gap-2">
            <button
              onClick={saveEditing}
              className="flex items-center gap-1 rounded-sm bg-mustard px-2 py-1 text-xs font-medium text-asphalt hover:opacity-90"
            >
              <Check size={12} /> Guardar
            </button>
            <button
              onClick={() => setEditing(false)}
              className="flex items-center gap-1 rounded-sm border border-panel-light px-2 py-1 text-xs text-muted hover:text-cream"
            >
              <X size={12} /> Cancelar
            </button>
          </div>
        </div>
      )}

      {blocked && (
        <div className="mb-4 rounded-sm border border-alert/40 bg-alert/10 px-2 py-1.5 text-xs text-alert">
          Contacto bloqueado
        </div>
      )}

      {/* Estado del servicio — visible siempre, es información de seguridad
          operativa (evitar duplicar carreras). Apenas el servicio deja de
          estar activo (completado o cancelado), vuelve a "No tiene
          servicio" — no se arrastra el resumen del último viaje. */}
      <div
        className={`mb-4 rounded-sm border px-3 py-2.5 ${
          conversation.hasActiveRide ? 'border-warning/40 bg-warning/10' : 'border-panel-light bg-asphalt'
        }`}
      >
        <p className="mb-1 text-[10px] uppercase tracking-wide text-muted">Estado del servicio</p>
        {conversation.hasActiveRide ? (
          <>
            <p className="text-sm font-medium text-warning">
              🚕 Servicio asignado a: {conversation.activeRideUnit || 'unidad sin datos'}
            </p>
            {etaRemaining !== null && (
              <p className="mt-0.5 text-xs text-cream">Tiempo estimado: ~{etaRemaining} min</p>
            )}
            {conversation.activeRideEtaReceivedAt && conversation.activeRideEtaMinutes != null && (
              <p className="mt-1 text-[11px] text-muted">
                Se puso en camino a las{' '}
                {new Date(conversation.activeRideEtaReceivedAt).toLocaleTimeString('es-AR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}{' '}
                (dijo ~{conversation.activeRideEtaMinutes} min en ese momento)
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted">No tiene servicio</p>
        )}
      </div>

      {/* Resumen IA — corto, se deja siempre visible */}
      <div className="mb-4 rounded-sm border border-info/30 bg-info/10 px-2.5 py-2">
        <p className="mb-0.5 text-[10px] uppercase tracking-wide text-info">🤖 Resumen IA</p>
        <p className="text-xs text-cream">{summarizeIntent(conversation.lastMessage)}</p>
      </div>

      {/* A partir de acá, todo plegable */}
      <Section
        title="Detalles"
        defaultOpen
        badge={
          <span className={`normal-case ${statusConfig[conversation.status].color}`}>
            {statusConfig[conversation.status].emoji}
          </span>
        }
      >
        <div className="mb-3">
          <p className="mb-1 text-xs text-muted">Canal</p>
          <span className="flex w-fit items-center gap-1.5 rounded-sm border border-mustard/40 px-1.5 py-0.5 font-mono text-[10px] text-mustard">
            <ChannelIcon channel={conversation.channel} size={12} /> {channelLabel[conversation.channel]}
          </span>
        </div>

        <div className="mb-3">
          <p className="mb-1 text-xs text-muted">Estado</p>
          <span
            className={`inline-flex items-center gap-1.5 rounded-sm border border-panel-light px-1.5 py-0.5 text-xs ${statusConfig[conversation.status].color}`}
          >
            <span>{statusConfig[conversation.status].emoji}</span> {statusConfig[conversation.status].label}
          </span>
        </div>

        <div className="mb-3">
          <p className="mb-1 text-xs text-muted">Bandeja</p>
          <p className="text-xs text-cream">
            {conversation.assignedToName ? `${conversation.assignedToName} · round robin` : 'Sin asignar'}
          </p>
        </div>

        <div className="mb-3">
          <p className="mb-1 text-xs text-muted">Primer contacto</p>
          <p className="text-xs text-cream">
            {new Date(conversation.createdAt).toLocaleString('es-AR', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        </div>

        <div className="mb-3">
          <p className="mb-1 text-xs text-muted">Mensajes automáticos — canal preferido</p>
          <p className="mb-1.5 text-[10px] text-muted">
            Por dónde recibir avisos de cancelación/finalización. Sin ninguno tildado, se manda por SMS
            como siempre.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(['whatsapp', 'sms', 'facebook', 'instagram'] as const).map((channel) => {
              const checked = preferredChannels.includes(channel)
              return (
                <button
                  key={channel}
                  type="button"
                  onClick={() => togglePreferredChannel(channel)}
                  className={`flex items-center gap-1.5 rounded-sm border px-2 py-1 text-xs transition-colors ${
                    checked
                      ? 'border-mustard bg-mustard/10 text-mustard'
                      : 'border-panel-light text-muted hover:border-mustard/50'
                  }`}
                >
                  <span
                    className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${
                      checked ? 'border-mustard bg-mustard' : 'border-panel-light'
                    }`}
                  >
                    {checked && <Check size={10} className="text-asphalt" />}
                  </span>
                  <ChannelIcon channel={channel} size={13} />
                  {channelLabel[channel].split(' ')[0]}
                </button>
              )
            })}
          </div>
        </div>

        <div className="mb-3">
          <p className="mb-1 text-xs text-muted">Vincular redes sociales</p>
          <p className="mb-1.5 text-[10px] text-muted">
            Si esta persona ya te escribió por Facebook o Instagram bajo otro contacto (sin teléfono
            asociado), buscala acá por nombre y vinculala — habilita mandarle mensajes por esa red desde
            este mismo chat.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(['facebook', 'instagram'] as const).map((channel) => {
              const linked = linkedSocials[channel]
              return (
                <button
                  key={channel}
                  type="button"
                  disabled={linked}
                  onClick={() => {
                    setLinkChannelOpen(linkChannelOpen === channel ? null : channel)
                    setLinkSearch('')
                    setLinkResults([])
                  }}
                  className={`flex items-center gap-1.5 rounded-sm border px-2 py-1 text-xs transition-colors ${
                    linked
                      ? 'cursor-default border-available/40 bg-available/10 text-available'
                      : linkChannelOpen === channel
                        ? 'border-mustard bg-mustard/10 text-mustard'
                        : 'border-panel-light text-muted hover:border-mustard/50'
                  }`}
                >
                  <ChannelIcon channel={channel} size={13} />
                  {channelLabel[channel].split(' ')[0]}
                  {linked && <Check size={11} />}
                </button>
              )
            })}
          </div>

          {linkChannelOpen && (
            <div className="mt-2 rounded-sm border border-panel-light bg-asphalt p-2">
              <div className="flex gap-1.5">
                <input
                  autoFocus
                  value={linkSearch}
                  onChange={(e) => setLinkSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && searchContactsToLink()}
                  placeholder={`Buscar por nombre en ${channelLabel[linkChannelOpen]}...`}
                  className="flex-1 rounded-sm border border-panel-light bg-panel px-2 py-1 text-xs text-cream outline-none focus:border-mustard"
                />
                <button
                  onClick={searchContactsToLink}
                  disabled={linkSearching}
                  className="rounded-sm border border-panel-light px-2 py-1 text-xs text-muted hover:border-mustard hover:text-mustard disabled:opacity-50"
                >
                  {linkSearching ? '...' : 'Buscar'}
                </button>
              </div>

              {linkResults.length > 0 && (
                <div className="mt-1.5 flex flex-col gap-1">
                  {linkResults.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => linkChannel(c.id)}
                      className="flex items-center justify-between rounded-sm px-2 py-1 text-left text-xs text-cream hover:bg-panel-light"
                    >
                      {c.full_name || '(sin nombre)'}
                      <span className="text-mustard">Vincular →</span>
                    </button>
                  ))}
                </div>
              )}
              {linkSearch && !linkSearching && linkResults.length === 0 && (
                <p className="mt-1.5 text-[11px] text-muted">
                  Sin resultados — solo aparecen contactos que ya tengan {channelLabel[linkChannelOpen]}{' '}
                  cargado (o sea, que ya hayan escrito por ahí alguna vez).
                </p>
              )}
            </div>
          )}
        </div>

        <div>
          <p className="mb-1 text-xs text-muted">Tags</p>
          {tags.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1">
              {tags.map((tag) => (
                <span key={tag} className="rounded-sm border border-panel-light bg-asphalt px-1.5 py-0.5 text-[10px] text-cream">
                  {tag}
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
              placeholder="Nuevo tag..."
              className="w-full rounded-sm border border-panel-light bg-asphalt px-2 py-1 text-xs text-cream outline-none focus:border-mustard"
            />
            <button
              onClick={addTag}
              disabled={!newTag.trim() || addingTag}
              className="shrink-0 rounded-sm border border-panel-light p-1 text-muted hover:border-mustard hover:text-mustard disabled:opacity-40"
            >
              <Plus size={13} />
            </button>
          </div>
        </div>
      </Section>

      <Section title="Notas" defaultOpen={!!savedNotes} badge={draftNotes !== savedNotes ? <span className="normal-case text-warning">●</span> : undefined}>
        <textarea
          rows={4}
          value={draftNotes}
          onChange={(e) => setDraftNotes(e.target.value)}
          placeholder="Notas internas sobre este cliente..."
          className="w-full resize-none rounded-sm border border-panel-light bg-asphalt px-2 py-1.5 text-xs text-cream outline-none focus:border-mustard"
        />
        <div className="mt-2 flex gap-2">
          <button
            onClick={saveNotes}
            disabled={savingNotes || draftNotes === savedNotes}
            className="flex items-center gap-1 rounded-sm bg-mustard px-2 py-1 text-xs font-medium text-asphalt hover:opacity-90 disabled:opacity-40"
          >
            <Check size={12} /> {savingNotes ? 'Guardando...' : 'Guardar'}
          </button>
          <button
            onClick={cancelNotes}
            disabled={draftNotes === savedNotes}
            className="flex items-center gap-1 rounded-sm border border-panel-light px-2 py-1 text-xs text-muted hover:text-cream disabled:opacity-40"
          >
            <X size={12} /> Cancelar
          </button>
        </div>
      </Section>

      <Section title="Datos de negocio">
        {conversation.totalInvertido && (
          <div className="mb-3">
            <p className="mb-1 text-xs text-muted">Total invertido en la compañía</p>
            <p className="font-mono text-sm text-cream">{conversation.totalInvertido}</p>
            <p className="mt-0.5 text-[10px] text-muted">Dato histórico de TaxiCaller — pendiente de conectar</p>
          </div>
        )}

        {reliability && (
          <div>
            <p className="mb-1 text-xs text-muted">Fiabilidad del cliente</p>
            <p className={`font-mono text-sm ${reliability.color}`}>
              {reliability.pct !== null ? `${reliability.pct}%` : 'Sin datos'}
            </p>
            <p className="text-[10px] text-muted">
              {reliability.completados} completados · {reliability.cancelados} cancelados
            </p>
          </div>
        )}

        {!conversation.totalInvertido && !reliability && (
          <p className="text-xs text-muted">Sin datos todavía — depende de conectar TaxiCaller.</p>
        )}
      </Section>

      <Section title={`Conversaciones anteriores${previous.length ? ` (${previous.length})` : ''}`}>
        {previous.length === 0 && <p className="text-xs text-muted">No hay conversaciones cerradas previas.</p>}
        <div className="flex flex-col gap-1.5">
          {previous.map((p) => (
            <div key={p.id} className="rounded-sm border border-panel-light bg-asphalt px-2 py-1.5 text-xs">
              <p className="text-muted">{p.date}</p>
              <p className="text-cream">{p.summary}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Actividad">
        <ContactTimeline contactId={conversation.contactId} />
      </Section>
    </aside>
  )
}
