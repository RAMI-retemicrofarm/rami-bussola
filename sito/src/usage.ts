// La misura dell'uso (O5): una chiave KV per ogni persona distinta del mese e area, `uso:<mese>:<area>:<impronta>`.
// L'impronta è un HMAC-SHA256 col sale del mese sul numero socio, o sulla mail per chi non ce l'ha: senza il sale non
// si risale a chi è, e il primo del mese il motore cancella le chiavi e butta il sale (motore/src/usage.ts), così le
// impronte di due mesi non si legano. La chiave si scrive solo se è nuova, e scade da sola al più dopo 70 giorni.
import {
  bytesToHex,
  normalizeEmail,
  saltKey,
  USAGE_TTL_SECONDS,
  usageKey,
  usageMonth,
  type Month,
  type UsageArea,
} from '@bussola/condiviso'

export type UsageIdentity = { memberNumber: string | null; email: string }

/**
 * Il sale del mese. Di solito l'ha già preparato il motore il primo del mese prima; se manca, lo fa la vetrina, e
 * vale il primo scritto. In KV due scritture dello stesso istante possono incrociarsi: nel peggiore dei casi una
 * persona conta due volte nei primi minuti del mese.
 */
async function monthSalt(kv: KVNamespace, month: Month): Promise<string> {
  const saved = await kv.get(saltKey(month))
  if (saved) return saved
  const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(32)))
  await kv.put(saltKey(month), salt, { expirationTtl: USAGE_TTL_SECONDS })
  return salt
}

async function hmacHex(secret: string, text: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  return bytesToHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(text))))
}

/** L'impronta del mese: dal numero socio, o dalla mail normalizzata. Null se non c'è né l'uno né l'altra. */
export async function usageFingerprint(identity: UsageIdentity, salt: string): Promise<string | null> {
  const memberNumber = identity.memberNumber?.trim()
  const email = normalizeEmail(identity.email)
  if (!memberNumber && !email) return null
  return hmacHex(salt, memberNumber ? `socio:${memberNumber}` : `mail:${email}`)
}

/** Conta chi apre una pagina nell'area, una volta al mese. Restituisce la chiave, o null se non c'è chi contare. */
export async function count(
  identity: UsageIdentity,
  area: UsageArea,
  now: Date,
  kv: KVNamespace,
): Promise<string | null> {
  const month = usageMonth(now)
  const fingerprint = await usageFingerprint(identity, await monthSalt(kv, month))
  if (!fingerprint) return null
  const key = usageKey(month, area, fingerprint)
  if ((await kv.get(key)) === null) await kv.put(key, '1', { expirationTtl: USAGE_TTL_SECONDS })
  return key
}
