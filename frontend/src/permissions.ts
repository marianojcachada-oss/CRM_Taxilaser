import { useSyncExternalStore } from 'react'
import { supabase } from './supabaseClient'

// Permisos por rol (qué ve y qué puede hacer cada uno). El Superadmin siempre
// puede todo. Los valores de acá son los de ANTES de que existiera la pantalla
// de permisos: mientras nadie cambie nada, el sistema se comporta igual.
//
// Importante: estos permisos se aplican en la pantalla. Las reglas de la base
// de datos (RLS) siguen mandando por debajo: darle a un rol algo que la base no
// le deja leer o escribir no lo hace funcionar.

export type Role = 'operador' | 'admin'
export type EffectiveRole = Role | 'superadmin'

export type PermDef = {
  key: string
  label: string
  group: string
  help?: string
  defaults: Record<Role, boolean>
}

export const ADMIN_SECTIONS: { id: string; label: string; admin: boolean; adminEdit: boolean }[] = [
  { id: 'command-center', label: 'Command Center', admin: false, adminEdit: false },
  { id: 'campaigns', label: 'Campaigns', admin: false, adminEdit: false },
  { id: 'automations', label: 'Automations', admin: false, adminEdit: false },
  { id: 'ai', label: 'AI (Valeria)', admin: false, adminEdit: false },
  { id: 'analytics', label: 'Analytics', admin: true, adminEdit: true },
  { id: 'team', label: 'Team', admin: true, adminEdit: true },
  { id: 'templates', label: 'Templates', admin: true, adminEdit: true },
  { id: 'channels', label: 'Channels', admin: false, adminEdit: false },
  { id: 'integrations', label: 'Integrations', admin: true, adminEdit: false },
  { id: 'vehicles', label: 'Vehículos', admin: false, adminEdit: false },
  { id: 'metrics', label: 'Métricas de mensajes', admin: true, adminEdit: true },
  { id: 'roundrobin', label: 'Round robin', admin: true, adminEdit: true },
  { id: 'errors', label: 'Errores', admin: true, adminEdit: true },
  { id: 'integrationhealth', label: 'Salud de integraciones', admin: true, adminEdit: true },
  { id: 'reports', label: 'Problemas reportados', admin: false, adminEdit: false },
  { id: 'admin', label: 'Admin', admin: false, adminEdit: false },
]

export const PERMISSIONS: PermDef[] = [
  // Mensajería
  { key: 'crm.contacts', label: 'Ver Contactos', group: 'Mensajería', defaults: { operador: true, admin: true } },
  { key: 'crm.missed_calls', label: 'Ver Llamadas perdidas', group: 'Mensajería', defaults: { operador: true, admin: true } },
  { key: 'crm.managers', label: 'Chat interno de Managers', group: 'Mensajería', defaults: { operador: false, admin: true } },
  { key: 'crm.snoozed', label: 'Bandeja de Pospuestas', group: 'Mensajería', defaults: { operador: false, admin: true } },
  // Acciones
  {
    key: 'act.contacts_merge',
    label: 'Fusionar contactos duplicados',
    group: 'Acciones',
    help: 'Tildar dos contactos y unirlos en uno.',
    defaults: { operador: false, admin: true },
  },
  {
    key: 'act.conv_delete',
    label: 'Borrar una conversación',
    group: 'Acciones',
    help: 'Es irreversible.',
    defaults: { operador: false, admin: true },
  },
  // Panel admin
  ...ADMIN_SECTIONS.map<PermDef>((s) => ({
    key: `view.admin.${s.id}`,
    label: s.label,
    group: 'Panel admin — Ver',
    defaults: { operador: false, admin: s.admin },
  })),
  ...ADMIN_SECTIONS.map<PermDef>((s) => ({
    key: `edit.admin.${s.id}`,
    label: s.label,
    group: 'Panel admin — Editar',
    defaults: { operador: false, admin: s.adminEdit },
  })),
]

export const PERMISSION_GROUPS = ['Mensajería', 'Acciones', 'Panel admin — Ver', 'Panel admin — Editar']

const DEFAULT_BY_KEY: Record<string, PermDef> = Object.fromEntries(PERMISSIONS.map((p) => [p.key, p]))

type State = { role: EffectiveRole | null; rows: Record<string, boolean>; ready: boolean; version: number }
let state: State = { role: null, rows: {}, ready: false, version: 0 }
const listeners = new Set<() => void>()
function emit(next: Partial<State>) {
  state = { ...state, ...next, version: state.version + 1 }
  listeners.forEach((l) => l())
}

export function roleFromFlags(isAdmin: boolean, isSuperAdmin: boolean): EffectiveRole {
  return isSuperAdmin ? 'superadmin' : isAdmin ? 'admin' : 'operador'
}

let loadingFor = 0
export async function loadPermissions(role: EffectiveRole) {
  const token = ++loadingFor
  if (role === 'superadmin') {
    emit({ role, rows: {}, ready: true })
    return
  }
  // Si la tabla todavía no existe (o falla la consulta) se usan los valores
  // de siempre — nunca bloquea a nadie por un error de carga.
  const { data, error } = await supabase.from('role_permissions').select('permission, allowed').eq('role', role)
  if (token !== loadingFor) return
  const rows: Record<string, boolean> = {}
  if (!error) for (const r of (data ?? []) as { permission: string; allowed: boolean }[]) rows[r.permission] = r.allowed
  emit({ role, rows, ready: true })
}

export function resetPermissions() {
  loadingFor++
  emit({ role: null, rows: {}, ready: false })
}

export function can(key: string): boolean {
  const role = state.role
  if (role === 'superadmin') return true
  const def = DEFAULT_BY_KEY[key]
  if (!role) return def ? def.defaults.operador : false
  if (key in state.rows) return state.rows[key]
  return def ? def.defaults[role] : false
}

// "Ver" y "Editar" por sección del panel. Editar exige poder ver.
export function canViewAdmin(sectionId: string) {
  return state.role === 'superadmin' || can(`view.admin.${sectionId}`)
}
export function canEditAdmin(sectionId: string) {
  return state.role === 'superadmin' || (can(`view.admin.${sectionId}`) && can(`edit.admin.${sectionId}`))
}
// Entra al panel admin quien es Superadmin o tiene alguna sección para ver.
export function canAccessAdminPanel() {
  return state.role === 'superadmin' || ADMIN_SECTIONS.some((s) => can(`view.admin.${s.id}`))
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}
const getVersion = () => state.version

export function usePermissions() {
  useSyncExternalStore(subscribe, getVersion, getVersion)
  return {
    ready: state.ready,
    role: state.role,
    can,
    canViewAdmin,
    canEditAdmin,
    canAccessAdminPanel: canAccessAdminPanel(),
  }
}
