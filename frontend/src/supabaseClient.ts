import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Storage a medida para el "recordarme" del login: si el checkbox está
// tildado, la sesión se guarda en localStorage (sobrevive a cerrar el
// navegador); si no, se guarda en sessionStorage (se borra al cerrar la
// pestaña/navegador). El flag "rememberMe" se setea ANTES de loguearse,
// así que cuando supabase-js persiste la sesión ya sabe a cuál ir.
const authStorage = {
  // La sesión se busca en las DOS storages (primero la de la pestaña, después
  // la persistente), sin depender del flag "rememberMe" al LEER. Antes, si ese
  // flag cambiaba mientras había una sesión abierta (por ejemplo, otra
  // pestaña o persona iniciaba sesión sin tildar "Recordarme"), esta pestaña
  // empezaba a leer de la storage equivocada y Supabase respondía "Auth
  // session missing" — la pantalla seguía abierta pero nada se enviaba.
  getItem: (key: string) => {
    return sessionStorage.getItem(key) ?? localStorage.getItem(key)
  },
  // Al guardar (login o renovación del token) se escribe donde ya está la
  // sesión; solo si no existe todavía se usa el flag "rememberMe".
  setItem: (key: string, value: string) => {
    if (sessionStorage.getItem(key) !== null) {
      sessionStorage.setItem(key, value)
    } else if (localStorage.getItem(key) !== null) {
      localStorage.setItem(key, value)
    } else {
      const remember = localStorage.getItem('rememberMe') === 'true'
      ;(remember ? localStorage : sessionStorage).setItem(key, value)
    }
  },
  removeItem: (key: string) => {
    localStorage.removeItem(key)
    sessionStorage.removeItem(key)
  },
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { storage: authStorage },
})
