/**
 * Puerto de "datos dinamicos de viaje". El Rule Engine NUNCA inventa
 * unidad/color/patente/ETA/estado (encargo, "INFORMACION DINAMICA") --
 * siempre los pide a traves de esta interfaz. En "Que tal?" la
 * implementacion real (ver supabase/functions/_shared/rule-engine-adapters/
 * taxiLaserReservationProvider.ts) lee contacts.active_ride_* -- no llama
 * a TaxiCaller directamente, porque Etapa 1 nunca inventa ni confirma una
 * unidad/ETA real por su cuenta.
 */
export interface ActiveRide {
  unit: string | null
  color: string | null
  plate: string | null
  status: string | null
  etaMinutes: number | null
}

export interface RideRequestInput {
  conversationId: string
  pickup: string
  destination: string | null
  /** `null` si es un viaje inmediato (no programado). */
  scheduledFor: string | null
}

export interface ReservationProvider {
  getActiveRide(conversationId: string): Promise<ActiveRide | null>
  /**
   * OJO: en "Que tal?" esto NO crea un viaje en TaxiCaller (esa API --
   * "Place Order" -- todavia no esta integrada, ver
   * ia-configurable-clientes.md). Solo deja asentado el pedido para que
   * un operador humano lo tome y lo cree el mismo -- consistente con que
   * las reglas IMMEDIATE_RIDE/SCHEDULED_RIDE solo dicen "un operador te
   * lo va a confirmar", nunca "ya tenes unidad asignada".
   */
  createReservation(input: RideRequestInput): Promise<void>
}
