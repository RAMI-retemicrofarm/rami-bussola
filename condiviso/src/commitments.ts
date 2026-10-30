// Gli impegni (T6): gli stati, dalla proposta alla ratifica e alla chiusura, chi li vede, e «Impegni coperti» (O10).
// La Riservata ha la scheda intera in sette blocchi; il sito solo gli impegni ratificati e non ancora chiusi, col
// numero socio di chi li ha presi e mai il nome, e il compenso solo se «si vede ai soci». Solo ES2020: lo leggono
// motore e vetrina.
import { isCalendarDate, type CalendarDate } from './projects.ts'

/**
 * Da scrivere → proposto → approvato dal Coordinamento → ratificato, cioè aperto → preso → in corso → consegnato →
 * chiuso. Da proposto si può andare a respinto.
 */
export const COMMITMENT_STATUSES = [
  'toWrite',
  'proposed',
  'approved',
  'open',
  'taken',
  'ongoing',
  'delivered',
  'closed',
  'rejected',
] as const
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number]

export const COMMITMENT_STATUS_LABELS: Record<CommitmentStatus, string> = {
  toWrite: 'Da scrivere',
  proposed: 'Proposto',
  approved: 'Approvato dal Coordinamento',
  open: 'Aperto',
  taken: 'Preso',
  ongoing: 'In corso',
  delivered: 'Consegnato',
  closed: 'Chiuso',
  rejected: 'Respinto',
}

/**
 * Gli stati che escono sul sito: dalla ratifica alla consegna. Il cartamodello vuole sul sito «gli impegni aperti e
 * presi»: un chiuso, con qualunque esito, resta nella Riservata, così un «revocato» non resta legato a un numero socio.
 */
const PUBLIC_STATUSES: readonly CommitmentStatus[] = ['open', 'taken', 'ongoing', 'delivered']

/** Ogni chiusura ha il suo esito. */
export const COMMITMENT_OUTCOMES = ['completed', 'revoked', 'withdrawn'] as const
export type CommitmentOutcome = (typeof COMMITMENT_OUTCOMES)[number]

export const COMMITMENT_OUTCOME_LABELS: Record<CommitmentOutcome, string> = {
  completed: 'completato',
  revoked: 'revocato',
  withdrawn: 'ritirato',
}

/** Continuativo o a progetto. */
export const COMMITMENT_TERMS = ['ongoing', 'project'] as const
export type CommitmentTerm = (typeof COMMITMENT_TERMS)[number]

export const COMMITMENT_TERM_LABELS: Record<CommitmentTerm, string> = { ongoing: 'Continuativo', project: 'A progetto' }

/** Come si è pagati: niente, il rimborso delle spese, un compenso. */
export const COMMITMENT_PAYS = ['volunteer', 'expenses', 'paid'] as const
export type CommitmentPay = (typeof COMMITMENT_PAYS)[number]

export const COMMITMENT_PAY_LABELS: Record<CommitmentPay, string> = {
  volunteer: 'Volontario',
  expenses: 'Rimborso spese',
  paid: 'Compenso',
}

export const isCommitmentStatus = (value: unknown): value is CommitmentStatus =>
  COMMITMENT_STATUSES.includes(value as CommitmentStatus)
export const isPublicStatus = (status: CommitmentStatus) => PUBLIC_STATUSES.includes(status)

type Counted = { status: CommitmentStatus; outcome: CommitmentOutcome | null; year: number }

/** Da coprire: ogni impegno dell'anno, tranne i respinti e i chiusi revocati o ritirati. Comprende «da scrivere». */
export const toCover = (commitment: Omit<Counted, 'year'>) =>
  commitment.status !== 'rejected' &&
  !(commitment.status === 'closed' && (commitment.outcome === 'revoked' || commitment.outcome === 'withdrawn'))

/** Coperto: preso, in corso, consegnato, o chiuso completato. */
export const isCovered = (commitment: Omit<Counted, 'year'>) =>
  commitment.status === 'taken' ||
  commitment.status === 'ongoing' ||
  commitment.status === 'delivered' ||
  (commitment.status === 'closed' && commitment.outcome === 'completed')

/**
 * Un impegno vivo vale per l'anno in cui vive: si conta nell'anno dato anche se è di un anno prima, così a capodanno
 * un impegno preso a dicembre non esce dai coperti. Un chiuso o un respinto si conta solo nel suo anno.
 */
const countsIn = (commitment: Counted, year: number) =>
  commitment.status === 'closed' || commitment.status === 'rejected'
    ? commitment.year === year
    : commitment.year <= year

/** O10: quanti impegni dell'anno sono coperti, su quanti da coprire, e la percentuale arrotondata. */
export function commitmentCoverage(commitments: readonly Counted[], year: number) {
  const ofYear = commitments.filter((commitment) => countsIn(commitment, year))
  const counted = ofYear.filter(toCover).length
  const covered = ofYear.filter(isCovered).length
  return { covered, toCover: counted, percent: counted ? Math.round((covered / counted) * 100) : null }
}

/** «Impegni coperti: 2 su 5 (40%)». */
export const coverageLabel = (coverage: ReturnType<typeof commitmentCoverage>) =>
  `Impegni coperti: ${coverage.covered} su ${coverage.toCover} (${coverage.percent ?? 0}%)`

/** Il bersaglio di O10: almeno l'80% degli impegni con una scheda approvata e una persona. */
export const COVERAGE_TARGET_PERCENT = 80

/** La scheda in sette blocchi, per la Riservata. Chi è un numero socio, mai un nome. */
export type ReservedCommitment = {
  id: string
  /** L'anno in cui l'impegno si conta. */
  year: number
  title: string
  status: CommitmentStatus
  /** Solo per i chiusi; null se non è scritto. */
  outcome: CommitmentOutcome | null
  /** Per i respinti. */
  rejectionReason: string
  // 1. Cosa si fa.
  what: string
  // 2. Per quale cantiere o GdL: come è scritto, e il GdL quando si riconosce.
  forLabel: string
  groupId: string | null
  // 3. Quanto tempo.
  days: number | null
  until: CalendarDate | null
  term: CommitmentTerm | null
  // 4. Cosa si consegna e chi verifica.
  deliverables: string
  verifierNumber: string | null
  // 5. Come si è pagati.
  pay: CommitmentPay | null
  fee: number | null
  feeVisible: boolean
  // 6. Chi l'ha approvato.
  proposedBy: string | null
  proposedOn: CalendarDate | null
  coordinationOn: CalendarDate | null
  ratifiedOn: CalendarDate | null
  // 7. Se serve smettere.
  howToLeave: string
  howToRevoke: string
  /** Chi l'ha preso, e il suo GdL o ruolo per dirlo senza nome. */
  assigneeNumber: string | null
  assigneeRole: string
  substituteNumber: string | null
  /** Dalla scheda «Budget», come per i cantieri: null se il tesoriere non l'ha scritto. */
  planned: number | null
  spent: number | null
}

/** Sul sito: solo i ratificati e non chiusi, senza la cifra se non «si vede ai soci». */
export type SiteCommitment = {
  id: string
  title: string
  what: string
  forLabel: string
  groupId: string | null
  status: CommitmentStatus
  days: number | null
  until: CalendarDate | null
  term: CommitmentTerm | null
  pay: CommitmentPay | null
  /** Solo se «si vede ai soci»; se no null. */
  fee: number | null
  /** Serve dopo, per i tasti di chi l'ha preso: è un numero, mai un nome. Solo per preso, in corso e consegnato. */
  assigneeNumber: string | null
  assigneeRole: string
}

type Fields = Record<string, unknown>
const isObject = (value: unknown): value is Fields => typeof value === 'object' && value !== null
const isText = (value: unknown): value is string => typeof value === 'string'
const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const idOrNull = (value: unknown) => (isId(value) ? value : null)
const dateOrNull = (value: unknown) => (isCalendarDate(value) ? value : null)
const amount = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const oneOf = <T extends string>(values: readonly T[], value: unknown): T | null =>
  values.includes(value as T) ? (value as T) : null

/** La parte comune: un campo che ha un valore fuori elenco scarta l'impegno. */
function parseCommon(value: unknown) {
  if (!isObject(value) || !isId(value.id) || !isText(value.title) || !isCommitmentStatus(value.status)) return null
  const { what, forLabel, assigneeRole } = value
  if (!isText(what) || !isText(forLabel) || !isText(assigneeRole)) return null
  const term = oneOf(COMMITMENT_TERMS, value.term)
  const pay = oneOf(COMMITMENT_PAYS, value.pay)
  if ((value.term !== null && !term) || (value.pay !== null && !pay)) return null
  return {
    id: value.id,
    title: value.title,
    what,
    forLabel,
    groupId: idOrNull(value.groupId),
    status: value.status,
    days: amount(value.days),
    until: dateOrNull(value.until),
    term,
    pay,
    fee: amount(value.fee),
    assigneeNumber: idOrNull(value.assigneeNumber),
    assigneeRole,
  }
}

export function parseReservedCommitment(value: unknown): ReservedCommitment | null {
  const common = parseCommon(value)
  if (!common || !isObject(value) || typeof value.year !== 'number' || typeof value.feeVisible !== 'boolean')
    return null
  const { rejectionReason, deliverables, howToLeave, howToRevoke } = value
  if (!isText(rejectionReason) || !isText(deliverables) || !isText(howToLeave) || !isText(howToRevoke)) return null
  return {
    id: common.id,
    year: value.year,
    title: common.title,
    status: common.status,
    outcome: oneOf(COMMITMENT_OUTCOMES, value.outcome),
    rejectionReason,
    what: common.what,
    forLabel: common.forLabel,
    groupId: common.groupId,
    days: common.days,
    until: common.until,
    term: common.term,
    deliverables,
    verifierNumber: idOrNull(value.verifierNumber),
    pay: common.pay,
    fee: common.fee,
    feeVisible: value.feeVisible,
    proposedBy: idOrNull(value.proposedBy),
    proposedOn: dateOrNull(value.proposedOn),
    coordinationOn: dateOrNull(value.coordinationOn),
    ratifiedOn: dateOrNull(value.ratifiedOn),
    howToLeave,
    howToRevoke,
    assigneeNumber: common.assigneeNumber,
    assigneeRole: common.assigneeRole,
    substituteNumber: idOrNull(value.substituteNumber),
    planned: amount(value.planned),
    spent: amount(value.spent),
  }
}

/** Sul sito un impegno che non è dei soci non si legge: la vetrina non lo mostra nemmeno per sbaglio. */
export function parseSiteCommitment(value: unknown): SiteCommitment | null {
  const common = parseCommon(value)
  return common && isPublicStatus(common.status) ? common : null
}
