// L'istantanea riservata (`v1/riservata.json`): ciò che vedono Direttivo, Coordinamento e segreteria su pages.dev.
// In T1 porta i GdL coi link precompilati del Modulo, i cantieri aperti e le Persone della Riservata come impronte;
// in T2 le scadenze, le delibere, le questioni aperte e il budget; in T6 gli impegni, con la scheda in sette blocchi.
// Nessun nome: chi segue è un ruolo, chi prende un impegno un numero socio.
// Il motore la scrive, la vetrina la legge: quello che arriva da KV non è fidato finché non ha la forma giusta.
import { parseReservedCommitment, type ReservedCommitment } from './commitments.ts'
import { isDeadlineKind, isDriveUrl, type Deadline } from './deadlines.ts'
import { isFingerprint } from './fingerprint.ts'
import { isCalendarDate, isStage, type CalendarDate, type WorkStage } from './projects.ts'
import { isLocalDateTime, isMeetUrl, type Meeting } from './site.ts'

export const RESERVED_KEY = 'v1/riservata.json'

/** Direttivo, rappresentante (anche esterno), segreteria, cura della Bussola. */
export const ROLES = ['board', 'rep', 'office', 'keeper'] as const
export type Role = (typeof ROLES)[number]

export type ReservedGroup = {
  id: string
  name: string
  /** Il Modulo «Aggiorna il cantiere» con gruppo e codice del gruppo, senza cantiere: ne nasce uno nuovo. */
  newProjectUrl: string | null
  /** Il Modulo «Prossimo incontro» con gruppo e codice del gruppo (da T7). */
  newMeetingUrl: string | null
}

/** Un incontro dei prossimi 60 giorni, anche quelli non visibili ai soci: il rappresentante vede quelli del suo GdL. */
export type ReservedMeeting = Meeting & { membersCanSee: boolean }

export type ReservedProject = {
  id: string
  groupId: string
  title: string
  stage: WorkStage
  lastNews: string
  nextStep: string
  dueOn: CalendarDate | null
  /** Lo scrive il motore alla risposta valida del Modulo. */
  updatedOn: CalendarDate | null
  /** Vuoto se il cantiere non chiede aiuto. */
  helpWanted: string
  /** Il Modulo con gruppo, cantiere e codice del gruppo già scritti. */
  updateUrl: string | null
}

export type ReservedPerson = {
  fingerprint: string
  memberNumber: string | null
  roles: Role[]
  /** Il GdL, se rappresentante. */
  groupId: string | null
}

/**
 * Entra chi sta in «Persone della Riservata» con almeno un ruolo: Direttivo, Coordinamento (i rappresentanti),
 * segreteria, chi cura la Bussola. Sta qui perché la usano la vetrina e il seed dell'anteprima.
 */
export const canEnter = (person: ReservedPerson | null) => (person?.roles.length ?? 0) > 0

export type ReservedResolution = {
  date: CalendarDate
  /** L'organo: Direttivo, Coordinamento, Assemblea. */
  body: string
  subject: string
  /** Il verbale nel Drive; null se non c'è ancora. */
  minutesUrl: string | null
  ratifiedOn: CalendarDate | null
}

export type ReservedIssue = {
  what: string
  since: CalendarDate | null
  /** Il ruolo di chi la segue; vuoto se nessuno. */
  ownerRole: string
}

export type BudgetLine = {
  /** Il cantiere o l'impegno. */
  label: string
  /** In euro; null se il tesoriere non l'ha scritto. */
  planned: number | null
  spent: number | null
}

export type ReservedBudget = {
  /** L'ultima data in cui il tesoriere l'ha aggiornato. */
  updatedOn: CalendarDate | null
  /** Vuoto finché il tesoriere non ha inserito i numeri. */
  lines: BudgetLine[]
}

export type ReservedSnapshot = {
  version: 1
  /** ISO 8601, in UTC: quando il contenuto è cambiato l'ultima volta. */
  publishedAt: string
  staleDays: number
  groups: ReservedGroup[]
  projects: ReservedProject[]
  people: ReservedPerson[]
  /** Le scadenze aperte, e le fatte con la data nell'anno di oggi (per O7). */
  deadlines: Deadline[]
  /** Le delibere degli ultimi 12 mesi, dalla più recente. */
  resolutions: ReservedResolution[]
  /** Le questioni aperte. */
  issues: ReservedIssue[]
  budget: ReservedBudget
  /** Gli incontri dei prossimi 60 giorni (da T7). */
  meetings: ReservedMeeting[]
  /** Da T6: gli impegni dell'anno, e quelli degli anni prima non ancora chiusi. */
  commitments: ReservedCommitment[]
  /** Il Modulo «Proponi un impegno»; null finché non è collegato. */
  commitmentFormUrl: string | null
}

const FORMS_PREFIX = 'https://docs.google.com/forms/'

type Fields = Record<string, unknown>
const isObject = (value: unknown): value is Fields => typeof value === 'object' && value !== null
const isText = (value: unknown): value is string => typeof value === 'string'
const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const formUrl = (value: unknown) => (isText(value) && value.startsWith(FORMS_PREFIX) ? value : null)
const dateOrNull = (value: unknown) => (isCalendarDate(value) ? value : null)
const amount = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

function parseGroup(value: unknown): ReservedGroup | null {
  if (!isObject(value) || !isId(value.id) || !isText(value.name)) return null
  return {
    id: value.id,
    name: value.name,
    newProjectUrl: formUrl(value.newProjectUrl),
    newMeetingUrl: formUrl(value.newMeetingUrl),
  }
}

function parseMeeting(value: unknown): ReservedMeeting | null {
  if (!isObject(value) || !isId(value.groupId) || !isLocalDateTime(value.startsAt) || !isMeetUrl(value.meetUrl))
    return null
  if (typeof value.membersCanSee !== 'boolean') return null
  return {
    groupId: value.groupId,
    startsAt: value.startsAt,
    meetUrl: value.meetUrl,
    membersCanSee: value.membersCanSee,
  }
}

function parseProject(value: unknown): ReservedProject | null {
  if (!isObject(value) || !isId(value.id) || !isId(value.groupId) || !isText(value.title)) return null
  if (!isStage(value.stage) || value.stage === 'closed') return null
  const { lastNews, nextStep, helpWanted } = value
  if (!isText(lastNews) || !isText(nextStep) || !isText(helpWanted)) return null
  return {
    id: value.id,
    groupId: value.groupId,
    title: value.title,
    stage: value.stage,
    lastNews,
    nextStep,
    dueOn: dateOrNull(value.dueOn),
    updatedOn: dateOrNull(value.updatedOn),
    helpWanted,
    updateUrl: formUrl(value.updateUrl),
  }
}

function parsePerson(value: unknown): ReservedPerson | null {
  if (!isObject(value) || !isFingerprint(value.fingerprint) || !Array.isArray(value.roles)) return null
  return {
    fingerprint: value.fingerprint,
    memberNumber: isId(value.memberNumber) ? value.memberNumber : null,
    roles: value.roles.filter((role): role is Role => ROLES.includes(role as Role)),
    groupId: isId(value.groupId) ? value.groupId : null,
  }
}

/** Le delibere degli ultimi 12 mesi, da oggi a un anno fa compreso, dalla più recente. */
export function recentResolutions<T extends { date: CalendarDate }>(
  resolutions: readonly T[],
  today: CalendarDate,
): T[] {
  const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`
  return resolutions
    .filter((resolution) => resolution.date >= yearAgo)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

function parseDeadline(value: unknown): Deadline | null {
  if (!isObject(value) || !isId(value.id) || !isText(value.what) || !isDeadlineKind(value.kind)) return null
  if (!isCalendarDate(value.dueOn) || !isText(value.ownerRole)) return null
  return {
    id: value.id,
    what: value.what,
    kind: value.kind,
    dueOn: value.dueOn,
    ownerRole: value.ownerRole,
    doneOn: dateOrNull(value.doneOn),
  }
}

function parseResolution(value: unknown): ReservedResolution | null {
  if (!isObject(value) || !isCalendarDate(value.date) || !isText(value.body) || !isText(value.subject)) return null
  return {
    date: value.date,
    body: value.body,
    subject: value.subject,
    minutesUrl: isDriveUrl(value.minutesUrl) ? value.minutesUrl : null,
    ratifiedOn: dateOrNull(value.ratifiedOn),
  }
}

function parseIssue(value: unknown): ReservedIssue | null {
  if (!isObject(value) || !isText(value.what) || !isText(value.ownerRole)) return null
  return { what: value.what, since: dateOrNull(value.since), ownerRole: value.ownerRole }
}

function parseBudgetLine(value: unknown): BudgetLine | null {
  if (!isObject(value) || !isText(value.label)) return null
  return { label: value.label, planned: amount(value.planned), spent: amount(value.spent) }
}

function parseList<T>(value: unknown, parse: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null
  return value.map(parse).filter((item): item is T => item !== null)
}

/** Le sezioni di T2, T7 e T6: un'istantanea di prima, che non le ha, si legge con le sezioni vuote. */
const parseSection = <T>(value: unknown, parse: (item: unknown) => T | null) =>
  value === undefined ? [] : parseList(value, parse)

function parseBudget(value: unknown): ReservedBudget | null {
  if (value === undefined) return { updatedOn: null, lines: [] }
  if (!isObject(value)) return null
  const lines = parseList(value.lines, parseBudgetLine)
  return lines && { updatedOn: dateOrNull(value.updatedOn), lines }
}

export function parseReservedSnapshot(value: unknown): ReservedSnapshot | null {
  if (!isObject(value) || value.version !== 1) return null
  const { publishedAt, staleDays } = value
  if (!isText(publishedAt) || Number.isNaN(Date.parse(publishedAt))) return null
  if (typeof staleDays !== 'number' || !Number.isInteger(staleDays) || staleDays < 1) return null
  const groups = parseList(value.groups, parseGroup)
  const projects = parseList(value.projects, parseProject)
  const people = parseList(value.people, parsePerson)
  const deadlines = parseSection(value.deadlines, parseDeadline)
  const resolutions = parseSection(value.resolutions, parseResolution)
  const issues = parseSection(value.issues, parseIssue)
  const budget = parseBudget(value.budget)
  const meetings = parseSection(value.meetings, parseMeeting)
  const commitments = parseSection(value.commitments, parseReservedCommitment)
  if (!groups || !projects || !people || !deadlines || !resolutions || !issues || !budget || !meetings || !commitments)
    return null
  return {
    version: 1,
    publishedAt,
    staleDays,
    groups,
    projects,
    people,
    deadlines,
    resolutions,
    issues,
    budget,
    meetings,
    commitments,
    commitmentFormUrl: formUrl(value.commitmentFormUrl),
  }
}
