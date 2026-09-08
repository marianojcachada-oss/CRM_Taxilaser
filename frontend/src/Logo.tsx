import { useState } from 'react'
import { Car } from 'lucide-react'

export default function Logo({ size }: { size: number }) {
  const [broken, setBroken] = useState(false)

  if (broken) {
    // Si el archivo no carga por el motivo que sea, mostramos un
    // distintivo en vez de un ícono roto feo.
    return (
      <div
        style={{ width: size, height: size }}
        className="flex items-center justify-center rounded-2xl bg-mustard text-asphalt"
      >
        <Car size={size * 0.5} />
      </div>
    )
  }

  return (
    <img
      src="/logo.png"
      alt="Qué tal?"
      style={{ width: size, height: size }}
      className="object-contain"
      onError={() => setBroken(true)}
    />
  )
}
