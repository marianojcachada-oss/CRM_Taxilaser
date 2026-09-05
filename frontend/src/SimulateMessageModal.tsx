import { useState } from 'react'
import { X, FlaskConical } from 'lucide-react'
import { supabase } from './supabaseClient'
import { getFunctionErrorMessage } from './functionsError'
import type { Channel } from './ConversationsView'

type Props = { onClose: () => void; onSent: () => void }

const channels: Channel[] = ['whatsapp', 'facebook', 'instagram', 'sms']

export default function SimulateMessageModal({ onClose, onSent }: Props) {
  const [channel, setChannel] = useState<Channel>('whatsapp')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!phone.trim() || !text.trim()) return

    setLoading(true)
    setError(null)

    const { data, error } = await supabase.functions.invoke('simulate-message', {
      body: { channel, name, phone, text },
    })

    setLoading(false)

    if (error || data?.error) {
      setError(await getFunctionErrorMessage(error, data))
      return
    }

    setText('')
    onSent()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-sm rounded-sm border border-panel-light bg-panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-sm font-medium text-mustard">
            <FlaskConical size={14} /> Simular mensaje entrante
          </span>
          <button onClick={onClose} className="text-muted hover:text-cream">
            <X size={16} />
          </button>
        </div>

        <p className="mb-3 text-xs text-muted">
          Corre el mismo camino que un mensaje real (contacto, conversación, round robin, estado
          automático) sin depender de que Meta o RingCentral estén conectados.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <div>
            <label className="mb-1 block text-xs text-muted">Canal</label>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as Channel)}
              className="w-full rounded-sm border border-panel-light bg-asphalt px-2 py-1.5 text-sm text-cream outline-none focus:border-mustard"
            >
              {channels.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Nombre (opcional)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-sm border border-panel-light bg-asphalt px-2 py-1.5 text-sm text-cream outline-none focus:border-mustard"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Teléfono</label>
            <input
              type="text"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+54 9 11 0000 0000"
              className="w-full rounded-sm border border-panel-light bg-asphalt px-2 py-1.5 font-mono text-sm text-cream outline-none focus:border-mustard"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Mensaje</label>
            <textarea
              required
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Ej: Hola, necesito un taxi..."
              className="w-full resize-none rounded-sm border border-panel-light bg-asphalt px-2 py-1.5 text-sm text-cream outline-none focus:border-mustard"
            />
          </div>

          {error && <p className="text-sm text-alert">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="mt-1 rounded-sm bg-mustard py-1.5 text-sm font-medium text-asphalt hover:opacity-90 disabled:opacity-50"
          >
            {loading ? 'Enviando...' : 'Simular mensaje'}
          </button>
        </form>
      </div>
    </div>
  )
}
