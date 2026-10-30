// I pezzi comuni delle pagine. Ogni stato ha parola, forma e colore insieme, mai il solo colore
// (docs/design/sistema.md, «Come si scrive uno stato»): la forma è decorativa, la parola dice tutto.
import {
  STAGE_LABELS,
  stageStep,
  WORK_STEPS,
  type CalendarDate,
  type DeadlineKind,
  type LocalDateTime,
  type WorkStage,
} from '@bussola/condiviso'

export const KIND_LABELS: Record<DeadlineKind, string> = {
  call: 'Bando',
  duty: 'Adempimento',
  tax: 'Fiscale',
  event: 'Evento',
  assembly: 'Assemblea',
  measure: 'Misura',
}

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

/** Un importo che il tesoriere non ha scritto è «—», non zero. */
export const money = (amount: number | null) => (amount === null ? '—' : formatEuro(amount))

/**
 * La percentuale dello speso sul previsto, arrotondata; non c'è se manca un importo o il previsto è zero. Lo spazio
 * prima non va a capo: la percentuale non resta sola su una riga.
 */
const spentShare = (planned: number | null, spent: number | null) =>
  planned === null || spent === null || planned === 0 ? '' : `\u00a0(${Math.round((spent / planned) * 100)}%)`

/**
 * «5.000 € · speso 1.200 € (24%)»: dopo «Previsto» nelle righe del budget e nella scheda di un impegno, dopo
 * «previsto» nel totale.
 */
export const plannedAndSpent = ({ planned, spent }: { planned: number | null; spent: number | null }) =>
  `${money(planned)} · speso ${money(spent)}${spentShare(planned, spent)}`

const meetingDay = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })

/** «giovedì 5 novembre alle 18:30», con l'anno solo se non è quello di oggi: un'ora di Roma, senza fusi. */
export function formatMeeting(startsAt: LocalDateTime, today: CalendarDate): string {
  const day = meetingDay.format(new Date(`${startsAt.slice(0, 10)}T00:00:00Z`))
  const year = startsAt.slice(0, 4) === today.slice(0, 4) ? '' : ` ${startsAt.slice(0, 4)}`
  return `${day}${year} alle ${startsAt.slice(11, 16)}`
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

/**
 * Il prossimo incontro: quando, di che gruppo e «Entra su Meet». `internal`: non è visibile ai soci, lo vede il
 * rappresentante del gruppo.
 */
export function MeetingCard(props: {
  meeting: { startsAt: LocalDateTime; meetUrl: string }
  groupName?: string
  internal?: boolean
  today: CalendarDate
}) {
  const when = formatMeeting(props.meeting.startsAt, props.today)
  return (
    <>
      <p class="quando">{when}</p>
      {props.groupName && <p class="small">{props.groupName}</p>}
      {props.internal && <p class="small">Solo per chi partecipa al gruppo: i soci non lo vedono.</p>}
      <a class="btn" href={props.meeting.meetUrl}>
        Entra su Meet
        <span class="vh">
          : {props.groupName ? `${props.groupName}, ` : ''}
          {when}
        </span>
      </a>
    </>
  )
}
