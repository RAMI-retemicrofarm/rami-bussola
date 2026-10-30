// Chi entra nella Riservata: dalla mail del JWT di Access all'impronta, e dall'impronta alla persona
// dell'istantanea riservata, con ruoli e GdL. La mail non esce dalla Function.
import {
  bytesToHex,
  MEMBERS_KEY,
  normalizeEmail,
  parseMembersSnapshot,
  parseReservedSnapshot,
  parseSiteSnapshot,
  RESERVED_KEY,
  SITE_KEY,
  type MembersSnapshot,
  type ReservedPerson,
  type ReservedSnapshot,
  type SiteSnapshot,
} from '@bussola/condiviso'

export async function sha256Hex(text: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))
}

export async function findPerson(email: string, snapshot: ReservedSnapshot | null): Promise<ReservedPerson | null> {
  if (!email || !snapshot) return null
  const fingerprint = await sha256Hex(normalizeEmail(email))
  return snapshot.people.find((person) => person.fingerprint === fingerprint) ?? null
}

/** Chi entra: la regola sta in `@bussola/condiviso`, perché la usa anche il seed dell'anteprima. */
export { canEnter } from '@bussola/condiviso'

/** Il GdL del rappresentante: i suoi tasti («Aggiorna il tuo gruppo», «Aggiungi un incontro») stanno su pages.dev. */
export const repGroupId = (person: ReservedPerson | null) => (person?.roles.includes('rep') ? person.groupId : null)

/** L'istantanea riservata da KV; null se non c'è o non ha la forma giusta. */
export async function loadReserved(kv: KVNamespace): Promise<ReservedSnapshot | null> {
  try {
    return parseReservedSnapshot(await kv.get(RESERVED_KEY, 'json'))
  } catch {
    return null
  }
}

/** L'istantanea del sito da KV; null se non c'è o non ha la forma giusta. */
export async function loadSite(kv: KVNamespace): Promise<SiteSnapshot | null> {
  try {
    return parseSiteSnapshot(await kv.get(SITE_KEY, 'json'))
  } catch {
    return null
  }
}

/** L'istantanea dei soci da KV, i soli numeri (da T4); null se non c'è o non ha la forma giusta. */
export async function loadMembers(kv: KVNamespace): Promise<MembersSnapshot | null> {
  try {
    return parseMembersSnapshot(await kv.get(MEMBERS_KEY, 'json'))
  } catch {
    return null
  }
}
