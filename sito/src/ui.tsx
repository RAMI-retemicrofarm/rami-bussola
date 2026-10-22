// I pezzi comuni delle pagine. Ogni stato ha parola, forma e colore insieme, mai il solo colore
// (docs/design/sistema.md, «Come si scrive uno stato»): la forma è decorativa, la parola dice tutto.
import { STAGE_LABELS, stageStep, WORK_STEPS, type CalendarDate, type WorkStage } from '@bussola/condiviso'

const days = (count: number) => (count === 1 ? '1 giorno' : `${count} giorni`)

/** «oggi», «ieri», «12 giorni fa»; «mai aggiornato» se non c'è data. */
export const sinceUpdate = (count: number | null) =>
  count === null ? 'mai aggiornato' : count === 0 ? 'oggi' : count === 1 ? 'ieri' : `${count} giorni fa`

export const staleLabel = (count: number | null) => (count === null ? 'Mai aggiornato' : `Fermo da ${days(count)}`)
export const lateLabel = (count: number) => `In ritardo di ${days(count)}`
export const overdueLabel = (count: number) => `passata da ${days(count)}`
export const pastLabel = (count: number) => `Passata da ${days(count)}`

const dayFormat = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', timeZone: 'UTC' })

/** «30 novembre», con l'anno solo se non è quello di oggi. */
export function formatDay(date: CalendarDate, today: CalendarDate): string {
  const day = dayFormat.format(new Date(`${date}T00:00:00Z`))
  return date.slice(0, 4) === today.slice(0, 4) ? day : `${day} ${date.slice(0, 4)}`
}

// Il punto delle migliaia anche sotto i 10.000 («1.200 €»): l'italiano di Intl di suo lo toglie.
const euro = (digits: number) =>
  new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    useGrouping: 'always',
    minimumFractionDigits: digits,
    maximumFractionDigits: 2,
  })
const euroWhole = euro(0)
const euroCents = euro(2)

/** «1.200 €», «4.771,50 €»: i centesimi solo se ci sono, e allora sempre due cifre. */
export function formatEuro(amount: number): string {
  const rounded = Math.round(amount * 100) / 100
  return (Number.isInteger(rounded) ? euroWhole : euroCents).format(rounded)
}

const instantDay = new Intl.DateTimeFormat('it-IT', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/Rome',
})
const instantTime = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' })

/** «18 ottobre 2026 alle 21:40», all'ora di Roma. */
export const formatInstant = (iso: string) =>
  `${instantDay.format(new Date(iso))} alle ${instantTime.format(new Date(iso))}`

const STAGE_MARKS: Record<WorkStage, { tone: string; shape: string }> = {
  start: { tone: 'warn', shape: 'dot' },
  ongoing: { tone: 'ok', shape: 'dot pieno' },
  review: { tone: 'ok', shape: 'dot mezzo' },
  closing: { tone: 'ok', shape: 'dot mezzo' },
}

export function StageLine({ stage }: { stage: WorkStage }) {
  const { tone, shape } = STAGE_MARKS[stage]
  const step = stageStep(stage) ?? 0
  return (
    <>
      <p class="riga-stato">
        <span class={`stato ${tone}`}>
          <span class={shape} aria-hidden="true"></span>
          {STAGE_LABELS[stage]}
        </span>
        <span class="small">
          {' '}
          · passo {step} di {WORK_STEPS}
        </span>
      </p>
      <div class="passi" aria-hidden="true">
        {Array.from({ length: WORK_STEPS }, (_, i) => (
          <i class={i < step ? 'on' : ''}></i>
        ))}
      </div>
    </>
  )
}

/** Uno stato con la sua forma: `dot` cerchio vuoto, `pieno`, `tri` triangolo. */
export function Signal({
  tone,
  shape,
  children,
}: {
  tone: 'ok' | 'warn' | 'bad'
  shape: 'dot' | 'pieno' | 'tri'
  children: unknown
}) {
  const mark = shape === 'tri' ? 'tri' : shape === 'pieno' ? 'dot pieno' : 'dot'
  return (
    <p class={`stato ${tone}`}>
      <span class={mark} aria-hidden="true"></span>
      {children}
    </p>
  )
}
