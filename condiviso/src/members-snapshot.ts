// L'istantanea dei soci (`v1/soci.json`): i soli numeri, per la Riservata. I conteggi per stato e la riga dei
// rinnovi; mai un nome, una mail o un numero socio. La scrive il motore dal Foglio soci, a ogni giro e dopo ogni
// registrazione; la vetrina rilegge la forma di ciò che arriva da KV, come per le altre istantanee.
import { MEMBER_STATUSES, type MemberCounts } from './dues.ts'
import { isCalendarDate, type CalendarDate } from './projects.ts'
import type { Renewals } from './renewals.ts'

export const MEMBERS_KEY = 'v1/soci.json'

export type MembersSnapshot = {
  version: 1
  /** ISO 8601, in UTC. */
  publishedAt: string
  /** Il giorno di Roma a cui gli stati sono contati. */
  asOf: CalendarDate
  counts: MemberCounts
  /** Da gennaio ad aprile; null negli altri mesi. */
  renewals: Renewals | null
}

type Fields = Record<string, unknown>
const isObject = (value: unknown): value is Fields => typeof value === 'object' && value !== null
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0

function parseCounts(value: unknown): MemberCounts | null {
  if (!isObject(value)) return null
  const counts: Partial<MemberCounts> = {}
  for (const status of [...MEMBER_STATUSES, 'members'] as const) {
    const count = value[status]
    if (!isCount(count)) return null
    counts[status] = count
  }
  return counts as MemberCounts
}

function parseRenewals(value: unknown): Renewals | null | undefined {
  if (value === null) return null
  if (!isObject(value)) return undefined
  const { year, renewed, base, percent, until } = value
  if (!isCount(year) || !isCount(renewed) || !isCount(base) || !isCount(percent)) return undefined
  if (typeof until !== 'string' || !/^\d{2}-\d{2}$/.test(until)) return undefined
  return { year, renewed, base, percent, until }
}

export function parseMembersSnapshot(value: unknown): MembersSnapshot | null {
  if (!isObject(value) || value.version !== 1) return null
  const { publishedAt, asOf } = value
  if (typeof publishedAt !== 'string' || Number.isNaN(Date.parse(publishedAt))) return null
  if (!isCalendarDate(asOf)) return null
  const counts = parseCounts(value.counts)
  const renewals = parseRenewals(value.renewals)
  if (!counts || renewals === undefined) return null
  return { version: 1, publishedAt, asOf, counts, renewals }
}
