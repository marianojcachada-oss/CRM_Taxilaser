import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { supabase } from './supabaseClient'

type Template = { id: string; title: string; body: string }

export default function TemplatesSection() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [newBody, setNewBody] = useState('')

  useEffect(() => {
    load()
  }, [])

  function load() {
    setLoading(true)
    supabase
      .from('message_templates')
      .select('id, title, body')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setTemplates(data ?? [])
        setLoading(false)
      })
  }

  async function addTemplate(e: React.FormEvent) {
    e.preventDefault()
    if (!newTitle.trim() || !newBody.trim()) return

    const { data, error } = await supabase
      .from('message_templates')
      .insert({ title: newTitle, body: newBody })
      .select('id, title, body')
      .single()

    if (error) {
      alert('No se pudo crear la macro: ' + error.message)
      return
    }
    setTemplates((prev) => [data, ...prev])
    setNewTitle('')
    setNewBody('')
  }

  async function deleteTemplate(id: string) {
    const { error } = await supabase.from('message_templates').delete().eq('id', id)
    if (error) {
      alert('No se pudo borrar: ' + error.message)
      return
    }
    setTemplates((prev) => prev.filter((t) => t.id !== id))
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={addTemplate} className="rounded-sm border border-panel-light bg-panel p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Nueva macro</h2>
        <div className="mb-2">
          <label className="mb-1 block text-xs text-muted">Título</label>
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Ej: Bienvenida"
            className="w-full rounded-sm border border-panel-light bg-asphalt px-2 py-1.5 text-sm text-cream outline-none focus:border-mustard"
          />
        </div>
        <div className="mb-3">
          <label className="mb-1 block text-xs text-muted">Texto</label>
          <textarea
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            placeholder="Ej: Hola! Gracias por escribirnos a Taxi Laser..."
            rows={3}
            className="w-full resize-none rounded-sm border border-panel-light bg-asphalt px-2 py-1.5 text-sm text-cream outline-none focus:border-mustard"
          />
        </div>
        <button
          type="submit"
          className="flex items-center gap-1 rounded-sm bg-mustard px-3 py-1.5 text-xs font-medium text-asphalt hover:opacity-90"
        >
          <Plus size={13} /> Crear macro
        </button>
      </form>

      <div className="rounded-sm border border-panel-light bg-panel p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Macros existentes</h2>
        {loading && <p className="text-sm text-muted">Cargando...</p>}
        {error && <p className="text-sm text-alert">Error: {error}</p>}
        {!loading && !error && templates.length === 0 && (
          <p className="text-sm text-muted">Todavía no hay macros creadas.</p>
        )}
        <div className="flex flex-col gap-2">
          {templates.map((t) => (
            <div key={t.id} className="flex items-start justify-between rounded-sm border border-panel-light px-3 py-2">
              <div>
                <p className="text-sm font-medium">{t.title}</p>
                <p className="text-xs text-muted">{t.body}</p>
              </div>
              <button
                onClick={() => deleteTemplate(t.id)}
                className="text-muted transition-colors hover:text-alert"
                title="Borrar macro"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
