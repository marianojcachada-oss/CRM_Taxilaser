import { useEffect, useState } from 'react'
import { Save, Check } from 'lucide-react'
import { supabase } from './supabaseClient'
import { useToast } from './Toast'

// Piezas compartidas por las pantallas que editan integration_settings
// (Integrations y AI): carga/guardado, interruptores y campos.

export type Field = { key: string; label: string; secret?: boolean; placeholder?: string; wide?: boolean }
export type ToggleDef = { key: string; label: string; defaultOn?: boolean }

export const INPUT_CLASS =
  'w-full rounded-sm border border-panel-light bg-asphalt px-2 py-1.5 font-mono text-xs text-cream outline-none focus:border-mustard'

type Row = { key: string; value: string | null }

export function useIntegrationSettings(readOnly: boolean) {
  const toast = useToast()
  const [values, setValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [savedKey, setSavedKey] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('integration_settings')
      .select('key, value')
      .then(({ data, error }) => {
        if (error) {
          setError(error.message)
        } else {
          const map: Record<string, string> = {}
          for (const row of (data as Row[]) ?? []) map[row.key] = row.value ?? ''
          setValues(map)
        }
        setLoading(false)
      })
  }, [])

  async function saveValue(key: string) {
    if (readOnly) return
    setSavingKey(key)
    const { error } = await supabase
      .from('integration_settings')
      .upsert({ key, value: values[key] ?? '', updated_at: new Date().toISOString() })

    setSavingKey(null)
    if (error) {
      toast.error('No se pudo guardar: ' + error.message)
      return
    }
    setSavedKey(key)
    setTimeout(() => setSavedKey(null), 1500)
  }

  // defaultOn = se considera activado mientras no se guarde 'false'.
  function isOn(t: ToggleDef) {
    return t.defaultOn ? values[t.key] !== 'false' : values[t.key] === 'true'
  }

  async function flip(t: ToggleDef) {
    if (readOnly) return
    const next = isOn(t) ? 'false' : 'true'
    setValues((prev) => ({ ...prev, [t.key]: next }))
    await supabase.from('integration_settings').upsert({ key: t.key, value: next, updated_at: new Date().toISOString() })
  }

  // Guarda de una vez un valor puntual (selectores, casillas, claves generadas).
  async function setAndSave(key: string, value: string) {
    if (readOnly) return
    setValues((prev) => ({ ...prev, [key]: value }))
    const { error } = await supabase
      .from('integration_settings')
      .upsert({ key, value, updated_at: new Date().toISOString() })
    if (error) toast.error('No se pudo guardar: ' + error.message)
  }

  return { values, setValues, loading, error, savingKey, savedKey, saveValue, isOn, flip, setAndSave }
}

export function SaveButton({ label, saving, saved, onClick }: { label: string; saving: boolean; saved: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={saving}
      aria-label={`Guardar ${label}`}
      title="Guardar"
      className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-sm border border-panel-light text-muted transition-colors hover:border-mustard hover:text-mustard disabled:opacity-50"
    >
      {saved ? <Check size={13} className="text-available" /> : <Save size={13} />}
    </button>
  )
}

export function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 rounded-sm border border-panel-light px-3 py-2 text-left text-xs text-cream transition-colors hover:border-mustard"
    >
      <span>{label}</span>
      <span className={`flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors ${on ? 'bg-available' : 'bg-panel-light'}`}>
        <span className={`h-3 w-3 rounded-full bg-cream transition-transform ${on ? 'translate-x-3' : ''}`} />
      </span>
    </button>
  )
}

export function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-sm border border-panel-light bg-panel p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  )
}

type FieldsProps = {
  fields: Field[]
  values: Record<string, string>
  setValues: React.Dispatch<React.SetStateAction<Record<string, string>>>
  savingKey: string | null
  savedKey: string | null
  saveValue: (key: string) => void
}

export function Fields({ fields, values, setValues, savingKey, savedKey, saveValue }: FieldsProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {fields.map((f) => (
        <div key={f.key} className={f.wide ? 'sm:col-span-2' : ''}>
          <label htmlFor={f.key} className="mb-1 block text-xs text-muted">
            {f.label}
          </label>
          <div className="flex items-center gap-2">
            <input
              id={f.key}
              type={f.secret ? 'password' : 'text'}
              autoComplete="off"
              placeholder={f.placeholder}
              value={values[f.key] ?? ''}
              onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
              className={INPUT_CLASS}
            />
            <SaveButton label={f.label} saving={savingKey === f.key} saved={savedKey === f.key} onClick={() => saveValue(f.key)} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function Segmented({
  label,
  options,
  value,
  onChange,
  tone,
}: {
  label: string
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
  tone?: (v: string) => 'neutral' | 'alert'
}) {
  return (
    <div>
      <p className="mb-1 text-xs text-muted">{label}</p>
      <div role="radiogroup" aria-label={label} className="grid grid-cols-1 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
        {options.map((o) => {
          const selected = value === o.value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(o.value)}
              className={`rounded-sm border px-2 py-2 text-xs transition-colors ${
                selected
                  ? tone?.(o.value) === 'alert'
                    ? 'border-alert/60 bg-alert/10 text-alert'
                    : 'border-available/60 bg-available/10 text-available'
                  : 'border-panel-light text-muted hover:border-mustard hover:text-mustard'
              }`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function TextAreaField({
  id,
  label,
  rows = 5,
  value,
  onChange,
  onSave,
  saving,
  saved,
  placeholder,
}: {
  id: string
  label: string
  rows?: number
  value: string
  onChange: (v: string) => void
  onSave: () => void
  saving: boolean
  saved: boolean
  placeholder?: string
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs text-muted">
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className={`${INPUT_CLASS} mb-2`}
      />
      <SaveButton label={label} saving={saving} saved={saved} onClick={onSave} />
    </div>
  )
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      disabled={!text}
      aria-label={`Copiar ${label}`}
      title="Copiar"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          /* sin permiso de portapapeles: no pasa nada */
        }
      }}
      className="flex h-[30px] shrink-0 items-center justify-center rounded-sm border border-panel-light px-2 text-[11px] text-muted transition-colors hover:border-mustard hover:text-mustard disabled:opacity-40"
    >
      {copied ? 'Copiado' : 'Copiar'}
    </button>
  )
}
