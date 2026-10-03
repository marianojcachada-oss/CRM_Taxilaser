// frontend/src/conversationsData.ts
//
// Select y mapeo compartidos entre la carga principal (App.tsx) y la
// búsqueda (Inbox.tsx) — así las dos consultas devuelven exactamente la
// misma forma de datos, sin duplicar el mapeo en dos lugares que se
// puedan desincronizar.
import type { Conversation } from './ConversationsView'
import { formatMessageTime } from './atlantaTime'

export const CONVERSATION_SELECT = `id, channel, status, unread, last_message_preview, last_message_at, created_at, snoozed_until, last_contact_message_at, keep_with_operator, needs_assignment,
   assigned_operator_id, team, contact_id,
   contacts ( full_name, phone, vip, tags, blocked, total_invertido, servicios_completados, servicios_cancelados, notes, has_active_ride, active_ride_unit, active_ride_color, active_ride_plate, active_ride_eta_minutes, active_ride_eta_received_at, active_ride_status, active_ride_fare, active_ride_completed_at, preferred_channels ),
   operators!conversations_assigned_operator_id_fkey ( full_name )`

export function mapConversation(row: any): Conversation {
  return {
    id: row.id,
    contactId: row.contact_id,
    name: row.contacts?.full_name ?? row.contacts?.phone ?? 'Sin nombre',
    phone: row.contacts?.phone ?? '',
    channel: row.channel,
    lastMessage: row.last_message_preview ?? '',
    time: formatMessageTime(row.last_message_at),
    createdAt: row.created_at,
    snoozedUntil: row.snoozed_until ?? null,
    lastContactMessageAt: row.last_contact_message_at ?? null,
    lastMessageAtRaw: row.last_message_at ?? null,
    keepWithOperator: row.keep_with_operator ?? false,
    needsAssignment: row.needs_assignment ?? true,
    notes: row.contacts?.notes ?? null,
    hasActiveRide: row.contacts?.has_active_ride ?? false,
    activeRideUnit: row.contacts?.active_ride_unit ?? null,
    activeRideColor: row.contacts?.active_ride_color ?? null,
    activeRidePlate: row.contacts?.active_ride_plate ?? null,
    activeRideEtaMinutes: row.contacts?.active_ride_eta_minutes ?? null,
    activeRideEtaReceivedAt: row.contacts?.active_ride_eta_received_at ?? null,
    activeRideStatus: row.contacts?.active_ride_status ?? null,
    activeRideFare: row.contacts?.active_ride_fare ?? null,
    activeRideCompletedAt: row.contacts?.active_ride_completed_at ?? null,
    unread: row.unread,
    status: row.status,
    assignedOperatorId: row.assigned_operator_id,
    assignedToName: row.operators?.full_name ?? null,
    blocked: row.contacts?.blocked ?? false,
    team: row.team,
    vip: row.contacts?.vip ?? false,
    tags: row.contacts?.tags ?? [],
    preferredChannels: row.contacts?.preferred_channels ?? [],
    totalInvertido: row.contacts?.total_invertido ?? null,
    serviciosCompletados: row.contacts?.servicios_completados ?? null,
    serviciosCancelados: row.contacts?.servicios_cancelados ?? null,
  }
}

// Aplica, SIN volver a pedirle nada a la base, los campos "propios" de
// `conversations` que ya vienen completos en el payload de Realtime
// (payload.new de un evento postgres_changes) — lo que falta ahí es
// únicamente lo que sale de los joins (contacts, operators), que esta
// función deliberadamente NO toca: deja esos campos tal cual estaban en
// el estado local.
//
// Solo es seguro usarla cuando YA se confirmó (en App.tsx, comparando
// contra el estado local antes de llamar acá) que ni
// `assigned_operator_id` ni `last_message_at` cambiaron en este evento
// — porque esos dos son justo las dos señales de "puede haber datos del
// join desactualizados": una reasignación cambia el nombre del
// operador, y CUALQUIER mensaje nuevo (del cliente, de un operador, o
// automático — por ejemplo el aviso de "unidad asignada" que manda
// TaxiCaller) puede traer de la mano un cambio en los datos de viaje
// activo del contacto. OJO: a propósito se usa `last_message_at` (TODO
// mensaje) y no `last_contact_message_at` (SOLO mensajes del cliente) —
// un aviso automático no lo escribe el cliente, así que con
// `last_contact_message_at` solo este caso se pasaba por alto y la
// unidad/color/patente se quedaban desactualizados en pantalla hasta el
// próximo mensaje real del cliente. Si cambió cualquiera de los dos
// campos, el llamador tiene que pedir la fila completa
// (patchConversation) en vez de usar esta función.
export function applyConversationPatch(existing: Conversation, row: any): Conversation {
  return {
    ...existing,
    channel: row.channel ?? existing.channel,
    lastMessage: row.last_message_preview ?? '',
    time: formatMessageTime(row.last_message_at),
    createdAt: row.created_at ?? existing.createdAt,
    snoozedUntil: row.snoozed_until ?? null,
    lastContactMessageAt: row.last_contact_message_at ?? null,
    lastMessageAtRaw: row.last_message_at ?? null,
    keepWithOperator: row.keep_with_operator ?? false,
    needsAssignment: row.needs_assignment ?? true,
    unread: row.unread,
    status: row.status,
    team: row.team,
    assignedOperatorId: row.assigned_operator_id,
  }
}
