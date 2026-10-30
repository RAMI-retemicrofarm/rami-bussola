// L'istantanea dei soci (`v1/soci.json`) vista dal motore: i soli numeri dal Foglio soci, con la sua lista ammessa, e
// la pubblicazione che ricorda quando KV non risponde, perché «Oggi» lo dica finché non riesce. La scrive il giro
// (cycle.ts) e la segreteria dopo ogni registrazione (office.ts).
import {
  MEMBERS_KEY,
  memberCounts,
  memberStatus,
  renewals,
  type CalendarDate,
  type DuesSettings,
  type MembersSnapshot,
} from '@bussola/condiviso'
import { readTable, type ToCalendarDate, type Workbook } from './content.ts'
import {
  readMembers,
  readOfficeSettings,
  readPayments,
  SOCI_SHEETS,
  type MemberRow,
  type OfficeSettings,
  type PaymentRow,
} from './members.ts'
import { publish, type PublishDeps, type PublishResult, type PublishState } from './publish.ts'
import { findViolations, type Shape } from './snapshots.ts'

export type MembersContent = Omit<MembersSnapshot, 'publishedAt'>

/** L'ultima registrazione di un pagamento oltre questi giorni va in rosso in «Oggi» e da guardare in «Salute». */
export const LAST_RECORDING_DAYS = 7

export type MembersSheets = { members: MemberRow[]; payments: PaymentRow[]; settings: OfficeSettings }

/** Le tre schede che servono ai numeri: Soci, Pagamenti e le impostazioni. */
export function readMembersSheets(workbook: Workbook, toCalendarDate: ToCalendarDate): MembersSheets {
  return {
    settings: readOfficeSettings(readTable(workbook, SOCI_SHEETS.settings), toCalendarDate),
    members: readMembers(readTable(workbook, SOCI_SHEETS.members), toCalendarDate),
    payments: readPayments(readTable(workbook, SOCI_SHEETS.payments), toCalendarDate),
  }
}

export function buildMembersSnapshot(
  members: readonly MemberRow[],
  payments: readonly PaymentRow[],
  settings: DuesSettings,
  today: CalendarDate,
): MembersContent {
  const statuses = members.map((member) =>
    memberStatus(
      member.leftOn,
      payments.filter((payment) => payment.memberNumber === member.number),
      today,
    ),
  )
  return {
    version: 1,
    asOf: today,
    counts: memberCounts(statuses),
    renewals: renewals(
      members.map((member) => ({ memberNumber: member.number, leftOn: member.leftOn })),
      payments,
      settings,
      today,
    ),
  }
}

/** La lista ammessa: solo numeri e date. Non c'è un posto per un nome, una mail o un numero socio. */
export const MEMBERS_SHAPE: Shape = {
  version: 'number',
  publishedAt: 'instant',
  asOf: 'date',
  counts: {
    inGoodStanding: 'number',
    paidAhead: 'number',
    dueForRenewal: 'number',
    notInGoodStanding: 'number',
    left: 'number',
    members: 'number',
  },
  renewals: { year: 'number', renewed: 'number', base: 'number', percent: 'number', until: 'id' },
}

/** Il giorno dell'anno dei rinnovi, come «03-31». */
const MONTH_DAY = /^\d{2}-\d{2}$/

/**
 * La lista ammessa, più ciò che la forma «id» non vede: «until» accetterebbe qualunque testo senza mail, anche una
 * riga del Registro privacy, e invece è solo un giorno dell'anno.
 */
export function findMembersViolations(snapshot: Record<string, unknown>): string[] {
  const violations = findViolations(snapshot, MEMBERS_SHAPE)
  const until = (snapshot.renewals as { until?: unknown } | null | undefined)?.until
  if (until !== undefined && (typeof until !== 'string' || !MONTH_DAY.test(until)))
    violations.push('renewals.until: non è un giorno dell’anno')
  return violations
}

export const MEMBERS_PUBLICATION_KEY = 'segreteria:pubblicazione'

/** Da quando la pubblicazione dei numeri non riesce; vuoto se l'ultima è andata. */
export type MembersPublication = { pendingSince: CalendarDate | ''; error: string }

export function readMembersPublication(state: Pick<PublishState, 'get'>): MembersPublication {
  const saved = state.get(MEMBERS_PUBLICATION_KEY)
  if (!saved) return { pendingSince: '', error: '' }
  try {
    const { pendingSince, error } = JSON.parse(saved) as Partial<MembersPublication>
    return { pendingSince: pendingSince ?? '', error: error ?? '' }
  } catch {
    return { pendingSince: '', error: '' }
  }
}

/**
 * Pubblica i numeri come le altre istantanee: niente scrittura se sono uguali all'ultima. Se KV non risponde, o la
 * forma non è quella ammessa, ricorda il primo giorno del guasto: «Oggi» lo dice finché una pubblicazione riesce.
 */
export function publishMembersSnapshot(
  deps: PublishDeps & { today: CalendarDate },
  content: MembersContent,
): PublishResult {
  const violations = findMembersViolations({ ...content, publishedAt: deps.now.toISOString() })
  const result: PublishResult = violations.length
    ? { key: MEMBERS_KEY, status: 'failed', error: `Pubblicazione ferma, niente è uscito: ${violations.join('; ')}` }
    : (publish([{ key: MEMBERS_KEY, content }], deps)[0] ?? { key: MEMBERS_KEY, status: 'unchanged' })
  if (result.status === 'failed') {
    const before = readMembersPublication(deps.state)
    deps.state.set(
      MEMBERS_PUBLICATION_KEY,
      JSON.stringify({ pendingSince: before.pendingSince || deps.today, error: result.error }),
    )
  } else if (deps.state.get(MEMBERS_PUBLICATION_KEY) !== null) deps.state.set(MEMBERS_PUBLICATION_KEY, '')
  return result
}
