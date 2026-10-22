// Le scadenze: i tipi, chi le segue e cosa vuol dire «in ritardo» (cartamodello, «Stati»). Come per i cantieri si
// calcola al momento dalle date: la Riservata (T2) e «Oggi» della segreteria (T4) le leggono allo stesso modo.
import { daysBetween, type CalendarDate } from './projects.ts'

/** Bando, adempimento, fiscale, evento, Assemblea, misura. */
export const DEADLINE_KINDS = ['call', 'duty', 'tax', 'event', 'assembly', 'measure'] as const
export type DeadlineKind = (typeof DEADLINE_KINDS)[number]

export const isDeadlineKind = (value: unknown): value is DeadlineKind => DEADLINE_KINDS.includes(value as DeadlineKind)

/** Gli adempimenti: passati e non fatti sono «In ritardo di N giorni», in rosso, e contano per O7. */
const DUTIES: readonly DeadlineKind[] = ['duty', 'tax', 'assembly']
export const isDuty = (kind: DeadlineKind) => DUTIES.includes(kind)

export type Deadline = {
  id: string
  what: string
  kind: DeadlineKind
  dueOn: CalendarDate
  /** Il ruolo di chi la segue («il tesoriere», «una persona di Struttura»), mai il nome; vuoto se nessuno. */
  ownerRole: string
  doneOn: CalendarDate | null
}

/** La Riservata guarda le scadenze dei prossimi 30 giorni. */
export const DEADLINE_WINDOW_DAYS = 30

export type DeadlineSignals = {
  /** I giorni da oggi alla data: negativi se è passata. */
  daysLeft: number
  /** Un adempimento passato e non fatto: da quanti giorni. */
  lateByDays: number | null
  /** Una misura passata e non fatta: da quanti giorni. Non va in rosso e non conta per O7. */
  overdueByDays: number | null
  /** Un bando o un evento passato e non fatto è «Scaduto», ed esce. */
  expired: boolean
  unowned: boolean
}

export function deadlineSignals(deadline: Deadline, today: CalendarDate): DeadlineSignals {
  const daysLeft = daysBetween(today, deadline.dueOn)
  const passedBy = deadline.doneOn === null && daysLeft < 0 ? -daysLeft : null
  return {
    daysLeft,
    lateByDays: passedBy !== null && isDuty(deadline.kind) ? passedBy : null,
    overdueByDays: passedBy !== null && deadline.kind === 'measure' ? passedBy : null,
    expired: passedBy !== null && (deadline.kind === 'call' || deadline.kind === 'event'),
    unowned: !deadline.ownerRole.trim(),
  }
}

export type WatchedDeadline = { deadline: Deadline; signals: DeadlineSignals }

/**
 * Le scadenze da guardare: gli adempimenti in ritardo in cima, dal più vecchio; poi le misure passate e le scadenze
 * dei prossimi 30 giorni, dalla più vicina. Non ci sono le fatte, né i bandi e gli eventi scaduti.
 */
export function deadlinesToWatch(deadlines: readonly Deadline[], today: CalendarDate): WatchedDeadline[] {
  return deadlines
    .filter((deadline) => deadline.doneOn === null)
    .map((deadline) => ({ deadline, signals: deadlineSignals(deadline, today) }))
    .filter(({ signals }) => !signals.expired && signals.daysLeft <= DEADLINE_WINDOW_DAYS)
    .sort(
      (a, b) =>
        (b.signals.lateByDays ?? -1) - (a.signals.lateByDays ?? -1) ||
        a.signals.daysLeft - b.signals.daysLeft ||
        (a.deadline.id < b.deadline.id ? -1 : a.deadline.id > b.deadline.id ? 1 : 0),
    )
}

/** I due numeri in cima alla Riservata: le scadenze dei prossimi 30 giorni, e quelle da guardare senza nessuno. */
export function deadlineCounts(deadlines: readonly Deadline[], today: CalendarDate) {
  const watched = deadlinesToWatch(deadlines, today)
  return {
    next: watched.filter(({ signals }) => signals.daysLeft >= 0).length,
    unowned: watched.filter(({ signals }) => signals.unowned).length,
  }
}

/** O7: gli adempimenti con la data nell'anno dato, fatti dopo la data. */
export function lateDutiesDone(deadlines: readonly Deadline[], year: string): number {
  return deadlines.filter(
    (deadline) =>
      isDuty(deadline.kind) &&
      deadline.dueOn.slice(0, 4) === year &&
      deadline.doneOn !== null &&
      deadline.doneOn > deadline.dueOn,
  ).length
}

/**
 * Gli anni di cui la Riservata conta O7: quello di oggi e, a gennaio, quello appena chiuso, che si copia nella scheda
 * «Misure» fino al 31/1. Un adempimento dell'anno chiuso fatto a gennaio conta così nel suo anno.
 */
export function lateDutiesYears(today: CalendarDate): string[] {
  const year = today.slice(0, 4)
  return today.slice(5, 7) === '01' ? [year, String(Number(year) - 1)] : [year]
}

/** I verbali stanno nel Drive: un link che porta altrove non si mostra. */
export const isDriveUrl = (value: unknown): value is string =>
  typeof value === 'string' && /^https:\/\/(?:drive|docs)\.google\.com\//.test(value)
