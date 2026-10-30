// Il calendario Google «Scadenze RAMI» (T4): un evento di un giorno per ogni scadenza aperta, con l'avviso 7 giorni
// prima; niente mail di promemoria. Ogni notte il motore lo allinea alla scheda «Scadenze»: crea, aggiorna, toglie le
// fatte. Il calendario entra come `DeadlineCalendar`; in Apps Script lo fa CalendarApp (google.ts).
import type { CalendarDate, Deadline } from '@bussola/condiviso'

export const CALENDAR_NAME = 'Scadenze RAMI'
export const REMINDER_DAYS = 7
/** Il tag dell'evento che porta l'id della scadenza. */
export const EVENT_TAG = 'scadenza'

/** Un evento del calendario già legato a una scadenza, dal suo tag. */
export type CalendarEvent = { id: string; deadlineId: string; title: string; date: CalendarDate }

export type DeadlineCalendar = {
  events(): CalendarEvent[]
  /** Un evento di un giorno, col tag e l'avviso 7 giorni prima. */
  create(deadlineId: string, title: string, date: CalendarDate): void
  update(id: string, title: string, date: CalendarDate): void
  remove(id: string): void
}

const KIND_WORDS: Record<Deadline['kind'], string> = {
  call: 'Bando',
  duty: '',
  tax: 'Fiscale',
  event: 'Evento',
  assembly: 'Assemblea',
  measure: 'Misura',
}

/** «Bilancio al Direttivo · segue: il tesoriere»; il tipo fra parentesi quando non è un adempimento. */
export function eventTitle(deadline: Deadline): string {
  const kind = KIND_WORDS[deadline.kind]
  const owner = deadline.ownerRole.trim()
  return `${deadline.what}${kind ? ` (${kind})` : ''}${owner ? ` · segue: ${owner}` : ''}`
}

export type CalendarPlan = {
  create: { deadlineId: string; title: string; date: CalendarDate }[]
  update: { id: string; title: string; date: CalendarDate }[]
  remove: string[]
}

/** Cosa fare perché il calendario dica ciò che dice la scheda: le aperte ci sono una volta, le fatte no. */
export function calendarPlan(deadlines: readonly Deadline[], events: readonly CalendarEvent[]): CalendarPlan {
  const plan: CalendarPlan = { create: [], update: [], remove: [] }
  const open = new Map(
    deadlines.filter((deadline) => deadline.doneOn === null).map((deadline) => [deadline.id, deadline]),
  )
  const seen = new Set<string>()
  for (const event of events) {
    const deadline = open.get(event.deadlineId)
    if (!deadline || seen.has(event.deadlineId)) {
      plan.remove.push(event.id)
      continue
    }
    seen.add(event.deadlineId)
    const title = eventTitle(deadline)
    if (title !== event.title || deadline.dueOn !== event.date)
      plan.update.push({ id: event.id, title, date: deadline.dueOn })
  }
  for (const deadline of open.values())
    if (!seen.has(deadline.id))
      plan.create.push({ deadlineId: deadline.id, title: eventTitle(deadline), date: deadline.dueOn })
  return plan
}

export function syncDeadlineCalendar(
  deadlines: readonly Deadline[],
  calendar: DeadlineCalendar,
): { created: number; updated: number; removed: number } {
  const plan = calendarPlan(deadlines, calendar.events())
  for (const item of plan.create) calendar.create(item.deadlineId, item.title, item.date)
  for (const item of plan.update) calendar.update(item.id, item.title, item.date)
  for (const id of plan.remove) calendar.remove(id)
  return { created: plan.create.length, updated: plan.update.length, removed: plan.remove.length }
}
