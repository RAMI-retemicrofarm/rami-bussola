// Lo scadenziario visto dalla segreteria (T4): le scadenze della scheda «Scadenze» del Foglio contenuti, con chi le
// segue e il ritardo a parole; «Fatta», che scrive la data; la scadenza «misura» di ogni mese, che quando si segna
// fatta chiede il numero e lo scrive nella scheda «Misure». Le regole dei tipi stanno in condiviso (deadlines.ts).
import {
  deadlinesToWatch,
  isCalendarDate,
  type CalendarDate,
  type Deadline,
  type DeadlineSignals,
} from '@bussola/condiviso'
import {
  columnOf,
  ContentError,
  readDeadlines,
  readGroups,
  readTable,
  rowValues,
  SHEETS,
  text,
  type ToCalendarDate,
  type Workbook,
} from './content.ts'

/** Una scadenza da guardare, coi segnali già calcolati: la pagina li legge, non li rifà. */
export type OfficeDeadline = Deadline &
  Pick<DeadlineSignals, 'daysLeft' | 'lateByDays' | 'overdueByDays'> & {
    /** «O9» per la misura del mese: quando la si segna fatta, la pagina chiede il numero. Null per le altre. */
    measureObjective: string | null
  }

/** La scadenza «misura» di ogni mese, del segretario: la crea l'automatismo mensile. */
export const MEASURE_DEADLINE = {
  objective: 'O9',
  what: 'Conta i messaggi senza risposta da più di 5 giorni (mail e Instagram)',
  ownerRole: 'il segretario',
  ask: 'Scrivi quanti messaggi sono senza risposta da più di 5 giorni.',
} as const

/** «MIS-O9-2026-11»: l'obiettivo sta nell'id, così «Fatta» sa dove scrivere il numero. */
export const measureDeadlineId = (month: string) => `MIS-${MEASURE_DEADLINE.objective}-${month}`

export const measureObjective = (id: string): string | null => /^MIS-(O\d+)-/.exec(id)?.[1] ?? null

/** L'ultimo giorno del mese «AAAA-MM». */
export function lastDayOfMonth(month: string): CalendarDate {
  const [year = 0, number = 1] = month.split('-').map(Number)
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10)
}

/** Le scadenze da guardare (30 giorni, in ritardo in cima), coi ruoli letti come nella Riservata. */
export function readOfficeDeadlines(
  content: Workbook,
  toCalendarDate: ToCalendarDate,
  today: CalendarDate,
): { deadlines: OfficeDeadline[]; warnings: string[] } {
  const warnings: string[] = []
  try {
    const groups = content.values(SHEETS.groups.name) ? readGroups(readTable(content, SHEETS.groups)) : []
    const rows = readDeadlines(
      readTable(content, SHEETS.deadlines),
      toCalendarDate,
      warnings,
      groups.map((group) => group.name),
    )
    const deadlines = deadlinesToWatch(rows, today).map(({ deadline, signals }) => ({
      ...deadline,
      daysLeft: signals.daysLeft,
      lateByDays: signals.lateByDays,
      overdueByDays: signals.overdueByDays,
      measureObjective: deadline.kind === 'measure' ? measureObjective(deadline.id) : null,
    }))
    return { deadlines, warnings }
  } catch (error) {
    if (!(error instanceof ContentError)) throw error
    return { deadlines: [], warnings: [error.message] }
  }
}

export type DoneInput = {
  id: string
  today: CalendarDate
  toCalendarDate: ToCalendarDate
  /** Il numero della misura, come l'ha scritto la persona; serve solo per una misura con l'obiettivo nell'id. */
  measure?: string
}

/** Il numero di una misura: un intero da zero in su. */
const readMeasure = (value: unknown): number | null => {
  const written = typeof value === 'string' ? value.trim() : ''
  return /^\d+$/.test(written) ? Number(written) : null
}

/** Scrive il numero nella riga dell'obiettivo di «Misure»: la prima volta in «prima», poi in «dopo». */
export function writeMeasure(content: Workbook, objective: string, value: number): void {
  const table = readTable(content, SHEETS.measures)
  const row = table.rows.find((candidate) => text(candidate.get('obiettivo')).startsWith(objective))
  if (!row) throw new ContentError(`«${SHEETS.measures.name}»: non trovo la riga di ${objective}.`)
  const column = text(row.get('prima')) === '' ? 'prima' : 'dopo'
  content.setCell(SHEETS.measures.name, row.index, columnOf(table, column), value)
}

/** «Fatta»: la data in «fatta il»; per la misura del mese anche il numero in «Misure». */
export function markDeadlineDone(
  content: Workbook,
  input: DoneInput,
): { kind: 'done' } | { kind: 'invalid'; message: string } {
  const table = readTable(content, SHEETS.deadlines)
  const row = table.rows.find((candidate) => text(candidate.get('id')) === input.id)
  if (!row) return { kind: 'invalid', message: `Non trovo la scadenza ${input.id}.` }
  if (text(row.get('fatta il'))) return { kind: 'invalid', message: `La scadenza ${input.id} è già fatta.` }
  const objective = text(row.get('tipo')).toLowerCase() === 'misura' ? measureObjective(input.id) : null
  if (objective) {
    const value = readMeasure(input.measure)
    if (value === null) return { kind: 'invalid', message: MEASURE_DEADLINE.ask }
    writeMeasure(content, objective, value)
  }
  content.setCell(SHEETS.deadlines.name, row.index, columnOf(table, 'fatta il'), input.today)
  return { kind: 'done' }
}

/** La scadenza «misura» del mese «AAAA-MM», se non c'è: dice se l'ha creata. */
export function ensureMeasureDeadline(content: Workbook, month: string): boolean {
  const table = readTable(content, SHEETS.deadlines)
  const id = measureDeadlineId(month)
  if (table.rows.some((row) => text(row.get('id')) === id)) return false
  const cells: Record<string, unknown> = {
    id,
    cosa: MEASURE_DEADLINE.what,
    tipo: 'misura',
    data: lastDayOfMonth(month),
    'chi segue (ruolo)': MEASURE_DEADLINE.ownerRole,
    'fatta il': '',
  }
  // Una scheda di prima di T7 non ha la colonna: la misura resta comunque solo nella Riservata.
  if (table.header.has('visibile ai soci')) cells['visibile ai soci'] = 'no'
  content.appendRow(SHEETS.deadlines.name, rowValues(table, cells))
  return true
}

/** Il mese di una data, «AAAA-MM». */
export const monthOf = (date: CalendarDate): string => (isCalendarDate(date) ? date.slice(0, 7) : '')
