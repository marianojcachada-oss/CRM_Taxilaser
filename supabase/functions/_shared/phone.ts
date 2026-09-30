// supabase/functions/_shared/phone.ts
//
// Normaliza teléfonos antes de buscar/crear contactos, para que
// "4045968232" y "+14045968232" se reconozcan como el mismo número
// (así se evita crear un contacto y una conversación duplicados).
export function normalizePhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");

  // "011" es el código de salida internacional que se usa en EE.UU./Canadá
  // (el equivalente local al "+"). Si un número viene cargado así (por
  // ejemplo, un pasajero de México en TaxiCaller como "011 52 XXXXXXXXXX"
  // en vez de "+52 XXXXXXXXXX"), sin esto quedaba pegado adelante del
  // código de país real y armaba un número inválido ("+01152..." en vez
  // de "+52..."), que RingCentral rechazaba. Ningún código de país real
  // empieza con "011", así que sacarlo siempre que aparezca al principio
  // es seguro.
  if (digits.length > 11 && digits.startsWith("011")) {
    digits = digits.slice(3);
  }

  // 10 dígitos: número de EE.UU./Canadá sin código de país -> agregarlo
  if (digits.length === 10) return `+1${digits}`;

  // 11 dígitos empezando en 1: ya tiene el código de país, solo formatear
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;

  // Cualquier otro caso (números internacionales): dejar los dígitos
  // con el "+" adelante, tal cual vinieron
  return `+${digits}`;
}