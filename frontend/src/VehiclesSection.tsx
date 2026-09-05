import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

type Vehicle = {
  id: string
  plate: string
  make: string | null
  color: string | null
  last_seen_at: string
}

export default function VehiclesSection() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('vehicles')
      .select('id, plate, make, color, last_seen_at')
      .order('last_seen_at', { ascending: false })
      .then(({ data }) => {
        setVehicles(data ?? [])
        setLoading(false)
      })
  }, [])

  if (loading) return <p className="text-sm text-muted">Cargando...</p>

  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-sm border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
        Registro de vehículos vistos en los avisos de TaxiCaller (marca ya viene con indicativo, auto y
        año todo junto). Es solo de consulta, no hace falta completar nada acá.
      </p>

      {vehicles.length === 0 && (
        <p className="text-sm text-muted">Todavía no llegó ningún aviso de TaxiCaller.</p>
      )}

      <div className="overflow-x-auto rounded-sm border border-panel-light">
        <table className="w-full text-xs">
          <thead className="bg-panel text-muted">
            <tr>
              <th className="px-3 py-2 text-left">Patente</th>
              <th className="px-3 py-2 text-left">Vehículo</th>
              <th className="px-3 py-2 text-left">Color</th>
              <th className="px-3 py-2 text-left">Visto por última vez</th>
            </tr>
          </thead>
          <tbody>
            {vehicles.map((v) => (
              <tr key={v.id} className="border-t border-panel-light">
                <td className="px-3 py-1.5 font-mono text-cream">{v.plate}</td>
                <td className="px-3 py-1.5 text-cream">{v.make || '—'}</td>
                <td className="px-3 py-1.5 text-muted">{v.color || '—'}</td>
                <td className="px-3 py-1.5 text-muted">{new Date(v.last_seen_at).toLocaleString('es-AR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
