// frontend/src/functionsError.ts
//
// supabase.functions.invoke() no siempre expone el mensaje de error real
// que devuelve la función — a veces solo dice "Edge Function returned a
// non-2xx status code". El detalle real viaja en el cuerpo de la
// respuesta (error.context), esta función lo rescata.
export async function getFunctionErrorMessage(error: any, data: any): Promise<string> {
  const message = await readFunctionErrorMessage(error, data)
  // Si el error es de sesión perdida, se avisa a App.tsx para que lo
  // verifique en el momento (renueva la sesión o manda al login).
  if (/auth session missing|no autenticado/i.test(message)) {
    window.dispatchEvent(new Event('session-check'))
  }
  return message
}

async function readFunctionErrorMessage(error: any, data: any): Promise<string> {
  if (data?.error) {
    return typeof data.error === 'string' ? data.error : JSON.stringify(data.error)
  }

  if (error?.context && typeof error.context.json === 'function') {
    try {
      const body = await error.context.json()
      if (body?.error) {
        return typeof body.error === 'string' ? body.error : JSON.stringify(body.error)
      }
    } catch {
      // el cuerpo no era JSON parseable, seguimos al mensaje genérico
    }
  }

  return error?.message ?? 'Ocurrió un error inesperado'
}
