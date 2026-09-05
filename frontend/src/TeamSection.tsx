import { useEffect, useState } from 'react'
import { UserPlus } from 'lucide-react'
import { supabase } from './supabaseClient'
import { getFunctionErrorMessage } from './functionsError'

type Operator = {
  id: string
  full_name: string
  presence: string
  max_capacity: number | null
  current_load: number
  is_admin: boolean
}

export default function TeamSection() {
  const [operators, setOperators] = useState<Operator[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    load()
  }, [])

  function load() {
    setLoading(true)
    supabase
      .from('operators')
      .select('id, full_name, presence, max_capacity, current_load, is_admin')
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setOperators(data ?? [])
        setLoading(false)
      })
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setSaving(true)

    const { data, error } = await supabase.functions.invoke('create-operator', {
      body: { email, password, full_name: name },
    })

    setSaving(false)

    if (error || data?.error) {
      setFormError(await getFunctionErrorMessage(error, data))
      return
    }

    setName('')
    setEmail('')
    setPassword('')
    setShowForm(false)
    load()
  }

  if (loading) return <p className="text-sm text-muted">Cargando equipo...</p>
  if (error) return <p className="text-sm text-alert">Error al cargar operadores: {error}</p>

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1 rounded-sm bg-mustard px-3 py-1.5 text-xs font-medium text-asphalt hover:opacity-90"
        >
          <UserPlus size={13} /> {showForm ? 'Cancelar' : 'Agregar operador'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="rounded-sm border border-panel-light bg-panel p-4">
          <div className="mb-2 grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-muted">Nombre</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-sm border border-panel-light bg-asphalt px-2 py-1.5 text-sm text-cream outline-none focus:border-mustard"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-sm border border-panel-light bg-asphalt px-2 py-1.5 text-sm text-cream outline-none focus:border-mustard"
              />
            </div>
          </div>
          <div className="mb-3">
            <label className="mb-1 block text-xs text-muted">Contraseña inicial</label>
            <input
              type="text"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 6 caracteres"
              className="w-full rounded-sm border border-panel-light bg-asphalt px-2 py-1.5 text-sm text-cream outline-none focus:border-mustard"
            />
          </div>

          {formError && <p className="mb-3 text-sm text-alert">{formError}</p>}

          <button
            type="submit"
            disabled={saving}
            className="rounded-sm bg-mustard px-3 py-1.5 text-xs font-medium text-asphalt hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Creando...' : 'Crear operador'}
          </button>
        </form>
      )}

      <div className="rounded-sm border border-panel-light bg-panel">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-panel-light text-xs text-muted">
              <th className="px-4 py-2 font-normal">Operador</th>
              <th className="px-4 py-2 font-normal">Presencia</th>
              <th className="px-4 py-2 font-normal">Carga</th>
              <th className="px-4 py-2 font-normal">Rol</th>
            </tr>
          </thead>
          <tbody>
            {operators.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted">
                  Todavía no hay operadores cargados.
                </td>
              </tr>
            )}
            {operators.map((op) => (
              <tr key={op.id} className="border-b border-panel-light/60 last:border-0">
                <td className="px-4 py-2.5">{op.full_name}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={`inline-flex items-center gap-1.5 text-xs ${
                      op.presence === 'available' ? 'text-available' : 'text-muted'
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${
                        op.presence === 'available' ? 'bg-available' : 'bg-muted'
                      }`}
                    />
                    {op.presence}
                  </span>
                </td>
                <td className="px-4 py-2.5 font-mono text-muted">
                  {op.current_load} / {op.max_capacity ?? '∞'}
                </td>
                <td className="px-4 py-2.5">
                  {op.is_admin ? (
                    <span className="rounded-sm border border-mustard/40 px-1.5 py-0.5 text-xs text-mustard">
                      Admin
                    </span>
                  ) : (
                    <span className="text-xs text-muted">Operador</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
