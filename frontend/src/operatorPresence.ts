// src/operatorPresence.ts
//
// Todo lo que mantiene operators.presence coherente con si el operador
// de verdad tiene la app abierta. La red de seguridad real está en la
// base (ver PARTE H de supabase/schema.sql): un job de pg_cron pasa a
// "No disponible" a cualquiera en Disponible/Apoyo que no haya mandado
// un heartbeat en los últimos 4 minutos. Acá está la parte del
// navegador: el heartbeat en sí, y pasar a "No disponible" de forma
// explícita (y esperando la respuesta) al cerrar sesión.
//
// No hay un "pasar a offline en beforeunload/pagehide" a propósito: un
// F5 o abrir un link en la misma pestaña disparan exactamente lo mismo
// que cerrarla, y pasar a offline libera TODAS las conversaciones del
// operador (trigger C.3). Para el cierre de pestaña alcanza con que se
// corte el heartbeat y el barrido lo detecte.

import { supabase } from './supabaseClient'
import { logAppError } from './errorLogging'
import type { Presence } from './App'

// Cada cuánto late cada pestaña abierta. El barrido del servidor vence
// a los 4 min, o sea que tolera ~3 heartbeats perdidos seguidos (corte
// de red breve, pestaña en segundo plano con timers frenados).
export const HEARTBEAT_INTERVAL_MS = 60_000

// Devuelve la presencia actual del operador según la base (para
// resincronizar la UI). Tira error si la llamada falla — lo maneja quien
// la llama, no se silencia acá.
export async function sendHeartbeat(): Promise<Presence | null> {
  const { data, error } = await supabase.rpc('operator_heartbeat')
  if (error) throw new Error(error.message)
  return (data as Presence | null) ?? null
}

function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: sin respuesta en ${ms / 1000}s`)), ms)
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

// Pasa al operador logueado a "No disponible" SOLO si estaba en
// Disponible o Apoyo — el filtro va en la propia consulta (no en un
// estado de React que puede estar viejo), así que si ya estaba en No
// disponible, o en 'busy', no se toca. Tira error si falla.
export async function markSelfOffline(): Promise<void> {
  const { data } = await supabase.auth.getSession()
  const userId = data.session?.user.id
  if (!userId) return
  const { error } = await withTimeout(
    supabase
      .from('operators')
      .update({ presence: 'offline' })
      .eq('auth_user_id', userId)
      .in('presence', ['available', 'apoyo']),
    5_000,
    'Pasar a No disponible',
  )
  if (error) throw new Error(error.message)
}

// Cerrar sesión (botón o auto-logout por inactividad): primero pasa a
// "No disponible" — ESPERANDO la respuesta, mientras todavía hay sesión
// para que RLS lo deje — y recién después cierra la sesión. Si el
// update falla (sin red, etc.) se registra y se cierra la sesión igual:
// sin sesión ya no hay heartbeat, y el barrido del servidor lo pasa a
// No disponible en ≤5 min.
export async function signOutOperator(context: string): Promise<void> {
  try {
    await markSelfOffline()
  } catch (err) {
    console.error('No se pudo pasar a No disponible al cerrar sesión:', err)
    logAppError(`${context}: markSelfOffline`, err)
  }
  await supabase.auth.signOut()
}
