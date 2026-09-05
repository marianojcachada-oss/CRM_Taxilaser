import { useEffect, useState } from 'react'
import { Search, Copy, Check, Star, GitMerge } from 'lucide-react'
import { supabase } from './supabaseClient'
import { ChannelIcon, type Channel } from './ConversationsView'
import { phoneForCopy } from './phone'

type Contact = {
  id: string
  full_name: string | null
  phone: string | null
  vip: boolean
  channels: Channel[]
}

type Props = { isAdmin: boolean }

export default function ContactsView({ isAdmin }: Props) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [merging, setMerging] = useState(false)

  useEffect(() => {
    load()

    const channel = supabase
      .channel('contacts-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contacts' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contact_channels' }, load)
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  function load() {
    setLoading(true)
    supabase
      .from('contacts')
      .select('id, full_name, phone, vip, contact_channels(channel)')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          setError(error.message)
        } else {
          setContacts(
            (data ?? []).map((row: any) => ({
              id: row.id,
              full_name: row.full_name,
              phone: row.phone,
              vip: row.vip,
              channels: (row.contact_channels ?? []).map((cc: any) => cc.channel),
            })),
          )
        }
        setLoading(false)
      })
  }

  const normalizedQuery = query.trim().toLowerCase()
  const digitsQuery = query.replace(/\D/g, '')

  const filteredContacts = contacts.filter((c) => {
    if (!normalizedQuery) return true
    const matchesName = (c.full_name ?? '').toLowerCase().includes(normalizedQuery)
    const matchesPhone = digitsQuery.length > 0 && (c.phone ?? '').replace(/\D/g, '').includes(digitsQuery)
    return matchesName || matchesPhone
  })

  async function copyPhone(id: string, phone: string) {
    await navigator.clipboard.writeText(phoneForCopy(phone))
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= 2) return [prev[1], id] // mantiene como mucho 2 seleccionados
      return [...prev, id]
    })
  }

  async function handleMerge() {
    if (selected.length !== 2) return
    const [a, b] = selected
    const contactA = contacts.find((c) => c.id === a)
    const contactB = contacts.find((c) => c.id === b)

    const confirmed = window.confirm(
      `¿Fusionar "${contactA?.full_name || contactA?.phone}" y "${contactB?.full_name || contactB?.phone}" en un solo contacto? Se van a combinar sus conversaciones, canales y métricas. No se puede deshacer.`,
    )
    if (!confirmed) return

    setMerging(true)
    // Se conserva el primero seleccionado; el segundo se descarta.
    const { error } = await supabase.rpc('merge_contacts', { keep_id: a, merge_id: b })
    setMerging(false)

    if (error) {
      alert('No se pudo fusionar: ' + error.message)
      return
    }

    setSelected([])
    load()
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex max-w-sm items-center gap-2 rounded-sm border border-panel-light bg-panel px-2.5 py-1.5">
          <Search size={14} className="text-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre o teléfono..."
            className="w-full bg-transparent text-sm text-cream placeholder-muted outline-none"
          />
        </div>

        {isAdmin && selected.length === 2 && (
          <button
            onClick={handleMerge}
            disabled={merging}
            className="flex items-center gap-1 rounded-sm bg-mustard px-3 py-1.5 text-xs font-medium text-asphalt hover:opacity-90 disabled:opacity-50"
          >
            <GitMerge size={13} /> {merging ? 'Fusionando...' : 'Fusionar los 2 seleccionados'}
          </button>
        )}
      </div>

      {loading && <p className="text-sm text-muted">Cargando...</p>}
      {error && <p className="text-sm text-alert">Error: {error}</p>}

      {!loading && !error && (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-panel-light text-xs text-muted">
              {isAdmin && <th className="pb-2 font-normal"></th>}
              <th className="pb-2 font-normal">Nombre</th>
              <th className="pb-2 font-normal">Teléfono</th>
              <th className="pb-2 font-normal">Se contactó por</th>
              <th className="pb-2 font-normal"></th>
            </tr>
          </thead>
          <tbody>
            {filteredContacts.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 5 : 4} className="py-4 text-muted">
                  {contacts.length === 0
                    ? 'Todavía no hay contactos — van a aparecer solos apenas alguien escriba por primera vez.'
                    : 'Sin resultados.'}
                </td>
              </tr>
            )}
            {filteredContacts.map((c) => (
              <tr key={c.id} className="border-b border-panel-light/60">
                {isAdmin && (
                  <td className="py-2.5">
                    <input
                      type="checkbox"
                      checked={selected.includes(c.id)}
                      onChange={() => toggleSelect(c.id)}
                      className="accent-[var(--color-mustard)]"
                    />
                  </td>
                )}
                <td className="py-2.5">
                  <span className="flex items-center gap-1.5">
                    {c.full_name || <span className="text-muted">Sin nombre</span>}
                    {c.vip && <Star size={12} className="fill-mustard text-mustard" />}
                  </span>
                </td>
                <td className="py-2.5 font-mono text-muted">{c.phone || '—'}</td>
                <td className="py-2.5">
                  <div className="flex items-center gap-1.5">
                    {c.channels.length === 0 && <span className="text-muted">—</span>}
                    {c.channels.map((ch) => (
                      <span key={ch} title={ch}>
                        <ChannelIcon channel={ch} size={14} />
                      </span>
                    ))}
                  </div>
                </td>
                <td className="py-2.5 text-right">
                  {c.phone && (
                    <button
                      onClick={() => copyPhone(c.id, c.phone!)}
                      className="text-muted transition-colors hover:text-mustard"
                      title="Copiar teléfono"
                    >
                      {copiedId === c.id ? <Check size={14} className="text-available" /> : <Copy size={14} />}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {isAdmin && (
        <p className="mt-4 text-xs text-muted">
          Tildá dos contactos para fusionarlos (útil si el mismo cliente quedó duplicado con dos números).
        </p>
      )}
    </div>
  )
}
