import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { ShieldCheck, Shield, Clock, Loader2, Save, Zap } from 'lucide-react'

type Operator = { id: string; full_name: string; is_admin: boolean }
type AuditEntry = {
  id: string
  action: string
  target_table: string
  target_id: string | null
  created_at: string
  operators: { full_name: string } | null
}

function getBulkSnoozeUntil(preset: '15m' | '1h' | 'tomorrow' | 'monday', lastMessageAt: string | null): Date {
  const base = lastMessageAt ? new Date(lastMessageAt) : new Date()

  if (preset === '15m') return new Date(base.getTime() + 15 * 60_000)
  if (preset === '1h') return new Date(base.getTime() + 60 * 60_000)

  // "Mañana" y "Próximo lunes" son fechas de calendario absolutas — no
  // tendría sentido calcularlas relativas al último mensaje de cada una.
  const now = new Date()
  if (preset === 'tomorrow') {
    const d = new Date(now)
    d.setDate(d.getDate() + 1)
    d.setHours(9, 0, 0, 0)
    return d
  }
  const d = new Date(now)
  const daysUntilMonday = (8 - d.getDay()) % 7 || 7
  d.setDate(d.getDate() + daysUntilMonday)
  d.setHours(9, 0, 0, 0)
  return d
}

export default function AdminSection() {
  const [operators, setOperators] = useState<Operator[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [auditLog, setAuditLog] = useState<AuditEntry[]>([])
  const [auditLoading, setAuditLoading] = useState(true)
  const [auditError, setAuditError] = useState<string | null>(null)

  const [bulkSnoozing, setBulkSnoozing] = useState(false)
  const [bulkSnoozeResult, setBulkSnoozeResult] = useState<string | null>(null)
  const [customHours, setCustomHours] = useState('24')

  const [autoSnoozeEnabled, setAutoSnoozeEnabled] = useState(false)
  const [autoInactivityMinutes, setAutoInactivityMinutes] = useState('1440')
  const [autoSnoozeDurationMinutes, setAutoSnoozeDurationMinutes] = useState('60')
  const [autoSnoozeLoading, setAutoSnoozeLoading] = useState(true)
  const [autoSnoozeSaving, setAutoSnoozeSaving] = useState(false)
  const [autoSnoozeSaved, setAutoSnoozeSaved] = useState(false)

  useEffect(() => {
    supabase
      .from('auto_snooze_settings')
      .select('enabled, inactivity_minutes, snooze_duration_minutes')
      .eq('id', true)
      .single()
      .then(({ data }) => {
        if (data) {
          setAutoSnoozeEnabled(data.enabled)
          setAutoInactivityMinutes(String(data.inactivity_minutes))
          setAutoSnoozeDurationMinutes(String(data.snooze_duration_minutes))
        }
        setAutoSnoozeLoading(false)
      })
  }, [])

  async function saveAutoSnoozeRule() {
    setAutoSnoozeSaving(true)
    const { error } = await supabase
      .from('auto_snooze_settings')
      .update({
        enabled: autoSnoozeEnabled,
        inactivity_minutes: Number(autoInactivityMinutes) || 1440,
        snooze_duration_minutes: Number(autoSnoozeDurationMinutes) || 60,
        updated_at: new Date().toISOString(),
      })
      .eq('id', true)
    setAutoSnoozeSaving(false)
    if (error) {
      alert('No se pudo guardar: ' + error.message)
      return
    }
    setAutoSnoozeSaved(true)
    setTimeout(() => setAutoSnoozeSaved(false), 1500)
  }

  useEffect(() => {
    loadOperators()
    loadAuditLog()
  }, [])

  function loadOperators() {
    setLoading(true)
    supabase
      .from('operators')
      .select('id, full_name, is_admin')
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setOperators(data ?? [])
        setLoading(false)
      })
  }

  function loadAuditLog() {
    setAuditLoading(true)
    supabase
      .from('audit_log')
      .select('id, action, target_table, target_id, created_at, operators(full_name)')
      .order('created_at', { ascending: false })
      .limit(30)
      .then(({ data, error }) => {
        if (error) setAuditError(error.message)
        else setAuditLog((data as unknown as AuditEntry[]) ?? [])
        setAuditLoading(false)
      })
  }

  async function toggleAdmin(op: Operator) {
    const { error } = await supabase
      .from('operators')
      .update({ is_admin: !op.is_admin })
      .eq('id', op.id)

    if (error) {
      alert('No se pudo actualizar el permiso: ' + error.message)
      return
    }
    setOperators((prev) => prev.map((o) => (o.id === op.id ? { ...o, is_admin: !o.is_admin } : o)))
    loadAuditLog()
  }

  const actionColor: Record<string, string> = {
    insert: 'text-available',
    update: 'text-warning',
    delete: 'text-alert',
  }

  async function applyBulkSnooze(preset: '15m' | '1h' | 'tomorrow' | 'monday' | 'custom') {
    const { data: convs, error } = await supabase
      .from('conversations')
      .select('id, last_message_at')
      .neq('status', 'cerrada')

    if (error) {
      alert('No se pudo leer las conversaciones: ' + error.message)
      return
    }
    if (!convs || convs.length === 0) {
      setBulkSnoozeResult('No hay conversaciones abiertas para posponer.')
      return
    }

    const confirmed = window.confirm(
      `Esto va a posponer ${convs.length} conversación(es) abierta(s), cada una contada desde su propio último mensaje. ¿Confirmás?`,
    )
    if (!confirmed) return

    setBulkSnoozing(true)
    setBulkSnoozeResult(null)

    const customHoursNum = Number(customHours) || 24

    await Promise.all(
      convs.map((c) => {
        const until =
          preset === 'custom'
            ? new Date((c.last_message_at ? new Date(c.last_message_at).getTime() : Date.now()) + customHoursNum * 3_600_000)
            : getBulkSnoozeUntil(preset, c.last_message_at)

        return supabase.from('conversations').update({ snoozed_until: until.toISOString() }).eq('id', c.id)
      }),
    )

    setBulkSnoozing(false)
    setBulkSnoozeResult(`Se pospusieron ${convs.length} conversación(es).`)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-sm border border-panel-light bg-panel p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Permisos</h2>
        {loading && <p className="text-sm text-muted">Cargando...</p>}
        {error && <p className="text-sm text-alert">Error: {error}</p>}
        {!loading && !error && (
          <div className="flex flex-col gap-2">
            {operators.map((op) => (
              <div
                key={op.id}
                className="flex items-center justify-between rounded-sm border border-panel-light px-3 py-2"
              >
                <span className="text-sm">{op.full_name}</span>
                <button
                  onClick={() => toggleAdmin(op)}
                  className={`flex items-center gap-1.5 rounded-sm border px-2 py-1 text-xs transition-colors ${
                    op.is_admin
                      ? 'border-mustard/40 text-mustard hover:bg-mustard/10'
                      : 'border-panel-light text-muted hover:text-cream'
                  }`}
                >
                  {op.is_admin ? <ShieldCheck size={12} /> : <Shield size={12} />}
                  {op.is_admin ? 'Es admin' : 'Hacer admin'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-sm border border-panel-light bg-panel p-4">
        <h2 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
          <Zap size={13} /> Snooze automático (regla continua)
        </h2>
        <p className="mb-3 text-xs text-muted">
          Corre solo cada 15 minutos, sin que nadie tenga que apretar nada. Si una conversación abierta
          lleva más del tiempo de inactividad que pongas acá, se pospone sola.
        </p>

        {autoSnoozeLoading ? (
          <p className="text-xs text-muted">Cargando...</p>
        ) : (
          <>
            <label className="mb-3 flex items-center gap-2 text-sm text-cream">
              <input
                type="checkbox"
                checked={autoSnoozeEnabled}
                onChange={(e) => setAutoSnoozeEnabled(e.target.checked)}
                className="h-4 w-4 accent-mustard"
              />
              Regla activada
            </label>

            <div className="mb-3 flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-xs text-muted">Posponer después de (minutos sin actividad)</label>
                <input
                  type="number"
                  min={5}
                  value={autoInactivityMinutes}
                  onChange={(e) => setAutoInactivityMinutes(e.target.value)}
                  className="w-32 rounded-sm border border-panel-light bg-asphalt px-2 py-1.5 text-xs text-cream outline-none focus:border-mustard"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">Duración del snooze (minutos)</label>
                <input
                  type="number"
                  min={5}
                  value={autoSnoozeDurationMinutes}
                  onChange={(e) => setAutoSnoozeDurationMinutes(e.target.value)}
                  className="w-32 rounded-sm border border-panel-light bg-asphalt px-2 py-1.5 text-xs text-cream outline-none focus:border-mustard"
                />
              </div>
              <button
                onClick={saveAutoSnoozeRule}
                disabled={autoSnoozeSaving}
                className="flex items-center gap-1 rounded-sm bg-mustard px-3 py-1.5 text-xs font-medium text-asphalt hover:opacity-90 disabled:opacity-50"
              >
                {autoSnoozeSaved ? <Zap size={12} /> : <Save size={12} />}
                {autoSnoozeSaving ? 'Guardando...' : autoSnoozeSaved ? 'Guardado' : 'Guardar regla'}
              </button>
            </div>

            <p className="text-[11px] text-muted">
              Respeta lo mismo que el resto: no toca conversaciones marcadas "Mantener conmigo", y una
              vez que el cliente escribe de nuevo, se despierta sola sin importar este ajuste.
            </p>
          </>
        )}
      </div>

      <div className="rounded-sm border border-panel-light bg-panel p-4">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Snooze masivo</h2>
        <p className="mb-3 text-xs text-muted">
          Pospone todas las conversaciones abiertas de una — cada una se calcula desde <strong>su propio</strong>{' '}
          último mensaje (salvo "Mañana" y "Próximo lunes", que son fechas de calendario fijas).
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => applyBulkSnooze('15m')}
            disabled={bulkSnoozing}
            className="rounded-sm border border-panel-light px-2 py-1.5 text-xs text-muted hover:border-mustard hover:text-mustard disabled:opacity-50"
          >
            15 min desde el último mensaje
          </button>
          <button
            onClick={() => applyBulkSnooze('1h')}
            disabled={bulkSnoozing}
            className="rounded-sm border border-panel-light px-2 py-1.5 text-xs text-muted hover:border-mustard hover:text-mustard disabled:opacity-50"
          >
            1 hora desde el último mensaje
          </button>
          <button
            onClick={() => applyBulkSnooze('tomorrow')}
            disabled={bulkSnoozing}
            className="rounded-sm border border-panel-light px-2 py-1.5 text-xs text-muted hover:border-mustard hover:text-mustard disabled:opacity-50"
          >
            Mañana 9am
          </button>
          <button
            onClick={() => applyBulkSnooze('monday')}
            disabled={bulkSnoozing}
            className="rounded-sm border border-panel-light px-2 py-1.5 text-xs text-muted hover:border-mustard hover:text-mustard disabled:opacity-50"
          >
            Próximo lunes 9am
          </button>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={1}
              value={customHours}
              onChange={(e) => setCustomHours(e.target.value)}
              className="w-16 rounded-sm border border-panel-light bg-asphalt px-2 py-1.5 text-xs text-cream outline-none focus:border-mustard"
            />
            <span className="text-xs text-muted">hs desde el último mensaje</span>
            <button
              onClick={() => applyBulkSnooze('custom')}
              disabled={bulkSnoozing}
              className="flex items-center gap-1 rounded-sm bg-mustard px-2 py-1.5 text-xs font-medium text-asphalt hover:opacity-90 disabled:opacity-50"
            >
              {bulkSnoozing ? <Loader2 size={12} className="animate-spin" /> : <Clock size={12} />}
              Aplicar
            </button>
          </div>
        </div>
        {bulkSnoozeResult && <p className="mt-2 text-xs text-available">{bulkSnoozeResult}</p>}
      </div>

      <div className="rounded-sm border border-panel-light bg-panel p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
          Auditoría (últimos 30 eventos)
        </h2>
        {auditLoading && <p className="text-sm text-muted">Cargando...</p>}
        {auditError && <p className="text-sm text-alert">Error: {auditError}</p>}
        {!auditLoading && !auditError && auditLog.length === 0 && (
          <p className="text-sm text-muted">Todavía no hay eventos registrados.</p>
        )}
        <div className="flex flex-col gap-1.5">
          {auditLog.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center justify-between border-b border-panel-light/60 py-1.5 text-xs last:border-0"
            >
              <span>
                <span className={actionColor[entry.action] ?? 'text-cream'}>{entry.action}</span>{' '}
                <span className="text-muted">en</span> {entry.target_table}
                {entry.operators?.full_name && (
                  <>
                    {' '}
                    <span className="text-muted">por</span> {entry.operators.full_name}
                  </>
                )}
              </span>
              <span className="font-mono text-muted">
                {new Date(entry.created_at).toLocaleString('es-AR')}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
