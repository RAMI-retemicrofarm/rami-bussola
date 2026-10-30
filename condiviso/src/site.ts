// L'istantanea del sito (`v1/sito.json`): ciò che si può mostrare a ogni socio. I GdL coi referenti (il nome solo
// col consenso), gli incontri visibili ai soci dei prossimi 60 giorni, i link con chi li può aprire, le scadenze
// visibili ai soci e i passi del primo giorno; da T6 gli impegni ratificati, senza nomi. Niente mail, niente telefoni, niente nomi senza consenso: lo controlla
// la lista ammessa del motore, e qui la vetrina rilegge la forma di ciò che arriva da KV.
import { parseSiteCommitment, type SiteCommitment } from './commitments.ts'
import { isDeadlineKind, type DeadlineKind } from './deadlines.ts'
import { daysBetween, isCalendarDate, type CalendarDate } from './projects.ts'

export const SITE_KEY = 'v1/sito.json'

/** Il nome c'è solo se il referente ha dato il consenso; il ruolo c'è sempre. */
export type Referent = { name: string | null; role: string }

export type SiteGroup = {
  id: string
  name: string
  mission: string
  howToJoin: string
  whereWhen: string
  /** La chat del gruppo, solo se è aperta ai soci; altrimenti si passa dalla segreteria. */
  chatUrl: string | null
  referents: Referent[]
}

/** Giorno e ora di Roma, «AAAA-MM-GGTHH:MM». */
export type LocalDateTime = string

/** Gli incontri del Coordinamento: nella colonna «GdL» di «Incontri» vale anche questa parola, che non è un GdL. */
export const COORDINATION_ID = 'Coordinamento'

export type Meeting = { groupId: string; startsAt: LocalDateTime; meetUrl: string }

/** Chi può aprire un link: chiunque, i soci, i soli partecipanti di un GdL, il solo Coordinamento. */
export const LINK_AUDIENCES = ['all', 'members', 'group', 'coordination'] as const
export type LinkAudience = (typeof LINK_AUDIENCES)[number]

export type SiteLink = { title: string; url: string; audience: LinkAudience; groupId: string | null }

export type SiteDeadline = { id: string; what: string; kind: DeadlineKind; dueOn: CalendarDate }

export type FirstDayStep = { title: string; text: string; url: string | null }

export type SiteSnapshot = {
  version: 1
  publishedAt: string
  /** Dove si scrive alla segreteria, quando la chat del gruppo non è aperta ai soci. */
  officeUrl: string | null
  groups: SiteGroup[]
  meetings: Meeting[]
  links: SiteLink[]
  deadlines: SiteDeadline[]
  firstDay: FirstDayStep[]
  /** Da T6: solo i ratificati; chi l'ha preso è un numero socio, e la cifra c'è solo se «si vede ai soci». */
  commitments: SiteCommitment[]
}

/** Gli incontri dei prossimi 60 giorni. */
export const MEETING_WINDOW_DAYS = 60
/** Le scadenze dei soci dei prossimi 90 giorni. */
export const SITE_DEADLINE_DAYS = 90
/** Un incontro resta «il prossimo» fino a un'ora dopo l'inizio: chi arriva in ritardo trova ancora il link. */
export const MEETING_GRACE_MINUTES = 60

/**
 * Le chiocciole che non sono una mail: il calendario Google di un gruppo (`…@group.calendar.google.com`, anche scritto
 * `%40`) e i profili nel percorso (`/@rami`).
 */
const HARMLESS_AT = /(?:@|%40)group\.calendar\.google\.com|\/@[\w.-]+/gi

/**
 * Un link che si apre da un telefono: https, senza mail né numeri di telefono dentro. Una chiocciola, anche scritta
 * `%40`, vuol dire una mail, salvo quelle di HARMLESS_AT; il nome utente prima dell'host non passa mai.
 */
export const isLinkUrl = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^https:\/\/[^\s@/?#]+(?:[/?#]\S*)?$/.test(value) &&
  !/@|%40/i.test(value.replace(HARMLESS_AT, '')) &&
  !/^https:\/\/(?:wa\.me|api\.whatsapp\.com\/send)/i.test(value) &&
  !/[?&]phone=/i.test(value)

export const isMeetUrl = (value: unknown): value is string =>
  isLinkUrl(value) && /^https:\/\/meet\.google\.com\/[\w-]+(?:\?[^\s@]*)?$/.test(value)

export const isLocalDateTime = (value: unknown): value is LocalDateTime => {
  if (typeof value !== 'string') return false
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value)
  return !!match && isCalendarDate(match[1]) && Number(match[2]) < 24 && Number(match[3]) < 60
}

/** Somma i minuti sul calendario, senza fusi: le ore di Roma si confrontano fra loro. */
export function addMinutes(at: LocalDateTime, minutes: number): LocalDateTime {
  return new Date(Date.parse(`${at}:00Z`) + minutes * 60_000).toISOString().slice(0, 16)
}

// Si crea alla prima chiamata, come romeDate: il motore ha `Utilities.formatDate`.
let romeTimeFormat: Intl.DateTimeFormat | undefined

export function romeDateTime(instant: Date): LocalDateTime {
  romeTimeFormat ??= new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const part = (type: string) => romeTimeFormat?.formatToParts(instant).find((item) => item.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`
}

/** Il primo incontro non ancora finito, di tutti o di un gruppo. */
export function nextMeeting<T extends Meeting>(meetings: readonly T[], now: LocalDateTime, groupId?: string): T | null {
  const from = addMinutes(now, -MEETING_GRACE_MINUTES)
  return (
    meetings
      .filter((meeting) => meeting.startsAt >= from && (groupId === undefined || meeting.groupId === groupId))
      .sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0))[0] ?? null
  )
}

/** Le scadenze dei soci da oggi a 90 giorni compresi, dalla più vicina. */
export function upcomingDeadlines<T extends { id: string; dueOn: CalendarDate }>(
  deadlines: readonly T[],
  today: CalendarDate,
): T[] {
  return deadlines
    .filter((deadline) => {
      const days = daysBetween(today, deadline.dueOn)
      return days >= 0 && days <= SITE_DEADLINE_DAYS
    })
    .sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : a.id < b.id ? -1 : 1))
}

type Fields = Record<string, unknown>
const isObject = (value: unknown): value is Fields => typeof value === 'object' && value !== null
const isText = (value: unknown): value is string => typeof value === 'string'
const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const linkOrNull = (value: unknown) => (isLinkUrl(value) ? value : null)

function parseReferent(value: unknown): Referent | null {
  if (!isObject(value) || !isText(value.role)) return null
  return { name: isId(value.name) ? value.name : null, role: value.role }
}

function parseList<T>(value: unknown, parse: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null
  return value.map(parse).filter((item): item is T => item !== null)
}

function parseGroup(value: unknown): SiteGroup | null {
  if (!isObject(value) || !isId(value.id) || !isText(value.name)) return null
  const { mission, howToJoin, whereWhen } = value
  if (!isText(mission) || !isText(howToJoin) || !isText(whereWhen)) return null
  const referents = parseList(value.referents, parseReferent)
  if (!referents) return null
  return {
    id: value.id,
    name: value.name,
    mission,
    howToJoin,
    whereWhen,
    chatUrl: linkOrNull(value.chatUrl),
    referents,
  }
}

function parseMeeting(value: unknown): Meeting | null {
  if (!isObject(value) || !isId(value.groupId) || !isLocalDateTime(value.startsAt) || !isMeetUrl(value.meetUrl))
    return null
  return { groupId: value.groupId, startsAt: value.startsAt, meetUrl: value.meetUrl }
}

function parseLink(value: unknown): SiteLink | null {
  if (!isObject(value) || !isText(value.title) || !isLinkUrl(value.url)) return null
  if (!LINK_AUDIENCES.includes(value.audience as LinkAudience)) return null
  const audience = value.audience as LinkAudience
  const groupId = isId(value.groupId) ? value.groupId : null
  if (audience === 'group' && !groupId) return null
  return { title: value.title, url: value.url, audience, groupId }
}

function parseDeadline(value: unknown): SiteDeadline | null {
  if (!isObject(value) || !isId(value.id) || !isText(value.what) || !isDeadlineKind(value.kind)) return null
  if (!isCalendarDate(value.dueOn)) return null
  return { id: value.id, what: value.what, kind: value.kind, dueOn: value.dueOn }
}

function parseStep(value: unknown): FirstDayStep | null {
  if (!isObject(value) || !isText(value.title) || !isText(value.text)) return null
  return { title: value.title, text: value.text, url: linkOrNull(value.url) }
}

export function parseSiteSnapshot(value: unknown): SiteSnapshot | null {
  if (!isObject(value) || value.version !== 1) return null
  const { publishedAt } = value
  if (!isText(publishedAt) || Number.isNaN(Date.parse(publishedAt))) return null
  const groups = parseList(value.groups, parseGroup)
  const meetings = parseList(value.meetings, parseMeeting)
  const links = parseList(value.links, parseLink)
  const deadlines = parseList(value.deadlines, parseDeadline)
  const firstDay = parseList(value.firstDay, parseStep)
  // Un'istantanea di prima di T6 non ha gli impegni: si legge senza.
  const commitments = value.commitments === undefined ? [] : parseList(value.commitments, parseSiteCommitment)
  if (!groups || !meetings || !links || !deadlines || !firstDay || !commitments) return null
  return {
    version: 1,
    publishedAt,
    officeUrl: linkOrNull(value.officeUrl),
    groups,
    meetings,
    links,
    deadlines,
    firstDay,
    commitments,
  }
}
