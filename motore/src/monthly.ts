// L'automatismo mensile della segreteria (T4), dal trigger di ogni notte insieme alla chiusura dell'uso: il primo del
// mese, o la prima notte utile, crea la scadenza «misura» del mese e salva il libro soci nel Drive. Se la copia non
// riesce, lo stato del libro lo dice in «Oggi» e la notte dopo ci riprova. Tutto entra come parametro.
import type { CalendarDate } from '@bussola/condiviso'
import { ensureMeasureDeadline, measureDeadlineId, monthOf } from './agenda.ts'
import type { ToCalendarDate, Workbook } from './content.ts'
import type { PublishState } from './publish.ts'
import { registerName, saveMemberRegister, type RegisterStore } from './register.ts'

export const MONTHLY_STATE_KEY = 'segreteria:mensile'

export type MonthlyDeps = {
  /** Il Foglio contenuti, per «Scadenze». */
  content: Workbook
  /** Il Foglio soci, per il libro. */
  soci: Workbook
  state: PublishState
  today: CalendarDate
  toCalendarDate: ToCalendarDate
  store: RegisterStore
}

export function runMonthly(deps: MonthlyDeps): { ran: boolean; lines: string[] } {
  const month = monthOf(deps.today)
  if (!month || deps.state.get(MONTHLY_STATE_KEY) === month) return { ran: false, lines: [] }
  const lines: string[] = []
  if (ensureMeasureDeadline(deps.content, month))
    lines.push(`Scadenza «misura» di ${month} creata: ${measureDeadlineId(month)}.`)
  const register = saveMemberRegister({
    workbook: deps.soci,
    toCalendarDate: deps.toCalendarDate,
    today: deps.today,
    store: deps.store,
    state: deps.state,
  })
  if (register.failedOn === deps.today) {
    lines.push(`Libro soci non salvato: ${register.error}. Ci riprovo domani notte.`)
    return { ran: true, lines }
  }
  lines.push(`Libro soci salvato nel Drive: «${registerName(deps.today)}».`)
  deps.state.set(MONTHLY_STATE_KEY, month)
  return { ran: true, lines }
}
