// supabase/functions/_shared/rule-engine-adapters/taxiLaserReservationProvider.ts
//
// Implementacion REAL del puerto ReservationProvider para "Que tal?".
//
// getActiveRide: lee directo de contacts.active_ride_* -- el mismo dato
// que ya usa ai-respond hoy para armar el contextNote. Nunca llama a
// TaxiCaller en vivo (ya esta sincronizado por los webhooks existentes).
//
// createReservation: NO crea un viaje en TaxiCaller (la API "Place Order"
// todavia no esta integrada). Solo inserta una fila en ai_ride_requests y
// marca needs_assignment=true en la conversacion, para que un operador la
// vea en su cola y la cree el mismo en TaxiCaller -- consistente con que
// las reglas IMMEDIATE_RIDE/SCHEDULED_RIDE solo prometen "un operador te
// lo va a confirmar", nunca una unidad real.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ActiveRide, ReservationProvider, RideRequestInput } from "../rule-engine/providers/ReservationProvider.ts";

export class TaxiLaserReservationProvider implements ReservationProvider {
  constructor(
    private readonly client: SupabaseClient,
    /** contact ya resuelto por ai-respond para esta conversacion (evita una consulta extra). */
    private readonly contact: {
      id: string;
      has_active_ride?: boolean | null;
      active_ride_unit?: string | null;
      active_ride_color?: string | null;
      active_ride_plate?: string | null;
      active_ride_status?: string | null;
      active_ride_eta_minutes?: number | null;
    },
  ) {}

  async getActiveRide(_conversationId: string): Promise<ActiveRide | null> {
    if (!this.contact.has_active_ride) return null;
    return {
      unit: this.contact.active_ride_unit ?? null,
      color: this.contact.active_ride_color ?? null,
      plate: this.contact.active_ride_plate ?? null,
      status: this.contact.active_ride_status ?? null,
      etaMinutes: this.contact.active_ride_eta_minutes ?? null,
    };
  }

  async createReservation(input: RideRequestInput): Promise<void> {
    const { error: insertError } = await this.client.from("ai_ride_requests").insert({
      conversation_id: input.conversationId,
      contact_id: this.contact.id,
      pickup: input.pickup,
      destination: input.destination,
      scheduled_for_raw: input.scheduledFor,
    });
    if (insertError) {
      console.error("[rule-engine] no se pudo registrar ai_ride_requests:", insertError.message);
    }

    const { error: updateError } = await this.client
      .from("conversations")
      .update({ needs_assignment: true })
      .eq("id", input.conversationId);
    if (updateError) {
      console.error("[rule-engine] no se pudo marcar needs_assignment:", updateError.message);
    }
  }
}
