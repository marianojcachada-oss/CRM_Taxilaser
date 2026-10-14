import { useEffect, useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { supabase } from './supabaseClient'
import { useToast } from './Toast'
import { formatMessageDateTimeShort } from './atlantaTime'

type Status = 'nuevo' | 'en_revision' | 'resuelto'
type Kind = 'problema' | 'idea' | 'soporte'

type Report = {
  id: string
  created_at: string
  kind: Kind
  message: string
  sender_operator_id: string | null
  sender_name: string
  sender_code: string | null
  page_url: string | null
  conversation_id: string | null
  user_agent: string | null
  status: Status
  admin_reply: string | null
  replied_at: string | null
}

const KIND_LABEL: Record<Kind, string> = { problema: '🐞 Problema', idea: '💡 Idea', soporte: '🛟 Soporte' }
const STATUS_LABEL: Record<Status, string> = { nuevo: 'Nuevo', en_revision: 'En revisión', resuelto: 'Resuelto' }
const STATUS_STYLE: Record<Status, string> = {
  nuevo: 'border-mustard/50 text-mustard',
  en_revision: 'border-info/50 text-info',
  resuelto: 'border-available/50 text-available',
}

type Tab = 'todos' | Status

function csvCell(v: string | null | undefined): string {
  const s = (v ?? '').replace(/"/g, '""')
  return `"${s}"`
}

// Solo superadmin (ver AdminPanel + RLS de problem_reports). Es el registro de
// lo que mandó cada operador: no se puede editar ni borrar el mensaje original,
// solo cambiarle el estado y dejar una respuesta.
export default function ReportsSection() {
  const toast = useToast()
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('nuevo')
  const [replies, setReplies] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)

  function load() {
    supabase
      .from('problem_reports')
      .select(
        'id, created_at, kind, message, sender_operator_id, sender_name, sender_code, page_url, conversation_id, user_agent, status, admin_reply, replied_at',
      )
      .order('created_at', { ascending: false })
      .limit(500)
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else {
          setError(null)
          setReports((data as Report[]) ?? [])
        }
        setLoading(false)
      })
  }

  useEffect(() => {
    load()
    const channel = supabase
      .channel('problem-reports-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'problem_reports' }, load)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const counts = useMemo(() => {
    const c = { todos: reports.length, nuevo: 0, en_revision: 0, resuelto: 0 }
    for (const r of reports) c[r.status]++
    return c
  }, [reports])

  const visible = tab === 'todos' ? reports : reports.filter((r) => r.status === tab)

  async function setStatus(r: Report, status: Status) {
    setSavingId(r.id)
    const { error } = await supabase.from('problem_reports').update({ status }).eq('id', r.id)
    setSavingId(null)
    if (error) toast.error('No se pudo cambiar el estado: ' + error.message)
    else setReports((prev) => prev.map((x) => (x.id === r.id ? { ...x, status } : x)))
  }

  async function saveReply(r: Report) {
    const text = (replies[r.id] ?? '').trim()
    if (!text) return
    setSavingId(r.id)
    const { error } = await supabase
      .from('problem_reports')
      .update({ admin_reply: text, replied_at: new Date().toISOString(), status: r.status === 'nuevo' ? 'en_revision' : r.status })
      .eq('id', r.id)
    setSavingId(null)
    if (error) {
      toast.error('No se pudo guardar la respuesta: ' + error.message)
      return
    }
    toast.success('Respuesta guardada: el operador la ve en su ventana de reportes.')
    setReplies((prev) => ({ ...prev, [r.id]: '' }))
    load()
  }

  function exportCsv() {
    const header = ['fecha_atlanta', 'tipo', 'operador', 'codigo', 'estado', 'mensaje', 'pantalla', 'conversacion', 'respuesta']
    const rows = reports.map((r) =>
      [
        formatMessageDateTimeShort(r.created_at),
        r.kind,
        r.sender_name,
        r.sender_code,
        r.status,
        r.message,
        r.page_url,
        r.conversation_id,
        r.admin_reply,
      ]
        .map(csvCell)
        .join(','),
    )
    const blob = new Blob(['﻿' + [header.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `problemas_reportados_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return <p className="text-sm text-muted">Cargando reportes...</p>
  if (error) return <p className="text-sm text-alert">Error al cargar los reportes: {error}</p>

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {(['nuevo', 'en_revision', 'resuelto', 'todos'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                tab === t ? 'border-mustard bg-mustard/15 font-semibold text-mustard' : 'border-panel-light text-muted hover:text-cream'
              }`}
            >
              {t === 'todos' ? 'Todos' : STATUS_LABEL[t]} <span className="tabular-nums">({counts[t]})</span>
            </button>
          ))}
        </div>
        <button
          onClick={exportCsv}
          disabled={reports.length === 0}
          className="flex items-center gap-1.5 rounded-sm border border-panel-light px-3 py-1.5 text-xs text-muted hover:border-mustard hover:text-mustard disabled:opacity-50"
          title="Descarga todos los reportes (fecha de Atlanta, operador, mensaje)"
        >
          <Download size={13} /> Exportar CSV
        </button>
      </div>

      <p className="text-xs text-muted">
        Registro de lo que mandan los operadores. El mensaje original no se puede editar ni borrar desde acá: solo cambiar el estado y
        responder. Las fechas están en hora de Atlanta.
      </p>

      {visible.length === 0 && <p className="text-sm text-muted">No hay reportes en esta vista.</p>}

      {visible.map((r) => (
        <div key={r.id} className="rounded-sm border border-panel-light bg-panel p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-cream">
                {r.sender_name}
                {r.sender_code ? <span className="ml-1.5 font-mono text-xs text-muted">{r.sender_code}</span> : null}
              </span>
              <span className="rounded-full border border-panel-light px-2 py-0.5 text-[11px] text-muted">{KIND_LABEL[r.kind]}</span>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
            </div>
            <span className="text-xs tabular-nums text-muted">{formatMessageDateTimeShort(r.created_at)} · Atlanta</span>
          </div>

          <p className="whitespace-pre-wrap break-words text-sm text-cream">{r.message}</p>

          {(r.page_url || r.conversation_id) && (
            <p className="mt-2 break-all text-[11px] text-muted">
              Pantalla: <span className="font-mono">{r.page_url ?? '—'}</span>
            </p>
          )}

          {r.admin_reply && (
            <p className="mt-3 whitespace-pre-wrap break-words border-l-2 border-mustard pl-2 text-xs text-cream">
              <span className="block text-[10px] uppercase tracking-wide text-mustard">
                Tu respuesta{r.replied_at ? ` · ${formatMessageDateTimeShort(r.replied_at)}` : ''}
              </span>
              {r.admin_reply}
            </p>
          )}

          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <textarea
              rows={2}
              value={replies[r.id] ?? ''}
              onChange={(e) => setReplies((prev) => ({ ...prev, [r.id]: e.target.value }))}
              placeholder={r.admin_reply ? 'Escribir una nueva respuesta…' : 'Responder al operador…'}
              className="min-w-0 flex-1 resize-none rounded-sm border border-panel-light bg-asphalt px-2 py-1.5 text-xs text-cream placeholder-muted outline-none focus:border-mustard"
            />
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                onClick={() => saveReply(r)}
                disabled={savingId === r.id || !(replies[r.id] ?? '').trim()}
                className="rounded-sm bg-mustard px-3 py-1.5 text-xs font-medium text-asphalt hover:opacity-90 disabled:opacity-50"
              >
                Responder
              </button>
              <select
                value={r.status}
                disabled={savingId === r.id}
                onChange={(e) => setStatus(r, e.target.value as Status)}
                className="rounded-sm border border-panel-light bg-asphalt px-2 py-1.5 text-xs text-cream outline-none focus:border-mustard"
              >
                <option value="nuevo">Nuevo</option>
                <option value="en_revision">En revisión</option>
                <option value="resuelto">Resuelto</option>
              </select>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
