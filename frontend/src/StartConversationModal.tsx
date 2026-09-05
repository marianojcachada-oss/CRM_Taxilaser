import { useState } from 'react'
import { X, MessageSquarePlus } from 'lucide-react'
import { supabase } from './supabaseClient'
import { getFunctionErrorMessage } from './functionsError'

type Props = { onClose: () => void; onSent: () => void }

export default function StartConversationModal({ onClose, onSent }: Props) {
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!phone.trim() || !text.trim()) return

    setLoading(true)
    setError(null)

    const { data, error } = await supabase.functions.invoke('start-conversation', {
      body: { phone: phone.trim(), name: name.trim() || null, text: text.trim() },
    })

    setLoading(false)

    if (error || data?.error) {
      setError(await getFunctionErrorMessage(error, data))
      return
    }

    onSent()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-sm rounded-sm border border-panel-light bg-panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-sm font-medium text-mustard">
            <MessageSquarePlus size={14} /> Nueva conversación por SMS
          </span>
          <button onClick={onClose} className="text-muted hover:text-cream">
            <X size={16} />
          </button>
        </div>

        <p className="mb-3 text-xs text-muted">
          Si el teléfono no está en Contactos, se crea solo — después le podés poner nombre desde ahí.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <div>
            <label className="mb-1 block text-xs text-muted">Teléfono</label>
            <input
              type="text"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 404 000 0000"
              className="w-full rounded-sm border border-panel-light bg-asphalt px-2 py-1.5 font-mono text-sm text-cream outline-none focus:border-mustard"
            />
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
            <label className="mb-1 block text-xs text-muted">Mensaje</label>
            <textarea
              required
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Ej: Hola! Te escribimos de Taxi Laser..."
              className="w-full resize-none rounded-sm border border-panel-light bg-asphalt px-2 py-1.5 text-sm text-cream outline-none focus:border-mustard"
            />
          </div>

          {error && <p className="text-sm text-alert">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="mt-1 rounded-sm bg-mustard py-1.5 text-sm font-medium text-asphalt hover:opacity-90 disabled:opacity-50"
          >
            {loading ? 'Enviando...' : 'Iniciar conversación'}
          </button>
        </form>
      </div>
    </div>
  )
}
