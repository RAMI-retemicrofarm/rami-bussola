// La misura dell'uso (O5): quante persone diverse aprono la Bussola in un mese, per area. La vetrina scrive una chiave
// per persona e mese, con un'impronta fatta col sale del mese; il primo del mese il motore conta le chiavi del mese
// prima, le copia nella scheda «Uso», le cancella e butta il sale. Qui il formato delle chiavi, uguale nei due runtime.
import { romeDate } from './projects.ts'
import type { Role } from './reserved.ts'

/** Il Coordinamento (Direttivo e rappresentanti, su pages.dev) e i soci (dall'entrata dei soci, più avanti). */
export const USAGE_AREAS = ['coordinamento', 'soci'] as const
export type UsageArea = (typeof USAGE_AREAS)[number]

/** Le chiavi e il sale scadono al più dopo 70 giorni, anche se il motore non passa a cancellarli. */
export const USAGE_TTL_SECONDS = 70 * 86_400

export const USAGE_PREFIX = 'uso:'
export const SALT_PREFIX = 'uso-sale:'

/** «AAAA-MM» */
export type Month = string

export const usageMonth = (now: Date): Month => romeDate(now).slice(0, 7)

export const usageKey = (month: Month, area: UsageArea, fingerprint: string) =>
  `${USAGE_PREFIX}${month}:${area}:${fingerprint}`

export const saltKey = (month: Month) => `${SALT_PREFIX}${month}`

export function parseUsageKey(key: string): { month: Month; area: UsageArea; fingerprint: string } | null {
  const match = /^uso:(\d{4}-\d{2}):([a-z]+):([0-9a-f]{64})$/.exec(key)
  if (!match || !USAGE_AREAS.includes(match[2] as UsageArea)) return null
  return { month: match[1] ?? '', area: match[2] as UsageArea, fingerprint: match[3] ?? '' }
}

/** Il mese del sale, dalla sua chiave; null se non è un sale. */
export function saltMonth(key: string): Month | null {
  return /^uso-sale:(\d{4}-\d{2})$/.exec(key)?.[1] ?? null
}

/**
 * In quale conteggio entra chi apre una pagina. `person` è la Persona della Riservata, se c'è. Su pages.dev contano
 * solo Direttivo e rappresentanti, una volta sola anche con più ruoli; chi ha solo segreteria o cura della Bussola non
 * conta. Dall'entrata dei soci conta chi non è una Persona della Riservata: chi lo è, sta già nel Coordinamento o
 * non conta.
 */
export function usageArea(person: { roles: readonly Role[] } | null, entry: 'riservata' | 'soci'): UsageArea | null {
  if (entry === 'soci') return person ? null : 'soci'
  return person?.roles.some((role) => role === 'board' || role === 'rep') ? 'coordinamento' : null
}
