// supabase/functions/_shared/phone.ts
//
// Normaliza teléfonos antes de buscar/crear contactos, para que
// "4045968232" y "+14045968232" se reconozcan como el mismo número
// (así se evita crear un contacto y una conversación duplicados).
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");

  // 10 dígitos: número de EE.UU./Canadá sin código de país -> agregarlo
  if (digits.length === 10) return `+1${digits}`;

  // 11 dígitos empezando en 1: ya tiene el código de país, solo formatear
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;

  // Cualquier otro caso (números internacionales): dejar los dígitos
  // con el "+" adelante, tal cual vinieron
  return `+${digits}`;
}