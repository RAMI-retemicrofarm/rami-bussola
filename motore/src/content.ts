// Il Foglio «Bussola · contenuti» visto dal motore: le schede, le colonne che servono e come si leggono. Il
// Foglio entra come `Workbook`, così si prova in Node con array finti; in Apps Script è SpreadsheetApp (google.ts).
// Le colonne si trovano per nome: chi cura il Foglio può spostarle, non rinominarle.
import {
  isCalendarDate,
  isDriveUrl,
  ROLES,
  type CalendarDate,
  type Deadline,
  type DeadlineKind,
  type ReservedBudget,
  type ReservedIssue,
  type ReservedResolution,
  type Role,
  type Stage,
} from '@bussola/condiviso'

export type Workbook = {
  /** Tutte le righe della scheda, la prima è l'intestazione; null se la scheda non c'è. */
  values(sheet: string): unknown[][] | null
  /** Riga e colonna contano da 0, con l'intestazione nella riga 0. */
  setCell(sheet: string, row: number, column: number, value: unknown): void
  appendRow(sheet: string, values: unknown[]): void
}

export type SheetSpec = { name: string; columns: readonly string[]; required: readonly string[] }

const spec = (name: string, columns: readonly string[], required: readonly string[] = columns): SheetSpec => ({
  name,
  columns,
  required,
})

/**
 * Le schede, nell'ordine in cui le crea la preparazione. `columns` è ciò che crea la preparazione; `required` ciò che
 * il motore legge o scrive. «Misure» la scrive solo chi conta: il motore la crea e non la legge.
 */
export const SHEETS = {
  groups: spec(
    'GdL',
    ['id', 'nome', 'missione', 'come si partecipa', 'dove e quando', 'link della chat', 'codice del gruppo'],
    ['id', 'nome', 'codice del gruppo'],
  ),
  projects: spec(
    'Cantieri',
    [
      'id',
      'GdL',
      'titolo',
      'stato',
      'ultima novità',
      'prossimo passo',
      'scadenza',
      'serve aiuto',
      'referente',
      'aggiornato il',
      'chiuso il',
      'esito',
    ],
    [
      'id',
      'GdL',
      'titolo',
      'stato',
      'ultima novità',
      'prossimo passo',
      'scadenza',
      'serve aiuto',
      'aggiornato il',
      'chiuso il',
    ],
  ),
  updates: spec('Aggiornamenti', [
    'id risposta',
    'ora',
    'gruppo',
    'cantiere',
    'codice del gruppo',
    'chi sei',
    'a che punto è',
    'cosa è successo',
    'prossimo passo',
    'per quando',
    'serve aiuto',
    'esito del controllo',
  ]),
  deadlines: spec(
    'Scadenze',
    ['id', 'cosa', 'tipo', 'data', 'chi segue (ruolo)', 'sostituto', 'fatta il', 'visibile ai soci'],
    ['id', 'cosa', 'tipo', 'data', 'chi segue (ruolo)', 'fatta il'],
  ),
  resolutions: spec(
    'Delibere',
    ['id', 'data', 'organo', 'oggetto', 'link al verbale', 'ratificata il'],
    ['data', 'organo', 'oggetto', 'link al verbale', 'ratificata il'],
  ),
  issues: spec(
    'Questioni',
    ['id', 'cosa', 'da quando', 'chi (ruolo)', 'stato'],
    ['cosa', 'da quando', 'chi (ruolo)', 'stato'],
  ),
  budget: spec('Budget', ['voce', 'previsto', 'speso', 'aggiornato il']),
  people: spec(
    'Persone della Riservata',
    ['id', 'mail', 'numero socio', 'ruoli', 'GdL'],
    ['mail', 'numero socio', 'ruoli', 'GdL'],
  ),
  measures: spec('Misure', ['obiettivo', 'quando', 'prima', 'dopo', 'variazione', 'chi conta', 'nota'], []),
  settings: spec('Impostazioni', ['voce', 'valore']),
  health: spec('Salute', ['pezzo', 'stato', 'ultimo controllo', 'ultimo aggiornamento', 'nota']),
} as const

/** Il Foglio non ha la forma che il motore si aspetta: si ferma tutto, e lo si dice in «Salute». */
export class ContentError extends Error {}

export type TableRow = { index: number; get(column: string): unknown }
export type Table = { spec: SheetSpec; header: Map<string, number>; rows: TableRow[] }

const normalize = (name: string) => name.trim().toLowerCase()
const isBlank = (value: unknown) => value === '' || value === null || value === undefined

export function readTable(workbook: Workbook, sheet: SheetSpec): Table {
  const values = workbook.values(sheet.name)
  if (!values) throw new ContentError(`Manca la scheda «${sheet.name}».`)
  const header = new Map<string, number>()
  ;(values[0] ?? []).forEach((name, column) => {
    if (typeof name === 'string' && name.trim() && !header.has(normalize(name))) header.set(normalize(name), column)
  })
  for (const column of sheet.required)
    if (!header.has(normalize(column))) throw new ContentError(`«${sheet.name}»: manca la colonna «${column}».`)
  const rows: TableRow[] = []
  values.slice(1).forEach((cells, i) => {
    if (cells.every(isBlank)) return
    rows.push({
      index: i + 1,
      get: (column) => {
        const at = header.get(normalize(column))
        return at === undefined ? '' : cells[at]
      },
    })
  })
  return { spec: sheet, header, rows }
}

/** La colonna per scriverci: le colonne scritte dal motore stanno tutte in `required`. */
export function columnOf(table: Table, column: string): number {
  const at = table.header.get(normalize(column))
  if (at === undefined) throw new ContentError(`«${table.spec.name}»: manca la colonna «${column}».`)
  return at
}

/** Una riga nuova nell'ordine delle colonne della scheda, coi valori dati per nome. */
export function rowValues(table: Table, values: Record<string, unknown>): unknown[] {
  const row: unknown[] = Array.from({ length: Math.max(0, ...table.header.values()) + 1 }, () => '')
  for (const [name, value] of Object.entries(values)) row[columnOf(table, name)] = value
  return row
}

const pad = (value: number) => String(value).padStart(2, '0')

/** Una data in una colonna di testo, perché il Foglio legge così «15/11»: si mostra come la scrive una persona. */
function dateText(date: Date): string {
  const day = `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`
  return date.getHours() || date.getMinutes() ? `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}` : day
}

export const text = (value: unknown): string => {
  if (isBlank(value)) return ''
  if (value instanceof Date) return dateText(value)
  return String(value).trim()
}

export type ToCalendarDate = (instant: Date) => CalendarDate

/** Una data come la dà Google (Date), o scritta a mano: «AAAA-MM-GG» o «GG/MM/AAAA». Undefined se non si legge. */
export function readCalendarDate(value: unknown, toCalendarDate: ToCalendarDate): CalendarDate | null | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : toCalendarDate(value)
  const written = text(value)
  if (!written) return null
  if (isCalendarDate(written)) return written
  const italian = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(written)
  if (italian) {
    const [, day = '', month = '', year = ''] = italian
    const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    if (isCalendarDate(date)) return date
  }
  return undefined
}

const STAGE_WORDS: Record<string, Stage> = {
  avvio: 'start',
  'in corso': 'ongoing',
  'in revisione': 'review',
  'in chiusura': 'closing',
  chiuso: 'closed',
}

export const parseStage = (value: unknown): Stage | null => STAGE_WORDS[normalize(text(value))] ?? null

const STAGE_CELLS = Object.fromEntries(Object.entries(STAGE_WORDS).map(([word, stage]) => [stage, word])) as Record<
  Stage,
  string
>

/** Lo stato come si scrive nel Foglio: «in corso». */
export const stageCell = (stage: Stage): string => STAGE_CELLS[stage]

const ROLE_WORDS: Record<string, Role> = {
  direttivo: 'board',
  rappresentante: 'rep',
  segreteria: 'office',
  'cura della bussola': 'keeper',
}

export type GroupRow = { index: number; id: string; name: string; formKey: string }

export type ProjectRow = {
  index: number
  id: string
  groupId: string
  title: string
  stage: Stage
  lastNews: string
  nextStep: string
  dueOn: CalendarDate | null
  updatedOn: CalendarDate | null
  helpWanted: string
}

export type PersonRow = { email: string; memberNumber: string | null; roles: Role[]; groupId: string | null }

export type Settings = { staleDays: number }

const where = (table: Table, row: TableRow) => `«${table.spec.name}», riga ${row.index + 1}`

export function readGroups(table: Table): GroupRow[] {
  return table.rows
    .map((row) => ({
      index: row.index,
      id: text(row.get('id')),
      name: text(row.get('nome')),
      formKey: text(row.get('codice del gruppo')),
    }))
    .filter((group) => group.id)
}

export function readProjects(table: Table, toCalendarDate: ToCalendarDate, warnings: string[]): ProjectRow[] {
  const projects: ProjectRow[] = []
  const firstRow = new Map<string, number>()
  for (const row of table.rows) {
    const id = text(row.get('id'))
    if (!id) {
      warnings.push(`${where(table, row)}: manca l’id, il cantiere non si pubblica.`)
      continue
    }
    const first = firstRow.get(id)
    if (first !== undefined) {
      warnings.push(`${where(table, row)}: l’id ${id} c’è già alla riga ${first + 1}, il cantiere non si pubblica.`)
      continue
    }
    firstRow.set(id, row.index)
    const stage = parseStage(row.get('stato'))
    if (!stage) {
      warnings.push(
        `${where(table, row)}: lo stato «${text(row.get('stato'))}» non lo conosco, il cantiere non si pubblica.`,
      )
      continue
    }
    const date = (column: string) => {
      const value = readCalendarDate(row.get(column), toCalendarDate)
      if (value !== undefined) return value
      warnings.push(`${where(table, row)}: la data «${text(row.get(column))}» in «${column}» non la leggo.`)
      return null
    }
    projects.push({
      index: row.index,
      id,
      groupId: text(row.get('GdL')),
      title: text(row.get('titolo')),
      stage,
      lastNews: text(row.get('ultima novità')),
      nextStep: text(row.get('prossimo passo')),
      dueOn: date('scadenza'),
      updatedOn: date('aggiornato il'),
      helpWanted: text(row.get('serve aiuto')),
    })
  }
  return projects
}

export function readPeople(table: Table, warnings: string[]): PersonRow[] {
  const people: PersonRow[] = []
  for (const row of table.rows) {
    const email = text(row.get('mail'))
    if (!email) {
      warnings.push(`${where(table, row)}: manca la mail.`)
      continue
    }
    const roles: Role[] = []
    for (const word of text(row.get('ruoli')).split(/[,;·]/)) {
      if (!word.trim()) continue
      const role = ROLE_WORDS[normalize(word)]
      if (role && ROLES.includes(role)) roles.push(role)
      else warnings.push(`${where(table, row)}: il ruolo «${word.trim()}» non lo conosco.`)
    }
    const memberNumber = text(row.get('numero socio'))
    const groupId = text(row.get('GdL'))
    people.push({
      email,
      memberNumber: memberNumber || null,
      roles,
      groupId: roles.includes('rep') && groupId ? groupId : null,
    })
  }
  return people
}

/** Un ruolo comincia con un articolo o un determinante: «il tesoriere», «una persona di Struttura», «chi cura…». */
const ROLE_START = /^(?:(?:il|lo|la|i|gli|le|un|uno|una|chi)\s|(?:l|un)['’])/i

/** Con la maiuscola, in un ruolo, valgono gli organi di RAMI, queste sigle e le parole dei nomi dei gruppi. */
const ROLE_PROPER_WORDS = [
  'Direttivo',
  'Coordinamento',
  'Assemblea',
  'Segreteria',
  'Tesoreria',
  'Struttura',
  'GdL',
  'RAMI',
  'Bussola',
  'Erasmus',
]

/** Dopo queste parole viene il nome di un gruppo: «il gruppo Pubbliche Relazioni», «il GdL Raduno». */
const GROUP_WORDS = ['gruppo', 'GdL']

/** Parentesi, virgole, due punti e chiocciole: di solito portano un nome o una mail dietro al ruolo. */
const ROLE_MARKS = /[()[\]:;,@]/

const words = (value: string) => value.split(/[\s'’]+/).filter(Boolean)

/**
 * Il ruolo di chi segue una scadenza o una questione, mai il nome: la Riservata lo mostra a tutto il Coordinamento.
 * La cella comincia come un ruolo, senza segni che portano un nome, e ogni parola con la maiuscola dopo la prima è
 * un organo, una parola di un gruppo della scheda «Gruppi» o il nome che segue «gruppo». Se no è probabilmente un
 * nome, e non esce: vale come «nessuno», con l'avviso. Un nome scritto tutto in minuscolo passa: il controllo
 * ferma gli errori comuni, non li ferma tutti.
 */
export function readRole(
  value: unknown,
  column: string,
  groupNames: readonly string[] = [],
): { role: string; warning: string | null } {
  const role = text(value)
  const refuse = (why: string) => ({
    role: '',
    warning: `«${column}» dice «${role}»: ${why} Intanto esce come «Nessuno la segue».`,
  })
  if (!role) return { role, warning: null }
  if (!ROLE_START.test(role))
    return refuse('scrivi un ruolo, come «il tesoriere» o «una persona di Struttura», mai un nome.')
  if (ROLE_MARKS.test(role))
    return refuse('un ruolo si scrive senza parentesi, virgole, due punti o chiocciole, come «il tesoriere».')
  const known = new Set([...ROLE_PROPER_WORDS, ...groupNames.flatMap(words)])
  let afterGroupWord = false
  // La prima parola è l'articolo, che può avere la maiuscola: «Il Direttivo».
  for (const word of words(role).slice(1)) {
    const capital = /^\p{Lu}/u.test(word)
    if (capital && !afterGroupWord && !known.has(word))
      return refuse(
        `«${word}» sembra un nome. Con la maiuscola vanno solo gli organi di RAMI, come «il Direttivo», e i gruppi ` +
          'della scheda «Gruppi».',
      )
    afterGroupWord = GROUP_WORDS.includes(word) || (afterGroupWord && capital)
  }
  return { role, warning: null }
}

/** Le letture di una riga, con gli avvisi che cominciano da scheda e riga. */
function rowReader(
  table: Table,
  row: TableRow,
  toCalendarDate: ToCalendarDate,
  warnings: string[],
  groupNames: readonly string[] = [],
) {
  const warn = (message: string) => void warnings.push(`${where(table, row)}: ${message}`)
  return {
    warn,
    /** La data della colonna; undefined se c'è ma non si legge, e allora l'avviso dice `then`. */
    date(column: string, then: string): CalendarDate | null | undefined {
      const value = readCalendarDate(row.get(column), toCalendarDate)
      if (value === undefined) warn(`la data «${text(row.get(column))}» in «${column}» non la leggo${then}.`)
      return value
    },
    role(column: string): string {
      const { role, warning } = readRole(row.get(column), column, groupNames)
      if (warning) warn(warning)
      return role
    },
  }
}

const DEADLINE_WORDS: Record<string, DeadlineKind> = {
  bando: 'call',
  adempimento: 'duty',
  fiscale: 'tax',
  evento: 'event',
  assemblea: 'assembly',
  misura: 'measure',
}

/** `groupNames`: i nomi della scheda «Gruppi», che valgono nel ruolo di chi segue. */
export function readDeadlines(
  table: Table,
  toCalendarDate: ToCalendarDate,
  warnings: string[],
  groupNames: readonly string[] = [],
): Deadline[] {
  const deadlines: Deadline[] = []
  const firstRow = new Map<string, number>()
  for (const row of table.rows) {
    const read = rowReader(table, row, toCalendarDate, warnings, groupNames)
    const id = text(row.get('id'))
    if (!id) {
      read.warn('manca l’id, la scadenza non si pubblica.')
      continue
    }
    const first = firstRow.get(id)
    if (first !== undefined) {
      read.warn(`l’id ${id} c’è già alla riga ${first + 1}, la scadenza non si pubblica.`)
      continue
    }
    firstRow.set(id, row.index)
    const word = normalize(text(row.get('tipo')))
    const kind = word ? DEADLINE_WORDS[word] : 'duty'
    if (!word) read.warn('manca il tipo: la tratto come adempimento.')
    if (!kind) {
      read.warn(`il tipo «${text(row.get('tipo'))}» non lo conosco, la scadenza non si pubblica.`)
      continue
    }
    const dueOn = read.date('data', ', la scadenza non si pubblica')
    if (dueOn === null) read.warn('manca la data, la scadenza non si pubblica.')
    if (!dueOn) continue
    deadlines.push({
      id,
      what: text(row.get('cosa')),
      kind,
      dueOn,
      ownerRole: read.role('chi segue (ruolo)'),
      doneOn: read.date('fatta il', ': la scadenza resta da fare') ?? null,
    })
  }
  return deadlines
}

export function readResolutions(
  table: Table,
  toCalendarDate: ToCalendarDate,
  warnings: string[],
): ReservedResolution[] {
  const resolutions: ReservedResolution[] = []
  for (const row of table.rows) {
    const read = rowReader(table, row, toCalendarDate, warnings)
    const date = read.date('data', ', la delibera non si pubblica')
    if (date === null) read.warn('manca la data, la delibera non si pubblica.')
    if (!date) continue
    const subject = text(row.get('oggetto'))
    if (!subject) {
      read.warn('manca l’oggetto, la delibera non si pubblica.')
      continue
    }
    const link = text(row.get('link al verbale'))
    if (link && !isDriveUrl(link)) read.warn('il «link al verbale» non porta al Drive: la delibera esce senza verbale.')
    resolutions.push({
      date,
      body: text(row.get('organo')),
      subject,
      minutesUrl: isDriveUrl(link) ? link : null,
      ratifiedOn: read.date('ratificata il', ': la delibera esce come non ratificata') ?? null,
    })
  }
  return resolutions
}

/** Solo le questioni aperte: lo stato vuoto vale «aperta». `groupNames` come in readDeadlines. */
export function readIssues(
  table: Table,
  toCalendarDate: ToCalendarDate,
  warnings: string[],
  groupNames: readonly string[] = [],
): ReservedIssue[] {
  const issues: ReservedIssue[] = []
  for (const row of table.rows) {
    const read = rowReader(table, row, toCalendarDate, warnings, groupNames)
    const stage = normalize(text(row.get('stato')))
    if (stage === 'chiusa') continue
    if (stage && stage !== 'aperta') {
      read.warn(`lo stato «${text(row.get('stato'))}» non lo conosco, la questione non si pubblica.`)
      continue
    }
    const what = text(row.get('cosa'))
    if (!what) {
      read.warn('manca «cosa», la questione non si pubblica.')
      continue
    }
    issues.push({
      what,
      since: read.date('da quando', ': esce senza data') ?? null,
      ownerRole: read.role('chi (ruolo)'),
    })
  }
  return issues
}

/**
 * Una cifra in euro: come la dà Google (un numero), o scritta all'italiana, «1.200,50 €» o «27.780». Null se è
 * vuota, undefined se non si legge o è negativa.
 */
export function readAmount(value: unknown): number | null | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : undefined
  const written = text(value).replace(/[€\s\u00a0\u202f]/g, '')
  if (!written) return null
  if (/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d+$/.test(written)) return Number(written.replace(/\./g, '').replace(',', '.'))
  if (/^(?:\d+|\d{1,3}(?:\.\d{3})+)$/.test(written)) return Number(written.replace(/\./g, ''))
  return undefined
}

export function readBudget(table: Table, toCalendarDate: ToCalendarDate, warnings: string[]): ReservedBudget {
  let updatedOn: CalendarDate | null = null
  const lines: ReservedBudget['lines'] = []
  for (const row of table.rows) {
    const read = rowReader(table, row, toCalendarDate, warnings)
    const label = text(row.get('voce'))
    const hasNumbers = !isBlank(row.get('previsto')) || !isBlank(row.get('speso'))
    if (hasNumbers && !label) read.warn('ci sono dei numeri ma manca la voce, la riga non si pubblica.')
    if (label && hasNumbers) {
      const amount = (column: string) => {
        const value = readAmount(row.get(column))
        if (value !== undefined) return value
        read.warn(`la cifra «${text(row.get(column))}» in «${column}» non la leggo: esce vuota.`)
        return null
      }
      lines.push({ label, planned: amount('previsto'), spent: amount('speso') })
    }
    const date = read.date('aggiornato il', '')
    if (date && (updatedOn === null || date > updatedOn)) updatedOn = date
  }
  return { updatedOn, lines }
}

const DEFAULT_STALE_DAYS = 30

export function readSettings(table: Table, warnings: string[]): Settings {
  const row = table.rows.find((candidate) => normalize(text(candidate.get('voce'))) === 'giorni per fermo')
  if (!row) return { staleDays: DEFAULT_STALE_DAYS }
  const value = row.get('valore')
  const days = typeof value === 'number' ? value : Number(text(value))
  if (Number.isInteger(days) && days >= 1) return { staleDays: days }
  warnings.push(`«${table.spec.name}»: «giorni per fermo» vale «${text(value)}», uso ${DEFAULT_STALE_DAYS}.`)
  return { staleDays: DEFAULT_STALE_DAYS }
}
