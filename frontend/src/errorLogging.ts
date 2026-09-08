// src/errorLogging.ts
//
// Cada excepción que llega hasta acá sin ser atrapada por nadie (o
// promesa rechazada sin .catch), y cualquier llamada explícita a
// logAppError(), queda registrada en la tabla app_errors — visible
// después en el panel admin, en "Errores". No reemplaza mirar los Logs
// de Edge Functions en Supabase para lo que pasa del lado del servidor;
// esto es solo para lo que le pasa al operador en su propio navegador.

import { supabase } from './supabaseClient'

let installed = false

async function report(context: string, message: string, stack?: string) {
  try {
    await supabase.from('app_errors').insert({
      context,
      message: message.slice(0, 2000),
      stack: stack?.slice(0, 4000) ?? null,
      url: window.location.href,
      user_agent: navigator.userAgent,
    })
  } catch {
    // Si esto falla (sin sesión, sin red, etc.) no hay mucho más para
    // hacer — no queremos que reportar un error tire otro error.
  }
}

export function logAppError(context: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? error.stack : undefined
  void report(context, message, stack)
}

export function installGlobalErrorLogging() {
  if (installed) return
  installed = true

  window.addEventListener('error', (event) => {
    void report('window.onerror', event.message, event.error?.stack)
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const message = reason instanceof Error ? reason.message : String(reason)
    const stack = reason instanceof Error ? reason.stack : undefined
    void report('unhandledrejection', message, stack)
  })
}
