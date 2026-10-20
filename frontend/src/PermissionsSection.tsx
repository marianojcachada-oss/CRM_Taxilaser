import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { useToast } from './Toast'
import { Group } from './settingsUi'
import { PERMISSIONS, PERMISSION_GROUPS, type Role } from './permissions'

const ROLES: { id: Role; label: string }[] = [
  { id: 'operador', label: 'Operador' },
  { id: 'admin', label: 'Admin' },
]

type Rows = Record<Role, Record<string, boolean>>

function Switch({ on, disabled, label, onClick }: { on: boolean; disabled?: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        on ? 'border-available/60 bg-available/30' : 'border-panel-light bg-asphalt'
      }`}
    >
      <span
        className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${
          on ? 'left-[1.1rem] bg-available' : 'left-0.5 bg-muted'
        }`}
      />
    </button>
  )
}

export default function PermissionsSection() {
  const toast = useToast()
  const [rows, setRows] = useState<Rows>({ operador: {}, admin: {} })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState<Role | null>(null)

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.from('role_permissions').select('role, permission, allowed')
    if (err) {
      setError(
        err.message.includes('role_permissions')
          ? 'Falta crear la tabla de permisos: corré permisos_roles.sql en Supabase y recargá.'
          : err.message,
      )
      setLoading(false)
      return
    }
    const next: Rows = { operador: {}, admin: {} }
    for (const r of (data ?? []) as { role: Role; permission: string; allowed: boolean }[]) {
      if (next[r.role]) next[r.role][r.permission] = r.allowed
    }
    setRows(next)
    setError(null)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const valueOf = (role: Role, key: string) => {
    const def = PERMISSIONS.find((p) => p.key === key)!
    return key in rows[role] ? rows[role][key] : def.defaults[role]
  }

  async function set(role: Role, key: string, allowed: boolean) {
    const prev = rows
    setRows({ ...rows, [role]: { ...rows[role], [key]: allowed } })
    const { error: err } = await supabase
      .from('role_permissions')
      .upsert({ role, permission: key, allowed, updated_at: new Date().toISOString() })
    if (err) {
      setRows(prev)
      toast.error('No se pudo guardar: ' + err.message)
    }
  }

  async function reset(role: Role) {
    setConfirmReset(null)
    const { error: err } = await supabase.from('role_permissions').delete().eq('role', role)
    if (err) {
      toast.error('No se pudo restaurar: ' + err.message)
      return
    }
    setRows((r) => ({ ...r, [role]: {} }))
    toast.success('Valores iniciales restaurados.')
  }

  if (loading) return <p className="text-sm text-muted">Cargando...</p>

  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-sm border border-panel-light bg-panel px-3 py-2 text-xs text-muted">
        Elegí qué puede ver y hacer cada rol. El <span className="text-cream">Superadmin</span> siempre puede todo.
        Los cambios se aplican la próxima vez que cada persona recarga o inicia sesión. Los permisos se aplican en la
        pantalla: la base de datos tiene sus propias reglas (por ejemplo, un Operador no puede leer las claves de Integraciones aunque le des "Ver"), así que darle a un rol algo que la base no le permite no lo hace funcionar.
      </p>
      {error && <p className="rounded-sm border border-alert/30 bg-alert/10 px-3 py-2 text-xs text-alert">{error}</p>}

      {PERMISSION_GROUPS.map((group) => {
        const items = PERMISSIONS.filter((p) => p.group === group)
        const isEdit = group.endsWith('Editar')
        return (
          <Group key={group} title={group}>
            <div className="flex flex-col">
              <div className="flex items-center gap-3 pb-1">
                <span className="min-w-0 flex-1" />
                {ROLES.map((r) => (
                  <span key={r.id} className="w-16 shrink-0 text-center text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {r.label}
                  </span>
                ))}
              </div>
              {items.map((p) => (
                <div key={p.key} className="flex items-center gap-3 border-t border-panel-light/50 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-cream">{p.label}</p>
                    {p.help && <p className="text-[11px] text-muted">{p.help}</p>}
                  </div>
                  {ROLES.map((r) => {
                    const viewKey = p.key.replace('edit.', 'view.')
                    const blocked = isEdit && !valueOf(r.id, viewKey)
                    return (
                      <div key={r.id} className="flex w-16 shrink-0 justify-center">
                        <Switch
                          on={blocked ? false : valueOf(r.id, p.key)}
                          disabled={blocked}
                          label={`${p.label} — ${r.label}`}
                          onClick={() => set(r.id, p.key, !valueOf(r.id, p.key))}
                        />
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
            {isEdit && (
              <p className="text-[11px] text-muted">
                Editar necesita Ver. Sin permiso de editar la sección se abre en modo lectura (botones y campos
                bloqueados).
              </p>
            )}
          </Group>
        )
      })}

      <Group title="Solo Superadmin (no se puede cambiar)">
        <ul className="flex flex-col gap-1 text-xs text-muted">
          <li>• Esta pantalla de Permisos.</li>
          <li>• Borrar varias conversaciones a la vez y recibir el aviso de problemas reportados.</li>
          <li>• Convertir a alguien en Superadmin.</li>
        </ul>
      </Group>

      <Group title="Volver a los valores iniciales">
        <div className="flex flex-wrap gap-2">
          {ROLES.map((r) =>
            confirmReset === r.id ? (
              <button
                key={r.id}
                type="button"
                onClick={() => reset(r.id)}
                className="rounded-sm border border-alert/60 bg-alert/10 px-3 py-1.5 text-xs text-alert"
              >
                Confirmar: restaurar {r.label}
              </button>
            ) : (
              <button
                key={r.id}
                type="button"
                onClick={() => setConfirmReset(r.id)}
                className="rounded-sm border border-panel-light px-3 py-1.5 text-xs text-muted transition-colors hover:border-mustard hover:text-mustard"
              >
                Restaurar {r.label}
              </button>
            ),
          )}
        </div>
      </Group>
    </div>
  )
}
