// Chi entra nella Riservata: dalla mail del JWT di Access all'impronta, e dall'impronta alla persona
// dell'istantanea riservata, con ruoli e GdL. La mail non esce dalla Function.
import {
  bytesToHex,
  normalizeEmail,
  parseReservedSnapshot,
  RESERVED_KEY,
  type ReservedPerson,
  type ReservedSnapshot,
} from '@bussola/condiviso'

export async function sha256Hex(text: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))
}

export async function findPerson(email: string, snapshot: ReservedSnapshot | null): Promise<ReservedPerson | null> {
  if (!email || !snapshot) return null
  const fingerprint = await sha256Hex(normalizeEmail(email))
  return snapshot.people.find((person) => person.fingerprint === fingerprint) ?? null
}

/**
 * Entra chi sta in «Persone della Riservata» con almeno un ruolo: Direttivo, Coordinamento (i rappresentanti),
 * segreteria, chi cura la Bussola.
 */
export const canEnter = (person: ReservedPerson | null) => (person?.roles.length ?? 0) > 0

/** L'istantanea riservata da KV; null se non c'è o non ha la forma giusta. */
export async function loadReserved(kv: KVNamespace): Promise<ReservedSnapshot | null> {
  try {
    return parseReservedSnapshot(await kv.get(RESERVED_KEY, 'json'))
  } catch {
    return null
  }
}
