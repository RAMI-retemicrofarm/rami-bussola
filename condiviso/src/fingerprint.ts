// L'impronta delle mail delle Persone della Riservata: SHA-256 della mail normalizzata, in esadecimale. È
// un'eccezione dichiarata (ADR 0003): le stesse mail stanno già nella lista di Access. Lo SHA-256 lo fa ogni runtime
// col suo strumento (Web Crypto nella vetrina, Utilities nel motore); qui c'è ciò che deve tornare uguale.

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Apps Script dà i byte con il segno (da -128 a 127), Web Crypto senza: l'esadecimale è lo stesso. */
export function bytesToHex(bytes: ArrayLike<number>): string {
  let hex = ''
  for (let i = 0; i < bytes.length; i++) hex += ((bytes[i] ?? 0) & 0xff).toString(16).padStart(2, '0')
  return hex
}

/** Il vettore di prova, uguale nei due runtime. */
export const FINGERPRINT_VECTOR = {
  email: ' Direttivo@Example.org ',
  fingerprint: '070fe12ea53b8b0fd3527700f2ff8122aaeb6860151ce291595ec753d4a311d1',
} as const

export const isFingerprint = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
