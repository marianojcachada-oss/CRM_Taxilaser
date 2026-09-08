import { useEffect, useState, Fragment } from 'react'
import { UserPlus, Pencil, UserX, UserCheck, Trash2, Check, X, Upload, RotateCcw } from 'lucide-react'
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
  is_active: boolean
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
  const [editEmail, setEditEmail] = useState('')
  const [editPassword, setEditPassword] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [showBulk, setShowBulk] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkResults, setBulkResults] = useState<{ email: string; success: boolean; error?: string }[] | null>(null)
  const [releasingCapacity, setReleasingCapacity] = useState(false)

  useEffect(() => {
    load()
  }, [])

  function load() {
    setLoading(true)
    supabase
      .from('operators')
      .select('id, full_name, operator_code, presence, max_capacity, current_load, is_admin, is_active')
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
    setEditEmail('')
    setEditPassword('')
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

    // Email y contraseña viven en Auth, no en esta tabla — solo se
    // tocan si el admin cargó alguno de los dos.
    if (!error && (editEmail.trim() || editPassword.trim())) {
      const { data: credData, error: credError } = await supabase.functions.invoke('update-operator-credentials', {
        body: {
          operator_id: id,
          email: editEmail.trim() || undefined,
          password: editPassword.trim() || undefined,
        },
      })
      if (credError || credData?.error) {
        setSavingEdit(false)
        alert('Se guardó el resto, pero no el email/contraseña: ' + (await getFunctionErrorMessage(credError, credData)))
        return
      }
    }

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

  async function handleDeactivate(op: Operator) {
    const confirmed = confirm(
      `¿Desactivar a ${op.full_name}? Se libera todo lo que tenga asignado y se le bloquea el acceso — pero su historial se conserva, y podés reactivarlo cuando quieras.`,
    )
    if (!confirmed) return

    setTogglingId(op.id)
    const { data, error } = await supabase.functions.invoke('deactivate-operator', {
      body: { operator_id: op.id },
    })
    setTogglingId(null)

    if (error || data?.error) {
      alert('No se pudo desactivar: ' + (await getFunctionErrorMessage(error, data)))
      return
    }
    load()
  }

  async function handleReactivate(op: Operator) {
    setTogglingId(op.id)
    const { data, error } = await supabase.functions.invoke('reactivate-operator', {
      body: { operator_id: op.id },
    })
    setTogglingId(null)

    if (error || data?.error) {
      alert('No se pudo reactivar: ' + (await getFunctionErrorMessage(error, data)))
      return
    }
    load()
  }

  async function handleDeletePermanently(op: Operator) {
    const confirmed = confirm(
      `¿Eliminar a ${op.full_name} POR COMPLETO? Esto borra también su historial de auditoría (queda como "actor desconocido") — no se puede deshacer. Si solo querés cortarle el acceso, usá "Desactivar" en vez de esto.`,
    )
    if (!confirmed) return

    setDeletingId(op.id)
    const { data, error } = await supabase.functions.invoke('delete-operator-permanently', {
      body: { operator_id: op.id },
    })
    setDeletingId(null)

    if (error || data?.error) {
      alert('No se pudo eliminar: ' + (await getFunctionErrorMessage(error, data)))
      return
    }
    load()
  }

  function parseBulkRows() {
    return bulkText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [full_name, email, password] = line.split(',').map((part) => part.trim())
        return { full_name, email, password }
      })
      .filter((r) => r.full_name && r.email && r.password)
  }

  async function handleBulkSubmit() {
    const rows = parseBulkRows()
    if (rows.length === 0) {
      alert('No encontré filas válidas — cada línea tiene que ser "Nombre, email@ejemplo.com"')
      return
    }

    setBulkSaving(true)
    setBulkResults(null)
    const { data, error } = await supabase.functions.invoke('bulk-create-operators', {
      body: { rows },
    })
    setBulkSaving(false)

    if (error || data?.error) {
      alert('No se pudo completar: ' + (await getFunctionErrorMessage(error, data)))
      return
    }
    setBulkResults(data.results)
    load()
  }

  async function handleReleaseCapacity() {
    const confirmed = confirm(
      'Esto pone la carga de TODOS los operadores en 0 y marca como visto todas las conversaciones abiertas y asignadas, para reiniciar el reparto del round robin desde cero. ¿Continuar?',
    )
    if (!confirmed) return

    setReleasingCapacity(true)
    const { data, error } = await supabase.functions.invoke('release-operator-capacity', {
      body: {},
    })
    setReleasingCapacity(false)

    if (error || data?.error) {
      alert('No se pudo liberar la carga: ' + (await getFunctionErrorMessage(error, data)))
      return
    }
    alert(`Listo: ${data.operatorsReset} operadores en 0, ${data.conversationsMarkedRead} conversaciones marcadas como vistas.`)
    load()
  }

  if (loading) return <p className="text-sm text-muted">Cargando equipo...</p>
  if (error) return <p className="text-sm text-alert">Error al cargar operadores: {error}</p>

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1 rounded-sm bg-mustard px-3 py-1.5 text-xs font-medium text-asphalt hover:opacity-90"
          >
            <UserPlus size={13} /> {showForm ? 'Cancelar' : 'Agregar operador'}
          </button>
          <button
            onClick={() => setShowBulk((v) => !v)}
            className="flex items-center gap-1 rounded-sm border border-panel-light px-3 py-1.5 text-xs text-muted hover:border-mustard hover:text-mustard"
          >
            <Upload size={13} /> {showBulk ? 'Cancelar' : 'Carga masiva'}
          </button>
          <button
            onClick={handleReleaseCapacity}
            disabled={releasingCapacity}
            className="flex items-center gap-1 rounded-sm border border-panel-light px-3 py-1.5 text-xs text-muted hover:border-alert hover:text-alert disabled:opacity-50"
            title="Pone la carga de todos en 0 y marca como visto lo abierto y asignado — reinicia el round robin"
          >
            <RotateCcw size={13} /> {releasingCapacity ? 'Liberando...' : 'Liberar carga'}
          </button>
        </div>
      </div>

      {showBulk && (
        <div className="rounded-sm border border-panel-light bg-panel p-4">
          <p className="mb-2 text-xs text-muted">
            Una línea por operador: nombre, email y contraseña separados por coma. Quedan con acceso
            listo de una — no se manda ningún correo de invitación.
          </p>
          <textarea
            rows={6}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={'Juan Pérez, juan@taxilaserllc.com, claveSegura1\nMaría Gómez, maria@taxilaserllc.com, claveSegura2'}
            className="w-full rounded-sm border border-panel-light bg-asphalt px-2.5 py-2 font-mono text-xs text-cream placeholder-muted outline-none focus:border-mustard"
          />
          <p className="mt-1 text-[11px] text-muted">Cada contraseña necesita al menos 6 caracteres.</p>
          <button
            onClick={handleBulkSubmit}
            disabled={bulkSaving}
            className="mt-2 rounded-sm bg-mustard px-3 py-1.5 text-xs font-medium text-asphalt hover:opacity-90 disabled:opacity-50"
          >
            {bulkSaving ? 'Creando...' : `Crear ${parseBulkRows().length || ''} operadores`}
          </button>

          {bulkResults && (
            <div className="mt-3 flex flex-col gap-1">
              {bulkResults.map((r) => (
                <p key={r.email} className={`text-xs ${r.success ? 'text-available' : 'text-alert'}`}>
                  {r.success ? '✓' : '✗'} {r.email} {r.error ? `— ${r.error}` : ''}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

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
                <Fragment key={op.id}>
                <tr className="border-b border-panel-light/60 bg-panel-light/40">
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
                <tr className="border-b border-panel-light/60 bg-panel-light/40 last:border-0">
                  <td colSpan={6} className="px-4 py-2.5">
                    <p className="mb-1.5 text-[11px] text-muted">
                      Cambiar email o contraseña — dejá en blanco lo que no quieras tocar.
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="email"
                        value={editEmail}
                        onChange={(e) => setEditEmail(e.target.value)}
                        placeholder="Nuevo email (opcional)"
                        className="w-56 rounded-sm border border-panel-light bg-asphalt px-2 py-1 text-xs text-cream outline-none focus:border-mustard"
                      />
                      <input
                        type="text"
                        value={editPassword}
                        onChange={(e) => setEditPassword(e.target.value)}
                        placeholder="Nueva contraseña (opcional)"
                        minLength={6}
                        className="w-56 rounded-sm border border-panel-light bg-asphalt px-2 py-1 text-xs text-cream outline-none focus:border-mustard"
                      />
                    </div>
                  </td>
                </tr>
                </Fragment>
              ) : (
                <tr key={op.id} className={`border-b border-panel-light/60 last:border-0 ${!op.is_active ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-2.5">
                    {op.full_name}
                    {!op.is_active && (
                      <span className="ml-2 rounded-full border border-alert/40 px-2 py-0.5 text-[10px] text-alert">
                        Desactivado
                      </span>
                    )}
                  </td>
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
                      {op.is_active ? (
                        <button
                          onClick={() => handleDeactivate(op)}
                          disabled={togglingId === op.id}
                          className="flex h-7 w-7 items-center justify-center rounded-sm border border-alert/40 text-alert hover:bg-alert/10 disabled:opacity-50"
                          title="Desactivar"
                        >
                          <UserX size={12} />
                        </button>
                      ) : (
                        <button
                          onClick={() => handleReactivate(op)}
                          disabled={togglingId === op.id}
                          className="flex h-7 w-7 items-center justify-center rounded-sm border border-available/40 text-available hover:bg-available/10 disabled:opacity-50"
                          title="Reactivar"
                        >
                          <UserCheck size={12} />
                        </button>
                      )}
                      <button
                        onClick={() => handleDeletePermanently(op)}
                        disabled={deletingId === op.id}
                        className="flex h-7 w-7 items-center justify-center rounded-sm border border-panel-light text-muted hover:border-alert hover:text-alert disabled:opacity-50"
                        title="Eliminar por completo (borra también el historial de auditoría)"
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
