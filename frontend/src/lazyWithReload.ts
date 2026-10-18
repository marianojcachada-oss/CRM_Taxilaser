import { lazy, type ComponentType } from 'react'

// React.lazy con red de seguridad: si después de un deploy el navegador
// intenta bajar un archivo viejo que ya no existe (nombre con hash
// distinto), recarga la página UNA vez para traer la versión nueva en vez
// de quedar con la pantalla en blanco.
export function lazyWithReload<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy(() =>
    factory().catch((err) => {
      try {
        if (sessionStorage.getItem('lazyReloaded') !== '1') {
          sessionStorage.setItem('lazyReloaded', '1')
          window.location.reload()
          return new Promise<{ default: T }>(() => {})
        }
      } catch {
        /* sessionStorage no disponible */
      }
      throw err
    }),
  )
}
