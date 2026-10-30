// La riga dei rinnovi (O8): da gennaio ad aprile, quanti soci dell'anno prima hanno già la quota dell'anno, entro la
// fine della grazia. La leggono «Oggi» della segreteria e la Riservata, dagli stessi numeri. Solo ES2020.
import { countsTowardsDues, type DuesPayment, type DuesSettings } from './dues.ts'
import type { CalendarDate } from './projects.ts'

/** O8: oltre il 92% dei soci dell'anno prima rinnova entro la fine della grazia. */
export const RENEWAL_TARGET_PERCENT = 92

/** I mesi in cui la riga si mostra. */
const RENEWAL_MONTHS = ['01', '02', '03', '04']

/** Una quota del libro soci scritta dalla migrazione: anche i pagamenti «in dubbio» hanno l'id L-, ma un altro modo. */
const fromMigration = (payment: DuesPayment) => payment.method === 'register' && /^L-\d{4}-\d+$/.test(payment.id)

export type Renewals = {
  /** L'anno della quota che si rinnova. */
  year: number
  /** I soci dell'anno prima, non receduti, con la quota dell'anno entro la fine della grazia o dalla migrazione. */
  renewed: number
  /** I soci dell'anno prima, non receduti. */
  base: number
  /** Arrotondata; zero se non c'è nessun socio dell'anno prima. */
  percent: number
  /** La fine della grazia, «MM-GG». */
  until: string
}

/**
 * I rinnovi dell'anno di `today`, da gennaio ad aprile; null negli altri mesi. Un socio dell'anno prima è chi ha una
 * quota che conta per quell'anno e non è receduto: chi si iscrive in ottobre con la quota dell'anno dopo non lo è. Un
 * rinnovo è la quota dell'anno con la data entro la fine della grazia: una quota registrata dopo non lo è. La quota
 * del libro soci venuta con la migrazione (`L-<anno>-NNNN`, modo «libro soci») non ha data ed è un rinnovo: è stata
 * pagata prima. Ogni altra quota senza data no: un pagamento «in dubbio» della migrazione abbinato dopo la grazia, o
 * una riga scritta a mano.
 */
export function renewals(
  members: readonly { memberNumber: string; leftOn: CalendarDate | '' }[],
  payments: readonly DuesPayment[],
  settings: Pick<DuesSettings, 'graceUntil'>,
  today: CalendarDate,
): Renewals | null {
  if (!RENEWAL_MONTHS.includes(today.slice(5, 7))) return null
  const year = Number(today.slice(0, 4))
  const until = settings.graceUntil
  const deadline = `${year}-${until}`
  const counting = payments.filter(countsTowardsDues)
  const renews = (payment: DuesPayment) =>
    payment.validYear === year && (payment.date ? payment.date <= deadline : fromMigration(payment))
  let base = 0
  let renewed = 0
  for (const member of members) {
    if (member.leftOn && member.leftOn <= today) continue
    const own = counting.filter((payment) => payment.memberNumber === member.memberNumber)
    if (!own.some((payment) => payment.validYear === year - 1)) continue
    base++
    if (own.some(renews)) renewed++
  }
  return { year, renewed, base, percent: base ? Math.round((renewed / base) * 100) : 0, until }
}

/** «31/3» da «03-31». */
const dayMonth = (until: string) => `${Number(until.slice(3, 5))}/${Number(until.slice(0, 2))}`

/** «Rinnovi 2027: 150 su 260 (58%) · bersaglio: oltre il 92% al 31/3». */
export function renewalsLabel(result: Renewals): string {
  return `Rinnovi ${result.year}: ${result.renewed} su ${result.base} (${result.percent}%) · bersaglio: oltre il ${RENEWAL_TARGET_PERCENT}% al ${dayMonth(result.until)}`
}
