// Colores de canal en UN solo lugar (antes estaban repetidos a mano en
// Sidebar, ChannelsSection y ConversationsView, y el de SMS no coincidía
// entre el avatar y el ícono).
//
// Son colores de MARCA a propósito (WhatsApp verde, Messenger azul,
// Instagram magenta): se reconocen por color y no cambian con el tema. Lo
// que sí es del tema (fondos de burbuja, tildes de "leído", avatar sin
// nombre, etc.) usa los tokens de color en los componentes.
export type ChannelId = 'whatsapp' | 'facebook' | 'instagram' | 'sms'

// Fondo de avatares/insignias (siempre con texto blanco encima).
export const channelBrandColor: Record<ChannelId, string> = {
  whatsapp: '#25D366',
  facebook: '#1877F2',
  instagram: '#E1306C',
  sms: '#5B5B63',
}

// Color del ícono y de los puntos sobre el fondo del tema (SMS = naranja de RingCentral).
export const channelIconColor: Record<ChannelId, string> = {
  whatsapp: '#25D366',
  facebook: '#1877F2',
  instagram: '#E1306C',
  sms: '#FF7A00',
}
