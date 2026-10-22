// Le istantanee: ciò che dai Fogli va su Cloudflare, senza anagrafica (cartamodello, «Modello dei dati»). Per ora c'è
// l'istantanea riservata. Ogni istantanea ha la sua lista ammessa: un campo fuori lista, una mail o un telefono in un
// testo fermano la pubblicazione. Funzioni pure, provate in Node.
import {
  isDriveUrl,
  lateDutiesYears,
  normalizeEmail,
  recentResolutions,
  type CalendarDate,
  type Deadline,
  type ReservedBudget,
  type ReservedIssue,
  type ReservedResolution,
  type ReservedSnapshot,
  type WorkStage,
} from '@bussola/condiviso'
import type { GroupRow, PersonRow, ProjectRow, Settings } from './content.ts'
import { prefilledUrl, projectLabel, type PrefillLinks } from './form.ts'

export type ReservedContent = Omit<ReservedSnapshot, 'publishedAt'>

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
  /** Per l'anno delle scadenze fatte e i 12 mesi delle delibere. La finestra dei 30 giorni la fa la pagina. */
  today: CalendarDate
}): ReservedContent {
  const { prefill, today } = input
  const groups = new Map(input.groups.map((group) => [group.id, group]))
  const link = (values: Parameters<typeof prefilledUrl>[1]) => (prefill ? prefilledUrl(prefill, values) : null)

  return {
    version: 1,
    staleDays: input.settings.staleDays,
    groups: [...groups.values()].sort(byKey((group) => group.id)).map((group) => ({
      id: group.id,
      name: group.name,
      newProjectUrl: link({ group: group.name, code: group.formKey }),
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
  }
}

/**
 * La forma ammessa di un'istantanea. `text` è un testo libero, che non può contenere mail né telefoni; `id` è un
 * identificativo, un numero socio, un ruolo o un tipo; `url` è un link ai Moduli di Google; `driveUrl` un link al
 * Drive o ai Documenti di Google, come i verbali.
 */
export type Shape =
  | 'text'
  | 'id'
  | 'number'
  | 'date'
  | 'instant'
  | 'url'
  | 'driveUrl'
  | 'fingerprint'
  | readonly [Shape]
  | { readonly [key: string]: Shape }

/**
 * La lista ammessa dell'istantanea riservata: nome e ruolo dei referenti col consenso (da T7), ruoli, numeri soci,
 * conteggi, i codici dei gruppi (dentro i link) e le impronte delle mail della Riservata. Da T2 anche le scadenze, le
 * delibere coi link ai verbali nel Drive, le questioni aperte e il budget; chi le segue c'è solo come ruolo, mai il
 * nome.
 */
export const RESERVED_SHAPE: Shape = {
  version: 'number',
  publishedAt: 'instant',
  staleDays: 'number',
  groups: [{ id: 'id', name: 'text', newProjectUrl: 'url' }],
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
