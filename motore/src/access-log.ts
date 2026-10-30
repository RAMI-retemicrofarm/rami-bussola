// Il «Registro di Accessi»: un trigger installabile onEdit, creato dall'account della Bussola, scrive ogni cambio della
// scheda «Accessi» (cartamodello, «Accessi»). Nessuno script scrive in «Accessi»: qui si scrive solo nel registro,
// che è protetto. «Oggi» del segretario mostra i cambi degli ultimi 30 giorni; il registro li tiene tutti.
import { daysBetween, type CalendarDate } from '@bussola/condiviso'
import {
  readCalendarDate,
  readTable,
  rowValues,
  text,
  type Table,
  type ToCalendarDate,
  type Workbook,
} from './content.ts'
import { SOCI_SHEETS } from './members.ts'
import type { AccessChange } from './office-api.ts'

/** L'evento onEdit come oggetto semplice: la colla in google.ts lo legge da `e`. */
export type AccessEdit = {
  sheet: string
  /** Le celle in notazione A1: «D3», «A4:C4». */
  cells: string
  singleCell: boolean
  /** `e.oldValue` e `e.value`: Google li dà solo per una cella sola; mancano se la cella era vuota o è cancellata. */
  oldValue?: unknown
  value?: unknown
  /** I valori mostrati delle celle cambiate, per più celle. */
  shown: unknown[][]
  /** La mail, se Google la dà. */
  user: string
  when: Date
}

export const UNKNOWN_USER = 'non noto'
export const ACCESS_LOG_DAYS = 30

/** Scrive la riga nel registro se il cambio è in «Accessi». Dice se l'ha scritta. */
export function logAccessEdit(workbook: Workbook, edit: AccessEdit): boolean {
  if (edit.sheet !== SOCI_SHEETS.access.name) return false
  const shown = edit.shown.flatMap((row) => row.map(text))
  const log = readTable(workbook, SOCI_SHEETS.accessLog)
  workbook.appendRow(
    log.spec.name,
    rowValues(log, {
      quando: edit.when,
      chi: edit.user.trim() || UNKNOWN_USER,
      'quali celle': edit.cells,
      'valore prima': edit.singleCell ? text(edit.oldValue) : '',
      'valore dopo': edit.singleCell ? text(edit.value) : shown.some(Boolean) ? shown.join(' · ') : '',
    }),
  )
  return true
}

/** I cambi degli ultimi 30 giorni, dal più recente. `formatInstant` scrive data e ora nel fuso di Roma. */
export function recentAccessChanges(
  table: Table,
  today: CalendarDate,
  toCalendarDate: ToCalendarDate,
  formatInstant: (instant: Date) => string,
): AccessChange[] {
  const changes: { at: number; change: AccessChange }[] = []
  for (const row of table.rows) {
    const value = row.get('quando')
    const day = readCalendarDate(value, toCalendarDate)
    if (!day || daysBetween(day, today) > ACCESS_LOG_DAYS) continue
    changes.push({
      at: value instanceof Date ? value.getTime() : Date.parse(day),
      change: {
        when: value instanceof Date ? formatInstant(value) : text(value),
        who: text(row.get('chi')),
        cells: text(row.get('quali celle')),
        before: text(row.get('valore prima')),
        after: text(row.get('valore dopo')),
      },
    })
  }
  return changes.sort((a, b) => b.at - a.at).map(({ change }) => change)
}
