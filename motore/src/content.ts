// Il Foglio «Bussola · contenuti» visto dal motore: le schede, le colonne che servono e come si leggono. Il
// Foglio entra come `Workbook`, così si prova in Node con array finti; in Apps Script è SpreadsheetApp (google.ts).
// Le colonne si trovano per nome: chi cura il Foglio può spostarle, non rinominarle.
import {
  COORDINATION_ID,
  isCalendarDate,
  isDriveUrl,
  isLinkUrl,
  isLocalDateTime,
  isMeetUrl,
  ROLES,
  type CalendarDate,
  type Deadline,
  type DeadlineKind,
  type LinkAudience,
  type LocalDateTime,
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
    [
      'id',
      'nome',
      'missione',
      'come si partecipa',
      'dove e quando',
      'link della chat',
      'chat aperta ai soci',
      'codice del gruppo',
    ],
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
  // Da T7: le schede del sito. Se una manca, il giro lo dice in «Salute» e pubblica il resto.
  referents: spec(
    'Referenti',
    ['GdL', 'numero socio', 'nome da mostrare', 'ruolo', 'consenso dal', 'mail per la Riservata'],
    ['GdL', 'nome da mostrare', 'ruolo', 'consenso dal'],
  ),
  meetings: spec('Incontri', [
    'GdL',
    'data e ora',
    'link Meet',
    'visibile ai soci',
    'ora della risposta',
    'id risposta',
    'esito del controllo',
  ]),
  links: spec('Link', ['titolo', 'link', 'chi lo può aprire', 'GdL']),
  firstDay: spec('Primo giorno', ['titolo', 'testo', 'link'], ['titolo', 'testo']),
  // Da T6: gli impegni, e le risposte del Modulo «Proponi un impegno» con l'esito. Se mancano, il giro lo dice in
  // «Salute» e pubblica il resto.
  commitments: spec(
    'Impegni',
    [
      'id',
      'anno',
      'titolo',
      'cosa si fa',
      'cantiere o GdL',
      'giornate',
      'fino a quando',
      'tipo',
      'consegne',
      'chi verifica (numero socio)',
      'retribuzione',
      'compenso',
      'compenso visibile ai soci',
      'proposto da (numero socio)',
      'proposto da (nome)',
      'proposto da (cognome)',
      'proposto da (mail)',
      'proposto il',
      'delibera del Coordinamento il',
      'ratifica del Direttivo il',
      'come si lascia',
      'come si revoca',
      'stato',
      'esito',
      'motivo del respingimento',
      'incaricato (numero socio)',
      'ruolo di chi lo prende',
      'sostituto (numero socio)',
      'note',
    ],
    [
      'id',
      'anno',
      'titolo',
      'cosa si fa',
      'cantiere o GdL',
      'giornate',
      'fino a quando',
      'tipo',
      'consegne',
      'chi verifica (numero socio)',
      'retribuzione',
      'compenso',
      'compenso visibile ai soci',
      'proposto da (numero socio)',
      'proposto da (nome)',
      'proposto da (cognome)',
      'proposto da (mail)',
      'proposto il',
      'delibera del Coordinamento il',
      'ratifica del Direttivo il',
      'come si lascia',
      'come si revoca',
      'stato',
      'esito',
      'motivo del respingimento',
      'incaricato (numero socio)',
      'ruolo di chi lo prende',
      'sostituto (numero socio)',
    ],
  ),
  commitmentResponses: spec('Proposte di impegno', [
    'id risposta',
    'ora',
    'impegno',
    'cosa si fa',
    'cantiere o GdL',
    'giornate',
    'fino a quando',
    'tipo',
    'consegne',
    'chi verifica',
    'retribuzione',
    'compenso',
    'compenso visibile ai soci',
    'proposto da',
    'proposto da (nome)',
    'proposto da (cognome)',
    'proposto da (mail)',
    'come si lascia',
    'come si revoca',
    'esito del controllo',
  ]),
  usage: spec('Uso', ['mese', 'area', 'persone distinte', 'su quante']),
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

/**
 * Una scheda nata con una tappa dopo: se manca, o le manca una colonna, l'avviso lo dice e il giro va avanti senza.
 * Ciò che porta non esce: per «Referenti» è la strada sicura, perché nessun nome esce senza il consenso letto.
 */
export function readOptionalTable(workbook: Workbook, sheet: SheetSpec, warnings: string[]): Table | null {
  if (!workbook.values(sheet.name)) {
    warnings.push(`Manca la scheda «${sheet.name}»: la crea setupBussola, dall’editor.`)
    return null
  }
  try {
    return readTable(workbook, sheet)
  } catch (error) {
    if (!(error instanceof ContentError)) throw error
    warnings.push(`${error.message} Finché non c’è, ciò che porta la scheda non esce sul sito.`)
    return null
  }
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

export type GroupRow = {
  index: number
  id: string
  name: string
  formKey: string
  mission: string
  howToJoin: string
  whereWhen: string
  /** Il link della chat, solo se è aperta ai soci. */
  chatUrl: string | null
}

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

export type Settings = {
  staleDays: number
  /** Dove si scrive alla segreteria: un Modulo o una pagina, mai una mail. */
  officeUrl: string | null
  /** Da T6: il valore di partenza di «compenso visibile ai soci» degli impegni. Di solito no. */
  feeVisibleDefault: boolean
}

const where = (table: Table, row: TableRow) => `«${table.spec.name}», riga ${row.index + 1}`

/** Sì o no, come si scrive nel Foglio; vuoto vale no. Undefined se non si legge. */
export function readYesNo(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  const word = normalize(text(value))
  if (['sì', 'si', 'vero', 'true', 'yes'].includes(word)) return true
  if (['', 'no', 'falso', 'false'].includes(word)) return false
  return undefined
}

/** `warnings` serve per i campi del sito: la chat che non si apre, il «sì» che non si legge. */
export function readGroups(table: Table, warnings: string[] = []): GroupRow[] {
  // Una scheda «GdL» di prima di T7 non ha la colonna: le chat restano chiuse finché setupBussola non la aggiunge.
  if (!table.header.has('chat aperta ai soci') && table.rows.some((row) => text(row.get('link della chat'))))
    warnings.push(
      `«${table.spec.name}»: manca la colonna «chat aperta ai soci»: le chat restano chiuse ai soci. La aggiunge ` +
        'setupBussola, dall’editor.',
    )
  return table.rows
    .map((row) => {
      const link = text(row.get('link della chat'))
      const open = readYesNo(row.get('chat aperta ai soci'))
      if (open === undefined)
        warnings.push(
          `${where(table, row)}: «chat aperta ai soci» vale «${text(row.get('chat aperta ai soci'))}»: la tratto come no.`,
        )
      if (open && link && !isLinkUrl(link))
        warnings.push(`${where(table, row)}: il «link della chat» non è un link https che si apre: non esce.`)
      if (open && !link) warnings.push(`${where(table, row)}: la chat è aperta ai soci, ma manca il link.`)
      return {
        index: row.index,
        id: text(row.get('id')),
        name: text(row.get('nome')),
        formKey: text(row.get('codice del gruppo')),
        mission: text(row.get('missione')),
        howToJoin: text(row.get('come si partecipa')),
        whereWhen: text(row.get('dove e quando')),
        chatUrl: open && isLinkUrl(link) ? link : null,
      }
    })
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
  const name = nameLikeWord(role, groupNames)
  if (name) return refuse(nameWarning(name))
  return { role, warning: null }
}

const nameWarning = (word: string) =>
  `«${word}» sembra un nome. Con la maiuscola vanno solo gli organi di RAMI, come «il Direttivo», e i gruppi ` +
  'della scheda «Gruppi».'

/** La prima parola con la maiuscola, dopo la prima, che non è un organo né un gruppo: probabilmente un nome. */
function nameLikeWord(role: string, groupNames: readonly string[]): string | null {
  const known = new Set([...ROLE_PROPER_WORDS, ...groupNames.flatMap(words)])
  let afterGroupWord = false
  // La prima parola è l'articolo, o la parola del ruolo, che può avere la maiuscola: «Il Direttivo», «Referente».
  for (const word of words(role).slice(1)) {
    const capital = /^\p{Lu}/u.test(word)
    if (capital && !afterGroupWord && !known.has(word)) return word
    afterGroupWord = GROUP_WORDS.includes(word) || (afterGroupWord && capital)
  }
  return null
}

/** Le letture di una riga, con gli avvisi che cominciano da scheda e riga. */
export function rowReader(
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

/** Una scadenza col «visibile ai soci» (da T7): solo queste vanno sul sito. */
export type DeadlineRow = Deadline & { membersCanSee: boolean }

/** `groupNames`: i nomi della scheda «Gruppi», che valgono nel ruolo di chi segue. */
export function readDeadlines(
  table: Table,
  toCalendarDate: ToCalendarDate,
  warnings: string[],
  groupNames: readonly string[] = [],
): DeadlineRow[] {
  const deadlines: DeadlineRow[] = []
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
    const visible = readYesNo(row.get('visibile ai soci'))
    if (visible === undefined)
      read.warn(
        `«visibile ai soci» vale «${text(row.get('visibile ai soci'))}»: la scadenza resta solo nella Riservata.`,
      )
    deadlines.push({
      id,
      what: text(row.get('cosa')),
      kind,
      dueOn,
      ownerRole: read.role('chi segue (ruolo)'),
      doneOn: read.date('fatta il', ': la scadenza resta da fare') ?? null,
      membersCanSee: visible ?? false,
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
  const setting = (name: string) =>
    table.rows.find((candidate) => normalize(text(candidate.get('voce'))) === name)?.get('valore')
  return {
    staleDays: readStaleDays(table, setting('giorni per fermo'), warnings),
    officeUrl: readOfficeUrl(table, setting('link della segreteria'), warnings),
    feeVisibleDefault: readFeeVisible(table, setting('compenso visibile ai soci'), warnings),
  }
}

/** «compenso visibile ai soci» in «Impostazioni»: vuota, o che non si legge, vale no. */
function readFeeVisible(table: Table, value: unknown, warnings: string[]): boolean {
  const visible = readYesNo(value ?? '')
  if (visible !== undefined) return visible
  warnings.push(`«${table.spec.name}»: «compenso visibile ai soci» vale «${text(value)}»: uso no.`)
  return false
}

function readStaleDays(table: Table, value: unknown, warnings: string[]): number {
  if (value === undefined) return DEFAULT_STALE_DAYS
  const days = typeof value === 'number' ? value : Number(text(value))
  if (Number.isInteger(days) && days >= 1) return days
  warnings.push(`«${table.spec.name}»: «giorni per fermo» vale «${text(value)}», uso ${DEFAULT_STALE_DAYS}.`)
  return DEFAULT_STALE_DAYS
}

/** Il «link della segreteria»: dove scrive chi non trova la chat del suo gruppo. Una mail non va: il sito non ne mostra. */
function readOfficeUrl(table: Table, value: unknown, warnings: string[]): string | null {
  const link = text(value)
  if (!link) return null
  if (isLinkUrl(link)) return link
  warnings.push(`«${table.spec.name}»: il «link della segreteria» non è un link https, e una mail non va: non esce.`)
  return null
}

// Le schede del sito (T7). Il GdL si scrive con l'id o col nome della scheda «GdL».

/** Dall'id o dal nome del gruppo all'id; null se non c'è. */
export function groupResolver(groups: readonly { id: string; name: string }[], extra: readonly string[] = []) {
  const ids = new Map<string, string>()
  for (const id of extra) ids.set(normalize(id), id)
  for (const group of groups) {
    ids.set(normalize(group.name), group.id)
    ids.set(normalize(group.id), group.id)
  }
  return (value: unknown) => ids.get(normalize(text(value))) ?? null
}

/** Le parole con cui comincia il ruolo di un referente, se non comincia con un articolo. */
const REFERENT_ROLE_WORDS = [
  'referente',
  'co-referente',
  'coreferente',
  'vicereferente',
  'rappresentante',
  'coordinatore',
  'coordinatrice',
  'portavoce',
  'facilitatore',
  'facilitatrice',
  'responsabile',
  'segretario',
  'segretaria',
  'tesoriere',
  'tesoriera',
]

/**
 * Il ruolo di un referente esce sul sito anche senza consenso, quindi non deve portare un nome. Comincia con la parola
 * di un ruolo («referente», «co-referente») o con un articolo («la referente»), e dopo vanno con la maiuscola solo
 * organi e gruppi, come in readRole. Un nome al primo posto («Lia referente», «Mario») non passa.
 */
function referentRoleProblem(role: string, groupNames: readonly string[]): string | null {
  if (ROLE_MARKS.test(role)) return 'niente parentesi, virgole, due punti o chiocciole.'
  const [first = ''] = words(role)
  if (!ROLE_START.test(role) && !REFERENT_ROLE_WORDS.includes(normalize(first)))
    return `«${first}» non è la parola di un ruolo: comincia con «referente», «co-referente», «rappresentante»….`
  const word = nameLikeWord(role, groupNames)
  return word ? nameWarning(word) : null
}

export type ReferentRow = { groupId: string; name: string; role: string; consentSince: CalendarDate | null }

/**
 * La scheda «Referenti». Il nome esce solo col consenso: la data in «consenso dal», non oltre oggi. Il ruolo esce
 * sempre, quindi si controlla come i ruoli della Riservata: con la maiuscola solo organi e gruppi. «mail per la
 * Riservata» e «numero socio» non si leggono: restano nel Foglio.
 */
export function readReferents(
  table: Table,
  toCalendarDate: ToCalendarDate,
  warnings: string[],
  groups: readonly { id: string; name: string }[],
): ReferentRow[] {
  const groupOf = groupResolver(groups)
  const groupNames = groups.map((group) => group.name)
  const referents: ReferentRow[] = []
  for (const row of table.rows) {
    const read = rowReader(table, row, toCalendarDate, warnings, groupNames)
    const groupId = groupOf(row.get('GdL'))
    if (!groupId) {
      read.warn(`il GdL «${text(row.get('GdL'))}» non c’è nella scheda «GdL»: il referente non esce.`)
      continue
    }
    let role = text(row.get('ruolo'))
    const problem = role ? referentRoleProblem(role, groupNames) : null
    if (problem) {
      read.warn(`il ruolo «${role}» non va: ${problem} Intanto esce come «referente».`)
      role = ''
    }
    referents.push({
      groupId,
      name: text(row.get('nome da mostrare')),
      role: role || 'referente',
      consentSince: read.date('consenso dal', ': il nome non esce') ?? null,
    })
  }
  return referents
}

export type MeetingRow = { groupId: string; startsAt: LocalDateTime; meetUrl: string; membersCanSee: boolean }

export type ToLocalTime = (instant: Date) => LocalDateTime

/** Giorno e ora: come li dà Google (Date), o scritti, «AAAA-MM-GG HH:MM» o «GG/MM/AAAA HH:MM». */
export function readLocalDateTime(value: unknown, toLocalTime: ToLocalTime): LocalDateTime | null | undefined {
  if (value instanceof Date) {
    const local = Number.isNaN(value.getTime()) ? '' : toLocalTime(value)
    // Una data scritta senza l'ora il Foglio la fa a mezzanotte: un incontro a mezzanotte vuol dire che l'ora manca.
    return isLocalDateTime(local) && !local.endsWith('T00:00') ? local : undefined
  }
  const written = text(value)
  if (!written) return null
  const iso = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2})[:.](\d{2})$/.exec(written)
  const italian = /^(\d{1,2})\/(\d{1,2})\/(\d{4}),? (\d{1,2})[:.](\d{2})$/.exec(written)
  const local = iso
    ? `${iso[1]}T${(iso[2] ?? '').padStart(2, '0')}:${iso[3]}`
    : italian
      ? `${italian[3]}-${(italian[2] ?? '').padStart(2, '0')}-${(italian[1] ?? '').padStart(2, '0')}T${(italian[4] ?? '').padStart(2, '0')}:${italian[5]}`
      : ''
  return isLocalDateTime(local) ? local : undefined
}

/** La scheda «Incontri»: le righe scritte a mano e quelle del Modulo; quelle «da controllare» non escono. */
export function readMeetings(
  table: Table,
  toLocalTime: ToLocalTime,
  warnings: string[],
  groups: readonly { id: string; name: string }[],
  notApplied: string,
): MeetingRow[] {
  const groupOf = groupResolver(groups, [COORDINATION_ID])
  const meetings: MeetingRow[] = []
  for (const row of table.rows) {
    if (text(row.get('esito del controllo')).startsWith(notApplied)) continue
    const warn = (message: string) => void warnings.push(`${where(table, row)}: ${message}`)
    const groupId = groupOf(row.get('GdL'))
    if (!groupId) {
      warn(`il GdL «${text(row.get('GdL'))}» non c’è nella scheda «GdL»: l’incontro non esce.`)
      continue
    }
    const cell = row.get('data e ora')
    const startsAt = readLocalDateTime(cell, toLocalTime)
    if (!startsAt) {
      // Una data dal Foglio che non si legge come giorno e ora è una data senza l'ora (readLocalDateTime).
      const problem = cell instanceof Date ? 'è un giorno, e manca l’ora' : `vale «${text(cell)}»`
      warn(`«data e ora» ${problem}: scrivila come 05/11/2026 18:30. L’incontro non esce.`)
      continue
    }
    const meetUrl = text(row.get('link Meet'))
    if (!isMeetUrl(meetUrl)) {
      warn('il «link Meet» non è un link di meet.google.com: l’incontro non esce.')
      continue
    }
    const visible = readYesNo(row.get('visibile ai soci'))
    if (visible === undefined)
      warn(`«visibile ai soci» vale «${text(row.get('visibile ai soci'))}»: lo tratto come no.`)
    meetings.push({ groupId, startsAt, meetUrl, membersCanSee: visible ?? false })
  }
  return meetings
}

const AUDIENCE_WORDS: Record<string, LinkAudience> = {
  tutti: 'all',
  soci: 'members',
  'partecipanti del gdl': 'group',
  gdl: 'group',
  coordinamento: 'coordination',
}

/** Le parole di «chi lo può aprire», per l'elenco a scelta della preparazione. */
export const AUDIENCE_CHOICES = ['tutti', 'soci', 'partecipanti del GdL', 'Coordinamento']

export type LinkRow = { title: string; url: string; audience: LinkAudience; groupId: string | null }

export function readLinks(
  table: Table,
  warnings: string[],
  groups: readonly { id: string; name: string }[],
): LinkRow[] {
  const groupOf = groupResolver(groups)
  const links: LinkRow[] = []
  for (const row of table.rows) {
    const warn = (message: string) => void warnings.push(`${where(table, row)}: ${message}`)
    const title = text(row.get('titolo'))
    const url = text(row.get('link'))
    if (!title || !isLinkUrl(url)) {
      warn(
        title
          ? 'il link non è un link https che si apre, o porta una mail o un telefono: non esce.'
          : 'manca il titolo, il link non esce.',
      )
      continue
    }
    const audience = AUDIENCE_WORDS[normalize(text(row.get('chi lo può aprire')))]
    if (!audience) {
      warn(
        `«chi lo può aprire» vale «${text(row.get('chi lo può aprire'))}»: scegli fra ${AUDIENCE_CHOICES.join(', ')}. Il link non esce.`,
      )
      continue
    }
    const groupId = groupOf(row.get('GdL'))
    if (audience === 'group' && !groupId) {
      warn(`il link è per i partecipanti di un GdL, ma il GdL «${text(row.get('GdL'))}» non c’è: non esce.`)
      continue
    }
    links.push({ title, url, audience, groupId: audience === 'group' ? groupId : null })
  }
  return links
}

export type FirstDayRow = { title: string; text: string; url: string | null }

export function readFirstDay(table: Table, warnings: string[]): FirstDayRow[] {
  const steps: FirstDayRow[] = []
  for (const row of table.rows) {
    const title = text(row.get('titolo'))
    const url = text(row.get('link'))
    if (!title) {
      warnings.push(`${where(table, row)}: manca il titolo, il passo non esce.`)
      continue
    }
    if (url && !isLinkUrl(url))
      warnings.push(`${where(table, row)}: il link non è un link https che si apre: non esce.`)
    steps.push({ title, text: text(row.get('testo')), url: isLinkUrl(url) ? url : null })
  }
  return steps
}
