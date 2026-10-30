// Le istantanee: ciò che dai Fogli va su Cloudflare, senza anagrafica (cartamodello, «Modello dei dati»): quella
// riservata, per pages.dev, e da T7 quella del sito, che si può mostrare a ogni socio. Ogni istantanea ha la sua lista
// ammessa: un campo fuori lista, una mail o un telefono in un testo fermano la pubblicazione. Funzioni pure, provate
// in Node.
import {
  daysBetween,
  isPublicStatus,
  isDriveUrl,
  isLinkUrl,
  isLocalDateTime,
  isMeetUrl,
  lateDutiesYears,
  MEETING_WINDOW_DAYS,
  normalizeEmail,
  recentResolutions,
  type CalendarDate,
  type Deadline,
  type ReservedBudget,
  type ReservedCommitment,
  type ReservedIssue,
  type ReservedResolution,
  type ReservedSnapshot,
  type SiteCommitment,
  type SiteSnapshot,
  type WorkStage,
} from '@bussola/condiviso'
import { commitmentBudget, type CommitmentRow } from './commitments.ts'
import type {
  DeadlineRow,
  FirstDayRow,
  GroupRow,
  LinkRow,
  MeetingRow,
  PersonRow,
  ProjectRow,
  ReferentRow,
  Settings,
} from './content.ts'
import { prefilledUrl, projectLabel, type PrefillLinks } from './form.ts'

export type ReservedContent = Omit<ReservedSnapshot, 'publishedAt'>
export type SiteContent = Omit<SiteSnapshot, 'publishedAt'>

/** Le schede del Foglio contenuti, già lette (content.ts), e i link precompilati dei Moduli. */
export type SnapshotSheets = {
  groups: GroupRow[]
  projects: ProjectRow[]
  people: PersonRow[]
  settings: Settings
  prefill: PrefillLinks | null
  meetingPrefill: PrefillLinks<'group' | 'code'> | null
  /** SHA-256 in esadecimale della mail normalizzata. */
  fingerprint: (email: string) => string
  deadlines: DeadlineRow[]
  resolutions: ReservedResolution[]
  issues: ReservedIssue[]
  budget: ReservedBudget
  referents: ReferentRow[]
  meetings: MeetingRow[]
  links: LinkRow[]
  firstDay: FirstDayRow[]
  /** Da T6: la scheda «Impegni» letta, e il link del Modulo «Proponi un impegno». */
  commitments: CommitmentRow[]
  commitmentFormUrl: string | null
}

/** Le due istantanee dalle stesse schede, lo stesso giorno. */
export function buildSnapshots(
  sheets: SnapshotSheets,
  today: CalendarDate,
): { reserved: ReservedContent; site: SiteContent } {
  return { reserved: buildReservedSnapshot({ ...sheets, today }), site: buildSiteSnapshot({ ...sheets, today }) }
}

/** Gli incontri da oggi a 60 giorni compresi, per ora d'inizio: l'ora la guarda la pagina. */
function meetingsAhead(meetings: readonly MeetingRow[], today: CalendarDate): MeetingRow[] {
  return meetings
    .filter((meeting) => {
      const days = daysBetween(today, meeting.startsAt.slice(0, 10))
      return days >= 0 && days <= MEETING_WINDOW_DAYS
    })
    .sort(byKey((meeting) => `${meeting.startsAt} ${meeting.groupId} ${meeting.meetUrl}`))
}

/**
 * Sul sito un impegno esce solo ratificato, con la data, e aperto, preso, in corso o consegnato: il cartamodello vuole
 * «gli impegni aperti e presi», e i chiusi restano nella Riservata. Chi l'ha preso c'è come numero socio, che serve
 * alla Function per i suoi tasti, e come GdL o ruolo, mai col nome; la cifra del compenso solo se «si vede ai soci».
 */
function siteCommitments(commitments: readonly CommitmentRow[]): SiteCommitment[] {
  return commitments
    .filter((commitment) => commitment.ratifiedOn !== null && isPublicStatus(commitment.status))
    .sort(byKey((commitment) => commitment.id))
    .map((commitment) => ({
      id: commitment.id,
      title: commitment.title,
      what: commitment.what,
      forLabel: commitment.forLabel,
      groupId: commitment.groupId,
      status: commitment.status,
      days: commitment.days,
      until: commitment.until,
      term: commitment.term,
      pay: commitment.pay,
      fee: commitment.feeVisible ? commitment.fee : null,
      assigneeNumber: commitment.status === 'open' ? null : commitment.assigneeNumber,
      assigneeRole: commitment.assigneeRole,
    }))
}

/**
 * Nella Riservata la scheda intera, coi numeri del budget: gli impegni dell'anno di oggi, che contano per O10, e
 * quelli degli anni prima ancora aperti.
 */
function reservedCommitments(
  commitments: readonly CommitmentRow[],
  budget: ReservedBudget,
  today: CalendarDate,
): ReservedCommitment[] {
  const year = Number(today.slice(0, 4))
  return commitments
    .filter(
      (commitment) => commitment.year === year || (commitment.status !== 'closed' && commitment.status !== 'rejected'),
    )
    .sort(byKey((commitment) => commitment.id))
    .map((commitment) => ({
      id: commitment.id,
      year: commitment.year,
      title: commitment.title,
      status: commitment.status,
      outcome: commitment.outcome,
      rejectionReason: commitment.rejectionReason,
      what: commitment.what,
      forLabel: commitment.forLabel,
      groupId: commitment.groupId,
      days: commitment.days,
      until: commitment.until,
      term: commitment.term,
      deliverables: commitment.deliverables,
      verifierNumber: commitment.verifierNumber,
      pay: commitment.pay,
      fee: commitment.fee,
      feeVisible: commitment.feeVisible,
      proposedBy: commitment.proposedBy,
      proposedOn: commitment.proposedOn,
      coordinationOn: commitment.coordinationOn,
      ratifiedOn: commitment.ratifiedOn,
      howToLeave: commitment.howToLeave,
      howToRevoke: commitment.howToRevoke,
      assigneeNumber: commitment.assigneeNumber,
      assigneeRole: commitment.assigneeRole,
      substituteNumber: commitment.substituteNumber,
      ...commitmentBudget(commitment, budget.lines),
    }))
}

/**
 * L'istantanea del sito. Il nome di un referente esce solo col consenso, dalla data in «consenso dal» in poi; tolto
 * il consenso, il giro dopo lo toglie. Gli incontri e le scadenze escono solo se «visibile ai soci»; gli impegni solo
 * ratificati.
 */
export function buildSiteSnapshot(input: {
  groups: GroupRow[]
  settings: Settings
  deadlines: DeadlineRow[]
  referents: ReferentRow[]
  meetings: MeetingRow[]
  links: LinkRow[]
  firstDay: FirstDayRow[]
  /** Da T6; senza, nessun impegno. */
  commitments?: CommitmentRow[]
  today: CalendarDate
}): SiteContent {
  const { today } = input
  return {
    version: 1,
    officeUrl: input.settings.officeUrl,
    groups: [...input.groups]
      .sort((a, b) => a.name.localeCompare(b.name, 'it') || (a.id < b.id ? -1 : 1))
      .map((group) => ({
        id: group.id,
        name: group.name,
        mission: group.mission,
        howToJoin: group.howToJoin,
        whereWhen: group.whereWhen,
        chatUrl: group.chatUrl,
        referents: input.referents
          .filter((referent) => referent.groupId === group.id)
          .map((referent) => ({
            name: referent.consentSince !== null && referent.consentSince <= today ? referent.name || null : null,
            role: referent.role,
          })),
      })),
    meetings: meetingsAhead(input.meetings, today)
      .filter((meeting) => meeting.membersCanSee)
      .map((meeting) => ({ groupId: meeting.groupId, startsAt: meeting.startsAt, meetUrl: meeting.meetUrl })),
    links: input.links.map((link) => ({
      title: link.title,
      url: link.url,
      audience: link.audience,
      groupId: link.groupId,
    })),
    deadlines: input.deadlines
      .filter((deadline) => deadline.membersCanSee && deadline.doneOn === null && deadline.dueOn >= today)
      .sort(byKey((deadline) => `${deadline.dueOn} ${deadline.id}`))
      .map((deadline) => ({ id: deadline.id, what: deadline.what, kind: deadline.kind, dueOn: deadline.dueOn })),
    firstDay: input.firstDay.map((step) => ({ title: step.title, text: step.text, url: step.url })),
    commitments: siteCommitments(input.commitments ?? []),
  }
}

const byKey =
  <T>(key: (item: T) => string) =>
  (a: T, b: T) =>
    key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0

export function buildReservedSnapshot(input: {
  groups: GroupRow[]
  projects: ProjectRow[]
  people: PersonRow[]
  settings: Settings
  prefill: PrefillLinks | null
  /** SHA-256 in esadecimale della mail normalizzata. */
  fingerprint: (email: string) => string
  deadlines: Deadline[]
  resolutions: ReservedResolution[]
  /** Solo le aperte. */
  issues: ReservedIssue[]
  budget: ReservedBudget
  /** Da T7: il Modulo «Prossimo incontro» e gli incontri, anche quelli non visibili ai soci. */
  meetingPrefill?: PrefillLinks<'group' | 'code'> | null
  meetings?: MeetingRow[]
  /** Da T6: gli impegni e il Modulo «Proponi un impegno». */
  commitments?: CommitmentRow[]
  commitmentFormUrl?: string | null
  /** Per l'anno delle scadenze fatte e i 12 mesi delle delibere. La finestra dei 30 giorni la fa la pagina. */
  today: CalendarDate
}): ReservedContent {
  const { prefill, meetingPrefill, today } = input
  const groups = new Map(input.groups.map((group) => [group.id, group]))
  const link = (values: Parameters<typeof prefilledUrl>[1]) => (prefill ? prefilledUrl(prefill, values) : null)

  return {
    version: 1,
    staleDays: input.settings.staleDays,
    groups: [...groups.values()].sort(byKey((group) => group.id)).map((group) => ({
      id: group.id,
      name: group.name,
      newProjectUrl: link({ group: group.name, code: group.formKey }),
      newMeetingUrl: meetingPrefill ? prefilledUrl(meetingPrefill, { group: group.name, code: group.formKey }) : null,
    })),
    projects: input.projects
      .filter((project): project is ProjectRow & { stage: WorkStage } => project.stage !== 'closed')
      .sort(byKey((project) => project.id))
      .map((project) => {
        const group = groups.get(project.groupId)
        return {
          id: project.id,
          groupId: project.groupId,
          title: project.title,
          stage: project.stage,
          lastNews: project.lastNews,
          nextStep: project.nextStep,
          dueOn: project.dueOn,
          updatedOn: project.updatedOn,
          helpWanted: project.helpWanted,
          updateUrl: group ? link({ group: group.name, project: projectLabel(project), code: group.formKey }) : null,
        }
      }),
    people: input.people
      .map((person) => ({
        fingerprint: input.fingerprint(normalizeEmail(person.email)),
        memberNumber: person.memberNumber,
        roles: person.roles,
        groupId: person.groupId,
      }))
      .sort(byKey((person) => person.fingerprint)),
    // Le fatte restano per gli anni di O7, quello di oggi e a gennaio quello prima: «Adempimenti fatti in ritardo».
    deadlines: input.deadlines
      .filter((deadline) => deadline.doneOn === null || lateDutiesYears(today).includes(deadline.dueOn.slice(0, 4)))
      .sort(byKey((deadline) => `${deadline.dueOn} ${deadline.id}`))
      .map((deadline) => ({
        id: deadline.id,
        what: deadline.what,
        kind: deadline.kind,
        dueOn: deadline.dueOn,
        ownerRole: deadline.ownerRole,
        doneOn: deadline.doneOn,
      })),
    // A parità di data decide l'oggetto, così l'ordine delle righe nel Foglio non cambia l'istantanea.
    resolutions: recentResolutions([...input.resolutions].sort(byKey((resolution) => resolution.subject)), today).map(
      (resolution) => ({
        date: resolution.date,
        body: resolution.body,
        subject: resolution.subject,
        minutesUrl: resolution.minutesUrl,
        ratifiedOn: resolution.ratifiedOn,
      }),
    ),
    // Dalla più vecchia; quelle senza data in fondo («~» viene dopo le cifre).
    issues: [...input.issues]
      .sort(byKey((issue) => `${issue.since ?? '~'} ${issue.what}`))
      .map((issue) => ({ what: issue.what, since: issue.since, ownerRole: issue.ownerRole })),
    budget: {
      updatedOn: input.budget.updatedOn,
      lines: input.budget.lines.map((line) => ({ label: line.label, planned: line.planned, spent: line.spent })),
    },
    meetings: meetingsAhead(input.meetings ?? [], today).map((meeting) => ({
      groupId: meeting.groupId,
      startsAt: meeting.startsAt,
      meetUrl: meeting.meetUrl,
      membersCanSee: meeting.membersCanSee,
    })),
    commitments: reservedCommitments(input.commitments ?? [], input.budget, today),
    commitmentFormUrl: input.commitmentFormUrl ?? null,
  }
}

/**
 * La forma ammessa di un'istantanea. `text` è un testo libero, che non può contenere mail né telefoni; `id` è un
 * identificativo, un numero socio, un ruolo o un tipo; `url` è un link ai Moduli di Google; `driveUrl` un link al
 * Drive o ai Documenti di Google, come i verbali; `link` un link https senza mail né telefoni; `meetUrl` un link di
 * Meet; `localTime` giorno e ora di Roma.
 */
export type Shape =
  | 'text'
  | 'id'
  | 'number'
  | 'boolean'
  | 'date'
  | 'localTime'
  | 'instant'
  | 'url'
  | 'driveUrl'
  | 'link'
  | 'meetUrl'
  | 'fingerprint'
  | readonly [Shape]
  | { readonly [key: string]: Shape }

/**
 * La lista ammessa dell'istantanea riservata: nome e ruolo dei referenti col consenso (da T7), ruoli, numeri soci,
 * conteggi, i codici dei gruppi (dentro i link) e le impronte delle mail della Riservata. Da T2 anche le scadenze, le
 * delibere coi link ai verbali nel Drive, le questioni aperte e il budget; chi le segue c'è solo come ruolo, mai il
 * nome. Da T6 gli impegni, con la scheda in sette blocchi: chi verifica, chi propone e chi prende sono numeri soci.
 */
export const RESERVED_SHAPE: Shape = {
  version: 'number',
  publishedAt: 'instant',
  staleDays: 'number',
  groups: [{ id: 'id', name: 'text', newProjectUrl: 'url', newMeetingUrl: 'url' }],
  projects: [
    {
      id: 'id',
      groupId: 'id',
      title: 'text',
      stage: 'id',
      lastNews: 'text',
      nextStep: 'text',
      dueOn: 'date',
      updatedOn: 'date',
      helpWanted: 'text',
      updateUrl: 'url',
    },
  ],
  people: [{ fingerprint: 'fingerprint', memberNumber: 'id', roles: ['id'], groupId: 'id' }],
  deadlines: [{ id: 'id', what: 'text', kind: 'id', dueOn: 'date', ownerRole: 'text', doneOn: 'date' }],
  resolutions: [{ date: 'date', body: 'text', subject: 'text', minutesUrl: 'driveUrl', ratifiedOn: 'date' }],
  issues: [{ what: 'text', since: 'date', ownerRole: 'text' }],
  budget: { updatedOn: 'date', lines: [{ label: 'text', planned: 'number', spent: 'number' }] },
  meetings: [{ groupId: 'id', startsAt: 'localTime', meetUrl: 'meetUrl', membersCanSee: 'boolean' }],
  commitments: [
    {
      id: 'id',
      year: 'number',
      title: 'text',
      status: 'id',
      outcome: 'id',
      rejectionReason: 'text',
      what: 'text',
      forLabel: 'text',
      groupId: 'id',
      days: 'number',
      until: 'date',
      term: 'id',
      deliverables: 'text',
      verifierNumber: 'id',
      pay: 'id',
      fee: 'number',
      feeVisible: 'boolean',
      proposedBy: 'id',
      proposedOn: 'date',
      coordinationOn: 'date',
      ratifiedOn: 'date',
      howToLeave: 'text',
      howToRevoke: 'text',
      assigneeNumber: 'id',
      assigneeRole: 'text',
      substituteNumber: 'id',
      planned: 'number',
      spent: 'number',
    },
  ],
  commitmentFormUrl: 'url',
}

/**
 * La lista ammessa dell'istantanea del sito: nome e ruolo dei referenti col consenso, ruoli, numeri soci e conteggi.
 * Niente mail, niente telefoni, niente nomi senza consenso, niente impronte: quella del nome la fa buildSiteSnapshot,
 * le altre questa forma, che non ha un posto dove metterle.
 */
export const SITE_SHAPE: Shape = {
  version: 'number',
  publishedAt: 'instant',
  officeUrl: 'link',
  groups: [
    {
      id: 'id',
      name: 'text',
      mission: 'text',
      howToJoin: 'text',
      whereWhen: 'text',
      chatUrl: 'link',
      referents: [{ name: 'text', role: 'text' }],
    },
  ],
  meetings: [{ groupId: 'id', startsAt: 'localTime', meetUrl: 'meetUrl' }],
  links: [{ title: 'text', url: 'link', audience: 'id', groupId: 'id' }],
  deadlines: [{ id: 'id', what: 'text', kind: 'id', dueOn: 'date' }],
  firstDay: [{ title: 'text', text: 'text', url: 'link' }],
  // Da T6: niente «feeVisible», niente proposte, niente chi verifica, niente esito (i chiusi non escono): solo ciò che
  // vedono i soci.
  commitments: [
    {
      id: 'id',
      title: 'text',
      what: 'text',
      forLabel: 'text',
      groupId: 'id',
      status: 'id',
      days: 'number',
      until: 'date',
      term: 'id',
      pay: 'id',
      fee: 'number',
      assigneeNumber: 'id',
      assigneeRole: 'text',
    },
  ],
}

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/
/** Date (12/11/2026, 3.11.2026, 2026-10-18, 12/11) e ore (18:30, 9.15): si tolgono prima di cercare un telefono. */
const DATES_AND_TIMES =
  /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\b|\b(?:[01]?\d|2[0-3])[:.][0-5]\d\b/g
/** Nove cifre o più, con al più due fra spazi, punti, trattini, barre e parentesi fra l'una e l'altra: un telefono. */
const PHONE = /\d(?:[\s.\-/()]{0,2}\d){8,}/
const FORMS = 'https://docs.google.com/forms/'

function leafProblem(value: string | number | boolean, shape: Shape): string | null {
  switch (shape) {
    case 'text':
      if (typeof value !== 'string') return 'non è un testo'
      if (EMAIL.test(value)) return 'c’è una mail'
      if (PHONE.test(value.replace(DATES_AND_TIMES, ' # '))) return 'c’è un numero di telefono'
      return null
    case 'id':
      return typeof value === 'string' && !EMAIL.test(value) ? null : 'non è un identificativo'
    case 'number':
      return typeof value === 'number' ? null : 'non è un numero'
    case 'boolean':
      return typeof value === 'boolean' ? null : 'non è un sì o un no'
    case 'localTime':
      return isLocalDateTime(value) ? null : 'non è un giorno con l’ora'
    case 'link':
      return isLinkUrl(value) ? null : 'non è un link https senza mail né telefoni'
    case 'meetUrl':
      return isMeetUrl(value) ? null : 'non è un link di Meet'
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? null : 'non è una data'
    case 'instant':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? null : 'non è un’ora'
    case 'url':
      return typeof value === 'string' && value.startsWith(FORMS) ? null : 'non è un link ai Moduli'
    case 'driveUrl':
      return isDriveUrl(value) ? null : 'non è un link al Drive'
    case 'fingerprint':
      return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? null : 'non è un’impronta'
    default:
      return 'non è un valore semplice'
  }
}

/** Scorre l'istantanea e dice ogni campo fuori dalla lista ammessa, col suo percorso. Vuoto se è tutto in regola. */
export function findViolations(value: unknown, shape: Shape = RESERVED_SHAPE, path = ''): string[] {
  if (value === null) return []
  const at = (key: string) => (path ? `${path}.${key}` : key)
  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) return [`${path}: non è un elenco`]
    // Nel percorso, il codice della riga quando c'è (CAN-0003), così in Salute si sa quale riga del Foglio guardare.
    return value.flatMap((item: unknown, i) => {
      const id = (item as { id?: unknown } | null)?.id
      return findViolations(item, shape[0] as Shape, `${path}[${typeof id === 'string' && id ? id : i}]`)
    })
  }
  if (typeof shape === 'object') {
    if (typeof value !== 'object' || Array.isArray(value)) return [`${path}: non è una scheda`]
    const fields = shape as { readonly [key: string]: Shape }
    return Object.entries(value).flatMap(([key, item]) => {
      const inner = fields[key]
      return inner ? findViolations(item, inner, at(key)) : [`${at(key)}: campo fuori dalla lista ammessa`]
    })
  }
  if (typeof value === 'object' || value === undefined) return [`${path}: non è un valore semplice`]
  const problem = leafProblem(value as string | number | boolean, shape)
  return problem ? [`${path}: ${problem}`] : []
}
