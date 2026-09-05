// frontend/src/phone.ts
//
// Para pegar en TaxiCaller hace falta el número sin el "+1" adelante,
// si no la búsqueda no encuentra la cuenta del usuario.
export function phoneForCopy(phone: string): string {
  return phone.replace(/^\+1\s?/, '').trim()
}
