// I cantieri: gli stati, il passo, e i calcoli di «fermo» e «in ritardo». Si calcolano al momento dalle date, così
// i giorni restano giusti anche se Google per un po' non pubblica, e l'istantanea non cambia a ogni mezzanotte.

export const STAGES = ['start', 'ongoing', 'review', 'closing', 'closed'] as const
export type Stage = (typeof STAGES)[number]
/** Gli stati di lavoro: tutti tranne chiuso, con cui il cantiere esce dall'elenco. */
export type WorkStage = Exclude<Stage, 'closed'>

export const STAGE_LABELS: Record<Stage, string> = {
  start: 'Avvio',
  ongoing: 'In corso',
  review: 'In revisione',
  closing: 'In chiusura',
  closed: 'Chiuso',
}

export const WORK_STEPS = 4

export const isStage = (value: unknown): value is Stage => STAGES.includes(value as Stage)

/** «Passo n di 4»: la posizione dello stato di lavoro. */
export function stageStep(stage: Stage): number | null {
  return stage === 'closed' ? null : STAGES.indexOf(stage) + 1
}

/** Una data di calendario, «AAAA-MM-GG», nel fuso di Roma. */
export type CalendarDate = string

// Date.parse porta il 30 febbraio al 2 marzo: la data esiste solo se, rifatta, torna uguale.
export const isCalendarDate = (value: unknown): value is CalendarDate =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(Date.parse(value)).toISOString().slice(0, 10) === value

// Si crea alla prima chiamata: il motore non la usa (ha `Utilities.formatDate`), e così non dipende dai fusi di Intl.
let romeFormat: Intl.DateTimeFormat | undefined

export function romeDate(instant: Date): CalendarDate {
  romeFormat ??= new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return romeFormat.format(instant)
}

const DAY = 86_400_000

/** I giorni di calendario da `from` a `to`: negativi se `to` viene prima. */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY)
}

export type ProjectSignals = {
  /** Null se il cantiere non è mai stato aggiornato. */
  daysSinceUpdate: number | null
  /** Fermo: non aggiornato da `staleDays` giorni o più, o mai. */
  stale: boolean
  /** In ritardo: la scadenza del prossimo passo è passata da questi giorni. */
  lateByDays: number | null
  /** «Da aggiornare»: fermo o in ritardo. */
  needsUpdate: boolean
}

export function projectSignals(
  project: { updatedOn: CalendarDate | null; dueOn: CalendarDate | null },
  today: CalendarDate,
  staleDays: number,
): ProjectSignals {
  const daysSinceUpdate = project.updatedOn === null ? null : Math.max(0, daysBetween(project.updatedOn, today))
  const stale = daysSinceUpdate === null || daysSinceUpdate >= staleDays
  const overdue = project.dueOn === null ? 0 : daysBetween(project.dueOn, today)
  const lateByDays = overdue > 0 ? overdue : null
  return { daysSinceUpdate, stale, lateByDays, needsUpdate: stale || lateByDays !== null }
}

/** O4 guarda i 30 giorni, qualunque sia la soglia di «fermo» nelle impostazioni. */
export const FRESH_DAYS = 30

/** O4: quanti cantieri aperti sono aggiornati da meno di 30 giorni, su quanti, e la percentuale arrotondata. */
export function freshProjects(projects: readonly { updatedOn: CalendarDate | null }[], today: CalendarDate) {
  const fresh = projects.filter(
    (project) => project.updatedOn !== null && daysBetween(project.updatedOn, today) < FRESH_DAYS,
  ).length
  const open = projects.length
  return { fresh, open, percent: open ? Math.round((fresh / open) * 100) : null }
}

/** «Cosa succede»: i cantieri aggiornati più di recente, quelli mai aggiornati in fondo. */
export function recentlyUpdated<T extends { title: string; updatedOn: CalendarDate | null }>(
  projects: readonly T[],
  count = 3,
): T[] {
  return [...projects]
    .sort((a, b) => (b.updatedOn ?? '').localeCompare(a.updatedOn ?? '') || a.title.localeCompare(b.title, 'it'))
    .slice(0, count)
}
