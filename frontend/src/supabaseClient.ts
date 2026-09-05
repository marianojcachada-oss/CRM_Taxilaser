import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Storage a medida para el "recordarme" del login: si el checkbox está
// tildado, la sesión se guarda en localStorage (sobrevive a cerrar el
// navegador); si no, se guarda en sessionStorage (se borra al cerrar la
// pestaña/navegador). El flag "rememberMe" se setea ANTES de loguearse,
// así que cuando supabase-js persiste la sesión ya sabe a cuál ir.
const authStorage = {
  getItem: (key: string) => {
    const remember = localStorage.getItem('rememberMe') === 'true'
    return (remember ? localStorage : sessionStorage).getItem(key)
  },
  setItem: (key: string, value: string) => {
    const remember = localStorage.getItem('rememberMe') === 'true'
    ;(remember ? localStorage : sessionStorage).setItem(key, value)
  },
  removeItem: (key: string) => {
    localStorage.removeItem(key)
    sessionStorage.removeItem(key)
  },
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { storage: authStorage },
})
