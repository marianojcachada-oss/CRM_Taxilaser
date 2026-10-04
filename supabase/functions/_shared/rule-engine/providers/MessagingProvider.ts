/**
 * Puerto de envio de mensajes. En "Que tal?" la implementacion real
 * (ver rule-engine-adapters/taxiLaserMessagingProvider.ts) envuelve
 * sendAutomatedMessage (el mismo mecanismo que ya usan los avisos
 * automaticos de TaxiCaller) -- no llama a WhatsApp/RingCentral directo.
 */
export interface MessagingProvider {
  send(conversationId: string, text: string): Promise<void>
}
