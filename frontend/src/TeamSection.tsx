import { useEffect, useState } from 'react'
import { UserPlus, Pencil, Trash2, Check, X } from 'lucide-react'
import { supabase } from './supabaseClient'
import { getFunctionErrorMessage } from './functionsError'

type Operator = {
  id: string
  full_name: string
  operator_code: string | null
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

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editCode, setEditCode] = useState('')
  const [editIsAdmin, setEditIsAdmin] = useState(false)
  const [editMaxCapacity, setEditMaxCapacity] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [])

  function load() {
    setLoading(true)
    supabase
      .from('operators')
      .select('id, full_name, operator_code, presence, max_capacity, current_load, is_admin')
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

  function startEditing(op: Operator) {
    setEditingId(op.id)
    setEditName(op.full_name)
    setEditCode(op.operator_code ?? '')
    setEditIsAdmin(op.is_admin)
    setEditMaxCapacity(op.max_capacity?.toString() ?? '')
  }

  async function saveEdit(id: string) {
    setSavingEdit(true)
    const { error } = await supabase
      .from('operators')
      .update({
        full_name: editName,
        operator_code: editCode.trim() || null,
        is_admin: editIsAdmin,
        max_capacity: editMaxCapacity.trim() ? Number(editMaxCapacity) : null,
      })
      .eq('id', id)
    setSavingEdit(false)

    if (error) {
      alert('No se pudo guardar: ' + error.message)
      return
    }
    setEditingId(null)
    load()
  }

  // Por si a alguien se le olvida marcarse "No disponible" — un admin
  // lo puede hacer por él. Dispara solo la liberación de lo que tenía
  // asignado (mismo trigger que cuando el operador lo hace por su cuenta).
  async function togglePresence(op: Operator) {
    const next = op.presence === 'available' ? 'offline' : 'available'
    const { error } = await supabase.from('operators').update({ presence: next }).eq('id', op.id)
    if (error) {
      alert('No se pudo cambiar la presencia: ' + error.message)
      return
    }
    load()
  }

  async function handleDelete(op: Operator) {
    const confirmed = confirm(
      `¿Eliminar a ${op.full_name}? Se libera todo lo que tenga asignado y se borra su acceso — esta acción no se puede deshacer.`,
    )
    if (!confirmed) return

    setDeletingId(op.id)
    const { data, error } = await supabase.functions.invoke('delete-operator', {
      body: { operator_id: op.id },
    })
    setDeletingId(null)

    if (error || data?.error) {
      alert('No se pudo eliminar: ' + (await getFunctionErrorMessage(error, data)))
      return
    }
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
              <th className="px-4 py-2 font-normal">Código</th>
              <th className="px-4 py-2 font-normal">Presencia</th>
              <th className="px-4 py-2 font-normal">Carga</th>
              <th className="px-4 py-2 font-normal">Rol</th>
              <th className="px-4 py-2 font-normal"></th>
            </tr>
          </thead>
          <tbody>
            {operators.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted">
                  Todavía no hay operadores cargados.
                </td>
              </tr>
            )}
            {operators.map((op) =>
              editingId === op.id ? (
                <tr key={op.id} className="border-b border-panel-light/60 bg-panel-light/40 last:border-0">
                  <td className="px-4 py-2.5">
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full rounded-sm border border-panel-light bg-asphalt px-2 py-1 text-sm text-cream outline-none focus:border-mustard"
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <input
                      value={editCode}
                      onChange={(e) => setEditCode(e.target.value)}
                      placeholder="D005"
                      className="w-20 rounded-sm border border-panel-light bg-asphalt px-2 py-1 font-mono text-xs text-cream outline-none focus:border-mustard"
                    />
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted">{op.presence}</td>
                  <td className="px-4 py-2.5">
                    <input
                      value={editMaxCapacity}
                      onChange={(e) => setEditMaxCapacity(e.target.value)}
                      placeholder="Sin límite"
                      className="w-20 rounded-sm border border-panel-light bg-asphalt px-2 py-1 font-mono text-xs text-cream outline-none focus:border-mustard"
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <label className="flex items-center gap-1.5 text-xs text-cream">
                      <input
                        type="checkbox"
                        checked={editIsAdmin}
                        onChange={(e) => setEditIsAdmin(e.target.checked)}
                        className="h-3.5 w-3.5 accent-mustard"
                      />
                      Admin
                    </label>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => saveEdit(op.id)}
                        disabled={savingEdit}
                        className="flex h-7 w-7 items-center justify-center rounded-sm bg-mustard text-asphalt hover:opacity-90 disabled:opacity-50"
                        title="Guardar"
                      >
                        <Check size={13} />
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="flex h-7 w-7 items-center justify-center rounded-sm border border-panel-light text-muted hover:text-cream"
                        title="Cancelar"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={op.id} className="border-b border-panel-light/60 last:border-0">
                  <td className="px-4 py-2.5">{op.full_name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted">{op.operator_code || '—'}</td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => togglePresence(op)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors ${
                        op.presence === 'available'
                          ? 'border-available/40 text-available hover:bg-available/10'
                          : 'border-panel-light text-muted hover:border-mustard hover:text-mustard'
                      }`}
                      title="Cambiar presencia (por si se le olvidó apagarla)"
                    >
                      <span
                        className={`h-2 w-2 rounded-full ${
                          op.presence === 'available' ? 'bg-available' : 'bg-muted'
                        }`}
                      />
                      {op.presence}
                    </button>
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
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => startEditing(op)}
                        className="flex h-7 w-7 items-center justify-center rounded-sm border border-panel-light text-muted hover:border-mustard hover:text-mustard"
                        title="Editar"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => handleDelete(op)}
                        disabled={deletingId === op.id}
                        className="flex h-7 w-7 items-center justify-center rounded-sm border border-alert/40 text-alert hover:bg-alert/10 disabled:opacity-50"
                        title="Eliminar"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
