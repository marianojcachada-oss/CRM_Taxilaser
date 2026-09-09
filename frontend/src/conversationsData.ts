// frontend/src/conversationsData.ts
//
// Select y mapeo compartidos entre la carga principal (App.tsx) y la
// búsqueda (Inbox.tsx) — así las dos consultas devuelven exactamente la
// misma forma de datos, sin duplicar el mapeo en dos lugares que se
// puedan desincronizar.
import type { Conversation } from './ConversationsView'

export const CONVERSATION_SELECT = `id, channel, status, unread, last_message_preview, last_message_at, created_at, snoozed_until, last_contact_message_at, keep_with_operator, needs_assignment,
   assigned_operator_id, team, contact_id,
   contacts ( full_name, phone, vip, tags, blocked, total_invertido, servicios_completados, servicios_cancelados, notes, has_active_ride, active_ride_unit, active_ride_eta_minutes, active_ride_eta_received_at, active_ride_status, active_ride_fare, active_ride_completed_at, preferred_channels ),
   operators ( full_name )`

export function mapConversation(row: any): Conversation {
  return {
    id: row.id,
    contactId: row.contact_id,
    name: row.contacts?.full_name ?? row.contacts?.phone ?? 'Sin nombre',
    phone: row.contacts?.phone ?? '',
    channel: row.channel,
    lastMessage: row.last_message_preview ?? '',
    time: row.last_message_at
      ? new Date(row.last_message_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
      : '',
    createdAt: row.created_at,
    snoozedUntil: row.snoozed_until ?? null,
    lastContactMessageAt: row.last_contact_message_at ?? null,
    keepWithOperator: row.keep_with_operator ?? false,
    needsAssignment: row.needs_assignment ?? true,
    notes: row.contacts?.notes ?? null,
    hasActiveRide: row.contacts?.has_active_ride ?? false,
    activeRideUnit: row.contacts?.active_ride_unit ?? null,
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
