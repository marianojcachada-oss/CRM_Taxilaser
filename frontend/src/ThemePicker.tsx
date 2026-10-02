import { useState } from 'react'
import { Palette } from 'lucide-react'

export const themes = [
  { id: 'dark', label: 'Qué tal? (oscuro)', asphalt: '#0D0D0C', mustard: '#F0BE52' },
  { id: 'light', label: 'Qué tal? (claro)', asphalt: '#EDE9E1', mustard: '#C99A2E' },
  { id: 'midnight', label: 'Medianoche', asphalt: '#0B0F14', mustard: '#4FA8F0' },
  { id: 'sand', label: 'Arena', asphalt: '#F5EFE6', mustard: '#D97A22' },
  { id: 'dino', label: 'Dinosaurios', asphalt: '#0F1710', mustard: '#F2903F' },
  { id: 'bordo', label: 'Bordo', asphalt: '#1A0D10', mustard: '#E88BA0' },
  { id: 'tamagotchi', label: 'Tamagotchi', asphalt: '#12181A', mustard: '#FF6FB0' },
  { id: 'pastel', label: 'Pastel', asphalt: '#F3EEF7', mustard: '#A971C4' },
  { id: 'morado', label: 'Morado', asphalt: '#140E1C', mustard: '#A87EF0' },
  { id: 'taxicaller', label: 'TaxiCaller', asphalt: '#0A0A0A', mustard: '#F2C518' },
  { id: 'alto-contraste', label: 'Alto contraste', asphalt: '#000000', mustard: '#FFD400' },
  { id: 'oceano', label: 'Océano', asphalt: '#071B26', mustard: '#2DD4C8' },
  { id: 'esmeralda', label: 'Esmeralda', asphalt: '#0B1410', mustard: '#34E89E' },
  { id: 'whatsapp', label: 'WhatsApp', asphalt: '#0B141A', mustard: '#00A884' },
  { id: 'ringcentral', label: 'RingCentral', asphalt: '#F4F6F8', mustard: '#FF7A00' },
  { id: 'nostalgic', label: 'Nostalgic', asphalt: '#2B2944', mustard: '#21C685' },
  { id: 'rosa', label: 'Rosa', asphalt: '#1F0A14', mustard: '#FF4FA3' },
  { id: 'zello', label: 'Zello', asphalt: '#1A1F22', mustard: '#EF5E14' },
  { id: 'verde-negro', label: 'Verde y negro', asphalt: '#000000', mustard: '#39FF14' },
  { id: 'facebook', label: 'Facebook', asphalt: '#F0F2F5', mustard: '#1877F2' },
  { id: 'msn', label: 'MSN', asphalt: '#0A2A4D', mustard: '#8CC63F' },
]

// Patrones de fondo para el hilo de mensajes (ver index.css, clases
// .chat-pattern-*). Van aparte de los temas de colores: el operador
// elige cada uno por separado y conviven (el patrón usa los colores del
// tema activo automáticamente).
export const chatPatterns = [
  { id: 'none', label: 'Liso (sin patrón)' },
  { id: 'dots', label: 'Puntitos' },
  { id: 'stripes', label: 'Rayas diagonales' },
  { id: 'checker', label: 'Cuadrille (taxi)' },
  { id: 'doodle', label: 'Garabatos (auto, timón)' },
  { id: 'grid', label: 'Cuadrícula' },
  { id: 'waves', label: 'Ondas' },
  { id: 'dogs', label: 'Perritos' },
  { id: 'cats', label: 'Gatitos' },
  { id: 'tamagotchi', label: 'Tamagotchi' },
  { id: 'mensajeria', label: 'Mensajería clásica' },
  { id: 'stars', label: 'Estrellitas' },
]

// Tipografías elegibles por operador (ver index.css para el @import de
// Google Fonts y App.tsx -> changeFont, que escribe font_preference).
// "family" es el valor final de --font-sans, con su fallback.
// Elegidas por recordar a mensajerías conocidas y por legibilidad en
// listas largas de conversaciones — nada decorativo ni con ligaduras raras.
export const fonts = [
  { id: 'plex', label: 'IBM Plex Sans (actual)', family: '"IBM Plex Sans", sans-serif' },
  { id: 'inter', label: 'Inter — minimalista (Slack/Notion)', family: '"Inter", sans-serif' },
  { id: 'roboto', label: 'Roboto — Android / WhatsApp', family: '"Roboto", sans-serif' },
  { id: 'work-sans', label: 'Work Sans — redondeada (Telegram)', family: '"Work Sans", sans-serif' },
  { id: 'nunito-sans', label: 'Nunito Sans — amigable (Messenger)', family: '"Nunito Sans", sans-serif' },
  { id: 'manrope', label: 'Manrope — geométrica (estilo X)', family: '"Manrope", sans-serif' },
]

type Props = {
  theme: string
  onChangeTheme: (id: string) => void
}

export default function ThemePicker({ theme, onChangeTheme }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-sm border border-panel-light p-1.5 text-muted transition-colors hover:border-mustard hover:text-mustard"
        title="Elegir tema"
      >
        <Palette size={14} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-sm border border-panel-light bg-panel p-2 shadow-lg">
          {themes.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                onChangeTheme(t.id)
                setOpen(false)
              }}
              className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors ${
                theme === t.id ? 'bg-panel-light text-mustard' : 'text-cream hover:bg-panel-light/60'
              }`}
            >
              <span className="flex h-4 w-4 shrink-0 overflow-hidden rounded-full border border-panel-light">
                <span className="h-full w-1/2" style={{ backgroundColor: t.asphalt }} />
                <span className="h-full w-1/2" style={{ backgroundColor: t.mustard }} />
              </span>
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
