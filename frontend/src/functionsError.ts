// frontend/src/functionsError.ts
//
// supabase.functions.invoke() no siempre expone el mensaje de error real
// que devuelve la función — a veces solo dice "Edge Function returned a
// non-2xx status code". El detalle real viaja en el cuerpo de la
// respuesta (error.context), esta función lo rescata.
export async function getFunctionErrorMessage(error: any, data: any): Promise<string> {
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
