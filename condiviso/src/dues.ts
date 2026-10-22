// Le regole delle quote, scritte una volta sola (cartamodello, «Le regole delle quote»): lo stato del socio, l'anno di
// validità di un pagamento, il possibile doppione, il numero del pagamento, i conteggi. Solo ES2020.
import type { CalendarDate } from './projects.ts'

/** Gli stati del socio, in quest'ordine di precedenza: ogni socio ne ha uno solo. */
export const MEMBER_STATUSES = ['left', 'inGoodStanding', 'paidAhead', 'dueForRenewal', 'notInGoodStanding'] as const
export type MemberStatus = (typeof MEMBER_STATUSES)[number]

/** Bonifico, contanti, oppure una quota venuta dal libro soci di oggi con la migrazione (senza data). */
export type PaymentMethod = 'transfer' | 'cash' | 'register'

/** «In attesa del tesoriere» e «annullato» non contano per lo stato del socio. */
export type PaymentStatus = 'recorded' | 'pendingTreasurer' | 'cancelled'

export type DuesSettings = {
  /** «MM-GG»: da questo giorno la quota vale per l'anno dopo. Di partenza «10-15». */
  yearSwitchDay: string
  /** La regola di ottobre vale solo per chi paga la prima quota (segretario, 18/10/2026). Di partenza sì. */
  newMemberOnly: boolean
  /** «MM-GG»: fino a quando entra nella Bussola chi è da rinnovare (T9). Di partenza «03-31». */
  graceUntil: string
  /** L'importo della quota, in euro. Di partenza 30. */
  amount: number
}

export const DEFAULT_DUES_SETTINGS: DuesSettings = {
  yearSwitchDay: '10-15',
  newMemberOnly: true,
  graceUntil: '03-31',
  amount: 30,
}

export type DuesPayment = {
  id: string
  /** Vuoto se il pagamento è senza socio: sta in «Da abbinare». */
  memberNumber: string
  validYear: number
  amount: number
  /** Vuota per le quote venute dal libro soci, che non hanno una data. */
  date: CalendarDate | ''
  method: PaymentMethod
  reference: string
  status: PaymentStatus
}

/** I conteggi per stato: la somma dei primi quattro è `members`, il totale dei soci non receduti. */
export type MemberCounts = {
  inGoodStanding: number
  paidAhead: number
  dueForRenewal: number
  notInGoodStanding: number
  left: number
  members: number
}

/** I filtri di Soci: Tutti, In regola, Da rinnovare. */
export type MemberFilter = 'all' | 'inGoodStanding' | 'dueForRenewal'

/** Un pagamento conta per lo stato del socio se ha un socio ed è registrato. Le quote del libro soci contano. */
export function countsTowardsDues(payment: DuesPayment): boolean {
  return payment.memberNumber.trim() !== '' && payment.status === 'recorded'
}

const yearOf = (date: CalendarDate) => Number(date.slice(0, 4))

/**
 * Lo stato del socio, uno solo, nell'ordine di `MEMBER_STATUSES`. I pagamenti sono quelli del socio (il chiamante li
 * filtra per numero): qui si guardano solo quelli che contano. Chi recede oggi è già receduto.
 */
export function memberStatus(
  leftOn: CalendarDate | '',
  payments: readonly DuesPayment[],
  today: CalendarDate,
): MemberStatus {
  if (leftOn && leftOn <= today) return 'left'
  const year = yearOf(today)
  const years = payments.filter(countsTowardsDues).map((payment) => payment.validYear)
  if (years.includes(year)) return 'inGoodStanding'
  if (years.includes(year + 1)) return 'paidAhead'
  if (years.includes(year - 1)) return 'dueForRenewal'
  return 'notInGoodStanding'
}

/**
 * La prima quota, cioè un nuovo socio: nessun pagamento che conta, e nessuna ammissione in un anno prima di `date`. Chi
 * è socio da anni rinnova, anche se il registro non ha le sue quote vecchie. Un pagamento senza socio è prima quota.
 */
export function isFirstQuota(
  member: { memberNumber: string; admittedOn: CalendarDate | '' },
  date: CalendarDate,
  payments: readonly DuesPayment[],
): boolean {
  if (!member.memberNumber.trim()) return true
  if (member.admittedOn && yearOf(member.admittedOn) < yearOf(date)) return false
  return !payments.some((payment) => payment.memberNumber === member.memberNumber && countsTowardsDues(payment))
}

/**
 * L'anno di validità: l'anno della data, o l'anno dopo dal giorno di cambio anno compreso. Con `newMemberOnly` la
 * regola vale solo per la prima quota, perché un rinnovo tardivo non allunghi la quota a 14 mesi.
 */
export function validYearFor(date: CalendarDate, firstQuota: boolean, settings: DuesSettings): number {
  const year = yearOf(date)
  const switched = date.slice(5, 10) >= settings.yearSwitchDay
  return switched && (firstQuota || !settings.newMemberOnly) ? year + 1 : year
}

const sameReference = (a: string, b: string) => {
  const left = a.trim().toLowerCase()
  return left !== '' && left === b.trim().toLowerCase()
}

/**
 * Il possibile doppione: un pagamento non annullato dello stesso socio, con lo stesso anno o lo stesso riferimento.
 * Con soci diversi non lo è mai (un bonifico di 60 € per due quote). Prima quello con lo stesso anno.
 */
export function findPossibleDuplicate(
  candidate: Pick<DuesPayment, 'memberNumber' | 'validYear' | 'reference'>,
  payments: readonly DuesPayment[],
): DuesPayment | null {
  if (!candidate.memberNumber.trim()) return null
  const sameMember = payments.filter(
    (payment) => payment.memberNumber === candidate.memberNumber && payment.status !== 'cancelled',
  )
  return (
    sameMember.find((payment) => payment.validYear === candidate.validYear) ??
    sameMember.find((payment) => sameReference(payment.reference, candidate.reference)) ??
    null
  )
}

/** «È un altro pagamento»: il primo anno, da `fromYear` compreso, in cui il socio non ha pagamenti non annullati. */
export function firstFreeYear(memberNumber: string, fromYear: number, payments: readonly DuesPayment[]): number {
  const taken = payments
    .filter((payment) => payment.memberNumber === memberNumber && payment.status !== 'cancelled')
    .map((payment) => payment.validYear)
  let year = fromYear
  while (taken.includes(year)) year++
  return year
}

/** Il numero del pagamento, `P-AAAA-NNNN`: il più alto dell'anno + 1. Gli altri anni e le altre forme non contano. */
export function nextPaymentId(year: number, ids: readonly string[]): string {
  const pattern = new RegExp(`^P-${year}-(\\d{4,})$`)
  let highest = 0
  for (const id of ids) {
    const match = pattern.exec(id)
    if (match) highest = Math.max(highest, Number(match[1]))
  }
  return `P-${year}-${String(highest + 1).padStart(4, '0')}`
}

/** I conteggi per stato; `members` sono i soci non receduti. */
export function memberCounts(statuses: Iterable<MemberStatus>): MemberCounts {
  const counts: MemberCounts = {
    inGoodStanding: 0,
    paidAhead: 0,
    dueForRenewal: 0,
    notInGoodStanding: 0,
    left: 0,
    members: 0,
  }
  for (const status of statuses) {
    counts[status]++
    if (status !== 'left') counts.members++
  }
  return counts
}

/** «Tutti» tiene anche i receduti; «In regola» non tiene chi è già in regola per l'anno dopo. */
export function matchesFilter(status: MemberStatus, filter: MemberFilter): boolean {
  return filter === 'all' || status === filter
}

/** Le parole a schermo per lo stato; `year` è l'anno di oggi. */
export function statusLabel(status: MemberStatus, year: number): string {
  switch (status) {
    case 'left':
      return 'Receduto'
    case 'inGoodStanding':
      return 'In regola'
    case 'paidAhead':
      return `Già in regola per il ${year + 1}`
    case 'dueForRenewal':
      return 'Da rinnovare'
    case 'notInGoodStanding':
      return 'Non in regola'
  }
}
