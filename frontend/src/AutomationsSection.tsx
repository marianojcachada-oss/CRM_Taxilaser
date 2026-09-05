import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { supabase } from './supabaseClient'

type Rule = { id: string; trigger_description: string; action_description: string; active: boolean }

export default function AutomationsSection() {
  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [trigger, setTrigger] = useState('')
  const [action, setAction] = useState('')

  useEffect(() => {
    load()
  }, [])

  function load() {
    setLoading(true)
    supabase
      .from('automation_rules')
      .select('id, trigger_description, action_description, active')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setRules(data ?? [])
        setLoading(false)
      })
  }

  async function createRule(e: React.FormEvent) {
    e.preventDefault()
    if (!trigger.trim() || !action.trim()) return

    const { data, error } = await supabase
      .from('automation_rules')
      .insert({ trigger_description: trigger, action_description: action })
      .select('id, trigger_description, action_description, active')
      .single()

    if (error) return alert('No se pudo crear la regla: ' + error.message)
    setRules((prev) => [data, ...prev])
    setTrigger('')
    setAction('')
  }

  async function toggleActive(rule: Rule) {
    const { error } = await supabase.from('automation_rules').update({ active: !rule.active }).eq('id', rule.id)
    if (error) return alert('No se pudo actualizar: ' + error.message)
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, active: !r.active } : r)))
  }

  async function deleteRule(id: string) {
    const { error } = await supabase.from('automation_rules').delete().eq('id', id)
    if (error) return alert('No se pudo borrar: ' + error.message)
    setRules((prev) => prev.filter((r) => r.id !== id))
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-sm border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
        Estas reglas quedan guardadas, pero todavía no hay un motor que las <strong>ejecute</strong>{' '}
        automáticamente — eso requiere un trigger o Edge Function que las revise cuando cambian las
        conversaciones. Es el paso natural que sigue.
      </p>

      <form onSubmit={createRule} className="rounded-sm border border-panel-light bg-panel p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Nueva regla</h2>
        <div className="mb-2">
          <label className="mb-1 block text-xs text-muted">Cuando (disparador)</label>
          <input
            type="text"
            value={trigger}
            onChange={(e) => setTrigger(e.target.value)}
            placeholder="Ej: estado pasa a 'reclamo'"
            className="w-full rounded-sm border border-panel-light bg-asphalt px-2 py-1.5 text-sm text-cream outline-none focus:border-mustard"
          />
        </div>
        <div className="mb-3">
          <label className="mb-1 block text-xs text-muted">Entonces (acción)</label>
          <input
            type="text"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="Ej: notificar a Managers"
            className="w-full rounded-sm border border-panel-light bg-asphalt px-2 py-1.5 text-sm text-cream outline-none focus:border-mustard"
          />
        </div>
        <button
          type="submit"
          className="flex items-center gap-1 rounded-sm bg-mustard px-3 py-1.5 text-xs font-medium text-asphalt hover:opacity-90"
        >
          <Plus size={13} /> Crear regla
        </button>
      </form>

      <div className="rounded-sm border border-panel-light bg-panel p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Reglas</h2>
        {loading && <p className="text-sm text-muted">Cargando...</p>}
        {error && <p className="text-sm text-alert">Error: {error}</p>}
        {!loading && !error && rules.length === 0 && <p className="text-sm text-muted">Todavía no hay reglas.</p>}
        <div className="flex flex-col gap-2">
          {rules.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-sm border border-panel-light px-3 py-2">
              <div>
                <p className="text-sm">
                  <span className="text-muted">Cuando</span> {r.trigger_description}
                </p>
                <p className="text-sm">
                  <span className="text-muted">→</span> {r.action_description}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggleActive(r)}
                  className={`rounded-sm border px-2 py-1 text-xs ${
                    r.active ? 'border-available/40 text-available' : 'border-panel-light text-muted'
                  }`}
                >
                  {r.active ? 'Activa' : 'Pausada'}
                </button>
                <button onClick={() => deleteRule(r.id)} className="text-muted hover:text-alert">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
