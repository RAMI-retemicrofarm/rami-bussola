// Il Foglio «Bussola · soci» visto dal motore: l'anagrafica, i pagamenti, chi entra nell'area della segreteria e i
// due registri. È un file a parte dal Foglio contenuti (ADR 0002): chi modifica i contenuti non si dà l'accesso.
// Come in content.ts, le colonne si trovano per nome e il Foglio entra come `Workbook`.
import {
  DEFAULT_DUES_SETTINGS,
  normalizeEmail,
  type CalendarDate,
  type DuesSettings,
  type PaymentMethod,
  type PaymentStatus,
} from '@bussola/condiviso'
import {
  ContentError,
  readAmount,
  readCalendarDate,
  text,
  type SheetSpec,
  type Table,
  type TableRow,
  type ToCalendarDate,
} from './content.ts'
import { readBankAmount } from './bank.ts'
import type { OfficeMember, OfficePayment } from './office-api.ts'
import type { BankLine } from './reconcile.ts'

const sheet = (name: string, columns: readonly string[], required: readonly string[] = columns): SheetSpec => ({
  name,
  columns,
  required,
})

/** Le schede, nell'ordine in cui le crea `setupSoci`. Link personali e Invii arrivano con T9 e T5. */
export const SOCI_SHEETS = {
  members: sheet(
    'Soci',
    ['numero', 'cognome', 'nome', 'mail', 'telefono', 'tipo', 'ammesso il', 'delibera', 'receduto il', 'note'],
    // Senza «ammesso il» ogni socio sembrerebbe nuovo, e dopo il 15/10 la quota passerebbe all'anno dopo.
    ['numero', 'cognome', 'nome', 'mail', 'ammesso il', 'receduto il'],
  ),
  payments: sheet('Pagamenti', [
    'id',
    'numero socio',
    "vale per l'anno",
    'importo',
    'data',
    'modo',
    'riferimento',
    'chi incassa',
    'registrato da',
    'account',
    'registrato il',
    'contanti ricevuti il',
    'stato',
    'motivo o nota',
    'chiave della registrazione',
  ]),
  access: sheet('Accessi', [
    'persona',
    'mail',
    'ruolo',
    "entra nell'area",
    'può registrare pagamenti',
    'può confermare pagamenti',
  ]),
  accessLog: sheet('Registro di Accessi', ['quando', 'chi', 'quali celle', 'valore prima', 'valore dopo']),
  /** Da T4: le righe della banca, incollate o importate dal CSV; «abbinato a» e «ignorato perché» li scrive il motore. */
  bank: sheet('Estratto conto', ['data', 'importo', 'causale', 'riferimento', 'abbinato a', 'ignorato perché']),
  privacyLog: sheet('Registro privacy', ['data', 'tipo', 'socio o fatto', 'cosa si è fatto', 'chiuso il'], []),
  settings: sheet('Impostazioni della segreteria', ['voce', 'valore', 'nota'], ['voce', 'valore']),
} as const

/** Le parole delle celle: nel Foglio si scrive in italiano, nel codice in inglese (glossario). */
export const PAYMENT_METHOD_WORDS = { transfer: 'bonifico', cash: 'contanti', register: 'libro soci' } as const
export const PAYMENT_STATUS_WORDS = {
  recorded: 'registrato',
  pendingTreasurer: 'in attesa del tesoriere',
  cancelled: 'annullato',
} as const
export const MEMBER_TYPE_WORDS = { producer: 'professionista', supporter: 'sostenitore' } as const
export const ACCESS_ROLES = ['segretario', 'segreteria part-time', 'tesoriere'] as const
/**
 * L'indirizzo della segreteria di RAMI. Il motore gira con l'account della Bussola (ADR 0004): le mail ai soci hanno
 * qui il «rispondi a», e il controllo delle condivisioni lo ammette come il proprietario.
 */
export const OFFICE_ADDRESS = 'segreteria@retemicrofarm.it'
export type AccessRole = (typeof ACCESS_ROLES)[number]
export const PRIVACY_KINDS = ['richiesta', 'violazione'] as const

/** Le voci di «Impostazioni della segreteria», con il valore di partenza che scrive `setupSoci`. */
export const OFFICE_SETTINGS = {
  yearSwitchDay: { voce: 'giorno di cambio anno', partenza: '15/10' },
  newMemberOnly: {
    voce: 'la regola di ottobre vale anche per chi rinnova in ritardo',
    partenza: 'no',
  },
  graceUntil: { voce: 'fine della grazia', partenza: '31/3' },
  amount: { voce: 'importo della quota', partenza: 30 },
  iban: { voce: 'IBAN', partenza: '' },
  reason: { voce: 'causale', partenza: 'tesseramento socio <anno> n. <numero>' },
  cashReceipt: { voce: 'per i contanti, la mail fa da ricevuta', partenza: 'sì' },
  instructions: { voce: 'link alle Istruzioni della segreteria', partenza: '' },
  /** Si ripete, una riga per voce fissa: la mail nel valore, il motivo nella nota. */
  reader: { voce: 'legge il Foglio soci', partenza: '' },
} as const

// I lettori del Foglio soci. Le regole delle quote stanno in `dues` (condiviso): qui solo come si leggono le celle.
// Una cella che non si legge ferma tutto con un `ContentError` che dice scheda, riga e come scriverla: meglio
// fermarsi che contare male le quote.

const normalize = (value: string) => value.trim().toLowerCase()
const where = (table: Table, row: TableRow) => `«${table.spec.name}», riga ${row.index + 1}`

/** Il numero socio da scrivere: un numero se è fatto di cifre, come nella scheda Soci. */
export const memberCell = (number: string): string | number => (/^[1-9]\d*$/.test(number) ? Number(number) : number)

/** «sì», «si», «x» e vero (la casella di Google) valgono sì; tutto il resto no. */
export function isYes(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  return typeof value === 'string' && ['sì', 'si', 'x'].includes(normalize(value))
}

export type AccessRow = {
  index: number
  person: string
  /** Senza maiuscole e spazi, come `normalizeEmail`. */
  email: string
  /** Vuoto se la cella non dice uno dei tre ruoli. */
  role: AccessRole | ''
  enters: boolean
  canRecord: boolean
  canConfirm: boolean
}

export function readAccess(table: Table): AccessRow[] {
  return table.rows.map((row) => {
    const role = normalize(text(row.get('ruolo')))
    return {
      index: row.index,
      person: text(row.get('persona')),
      email: normalizeEmail(text(row.get('mail'))),
      role: ACCESS_ROLES.find((known) => known === role) ?? '',
      enters: isYes(row.get("entra nell'area")),
      canRecord: isYes(row.get('può registrare pagamenti')),
      canConfirm: isYes(row.get('può confermare pagamenti')),
    }
  })
}

const MONTHS = [
  'gennaio',
  'febbraio',
  'marzo',
  'aprile',
  'maggio',
  'giugno',
  'luglio',
  'agosto',
  'settembre',
  'ottobre',
  'novembre',
  'dicembre',
]
/** I giorni di ogni mese, col 29 febbraio: il giorno vale per tutti gli anni. */
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** Un giorno dell'anno, «MM-GG»: da «15/10», «15/10/2026», «15 ottobre» o da una data di Google. Null se non vale. */
export function readDayMonth(value: unknown, toCalendarDate: ToCalendarDate): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : toCalendarDate(value).slice(5)
  if (typeof value !== 'string') return null
  const written = normalize(value)
  const numeric = /^(\d{1,2})\/(\d{1,2})(?:\/\d{4})?$/.exec(written)
  const named = /^(\d{1,2})\s+([a-z]+)$/.exec(written)
  const day = Number(numeric?.[1] ?? named?.[1])
  const month = numeric ? Number(numeric[2]) : named ? MONTHS.indexOf(named[2] ?? '') + 1 : 0
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= (MONTH_DAYS[month - 1] ?? 0))) return null
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export type OfficeSettings = {
  dues: DuesSettings
  /** «per i contanti, la mail fa da ricevuta». */
  cashReceipt: boolean
  instructionsUrl: string
  /** Le voci fisse dell'elenco di chi legge il Foglio soci, senza maiuscole e spazi. */
  readers: string[]
}

const isBlank = (value: unknown) => value === '' || value === null || value === undefined

export function readOfficeSettings(table: Table, toCalendarDate: ToCalendarDate): OfficeSettings {
  const rows = (setting: { voce: string }) =>
    table.rows.filter((row) => normalize(text(row.get('voce'))) === normalize(setting.voce))
  /** Il valore della prima riga della voce; undefined se la voce manca o è vuota: vale la partenza. */
  const value = (setting: { voce: string }) => {
    const found = rows(setting)[0]?.get('valore')
    return isBlank(found) ? undefined : found
  }
  const wrong = (setting: { voce: string }, how: string): never => {
    const shown = text(value(setting))
    throw new ContentError(`«${table.spec.name}»: «${setting.voce}» vale «${shown}». ${how}`)
  }
  const day = (setting: { voce: string; partenza: string }) => {
    const found = value(setting)
    const read = readDayMonth(found ?? setting.partenza, toCalendarDate)
    return read ?? wrong(setting, `Scrivi giorno e mese, per esempio ${setting.partenza}.`)
  }
  const yesNo = (setting: { voce: string; partenza: string }) => {
    const found = value(setting) ?? setting.partenza
    if (isYes(found)) return true
    if (found === false || (typeof found === 'string' && normalize(found) === 'no')) return false
    return wrong(setting, 'Scrivi sì o no.')
  }

  const amount = readAmount(value(OFFICE_SETTINGS.amount) ?? OFFICE_SETTINGS.amount.partenza)
  if (!amount) wrong(OFFICE_SETTINGS.amount, 'Scrivi l’importo in euro, per esempio 30.')

  const instructionsUrl = text(value(OFFICE_SETTINGS.instructions))
  if (instructionsUrl && !/^https:\/\/\S+$/.test(instructionsUrl))
    wrong(OFFICE_SETTINGS.instructions, 'Scrivi l’indirizzo del documento, che comincia con https://.')

  const readers: string[] = []
  for (const row of rows(OFFICE_SETTINGS.reader)) {
    const email = normalizeEmail(text(row.get('valore')))
    if (!email) continue
    if (!/^[^\s@]+@[^\s@]+$/.test(email))
      throw new ContentError(
        `${where(table, row)}: «${OFFICE_SETTINGS.reader.voce}» vale «${email}». Scrivi una mail, una per riga.`,
      )
    readers.push(email)
  }

  return {
    dues: {
      yearSwitchDay: day(OFFICE_SETTINGS.yearSwitchDay),
      // La voce dice «vale anche per chi rinnova in ritardo»: sì vuol dire che non vale solo per i nuovi soci.
      newMemberOnly: !yesNo(OFFICE_SETTINGS.newMemberOnly),
      graceUntil: day(OFFICE_SETTINGS.graceUntil),
      amount: amount ?? DEFAULT_DUES_SETTINGS.amount,
    },
    cashReceipt: yesNo(OFFICE_SETTINGS.cashReceipt),
    instructionsUrl,
    readers,
  }
}

/** Una data della riga: vuota se la cella è vuota, ferma tutto se non si legge. */
function rowDate(table: Table, row: TableRow, column: string, toCalendarDate: ToCalendarDate): CalendarDate | '' {
  const value = readCalendarDate(row.get(column), toCalendarDate)
  if (value === undefined)
    throw new ContentError(
      `${where(table, row)}: la data «${text(row.get(column))}» in «${column}» non la leggo. Scrivila come 16/10/2026.`,
    )
  return value ?? ''
}

export type MemberRow = Omit<OfficeMember, 'status' | 'payments'> & {
  index: number
  /** La «delibera» di ammissione, per il libro soci nel Drive. */
  resolution: string
}

const MEMBER_TYPES: Record<string, OfficeMember['type']> = {
  [MEMBER_TYPE_WORDS.producer]: 'producer',
  [MEMBER_TYPE_WORDS.supporter]: 'supporter',
}

export function readMembers(table: Table, toCalendarDate: ToCalendarDate): MemberRow[] {
  const members: MemberRow[] = []
  const firstRow = new Map<string, number>()
  for (const row of table.rows) {
    const number = text(row.get('numero'))
    if (!number) throw new ContentError(`${where(table, row)}: manca il numero del socio.`)
    const first = firstRow.get(number)
    if (first !== undefined)
      throw new ContentError(`${where(table, row)}: il numero ${number} c’è già alla riga ${first + 1}.`)
    firstRow.set(number, row.index)
    members.push({
      index: row.index,
      number,
      lastName: text(row.get('cognome')),
      firstName: text(row.get('nome')),
      email: normalizeEmail(text(row.get('mail'))),
      phone: text(row.get('telefono')),
      type: MEMBER_TYPES[normalize(text(row.get('tipo')))] ?? '',
      admittedOn: rowDate(table, row, 'ammesso il', toCalendarDate),
      resolution: text(row.get('delibera')),
      leftOn: rowDate(table, row, 'receduto il', toCalendarDate),
    })
  }
  return members
}

export type PaymentRow = OfficePayment & {
  index: number
  /** L'account di Google con cui è stato registrato. */
  account: string
  cashReceivedOn: CalendarDate | ''
  /** La «chiave della registrazione»: uno per schermo, contro la doppia registrazione. */
  requestKey: string
}

const METHODS = Object.fromEntries(Object.entries(PAYMENT_METHOD_WORDS).map(([code, word]) => [word, code])) as Record<
  string,
  PaymentMethod
>
const STATUSES = Object.fromEntries(Object.entries(PAYMENT_STATUS_WORDS).map(([code, word]) => [word, code])) as Record<
  string,
  PaymentStatus
>

export const paymentMethodCell = (method: PaymentMethod): string => PAYMENT_METHOD_WORDS[method]
export const paymentStatusCell = (status: PaymentStatus): string => {
  const words: Record<PaymentStatus, string> = PAYMENT_STATUS_WORDS
  return words[status]
}

/** Un anno intero, da numero o da testo: «2027». */
export function readYear(value: unknown): number | null {
  const year = typeof value === 'number' ? value : /^\d{4}$/.test(text(value)) ? Number(text(value)) : NaN
  return Number.isInteger(year) ? year : null
}

export function readPayments(table: Table, toCalendarDate: ToCalendarDate): PaymentRow[] {
  // Una riga copiata a mano farebbe due pagamenti con lo stesso id: annullare e cambiare l'anno toccherebbero il primo.
  const firstRow = new Map<string, number>()
  return table.rows.map((row) => {
    const stop = (message: string): never => {
      throw new ContentError(`${where(table, row)}: ${message}`)
    }
    const id = text(row.get('id'))
    const first = id ? firstRow.get(id) : undefined
    if (first !== undefined) stop(`il numero ${id} c’è già alla riga ${first + 1}.`)
    if (id) firstRow.set(id, row.index)
    const year = readYear(row.get("vale per l'anno"))
    const validYear = year ?? stop(`l’anno «${text(row.get("vale per l'anno"))}» in «vale per l'anno» non lo leggo.`)
    const amount = readAmount(row.get('importo'))
    if (amount === undefined) stop(`l’importo «${text(row.get('importo'))}» non lo leggo. Scrivilo come 30.`)
    const methodWord = normalize(text(row.get('modo')))
    const method =
      METHODS[methodWord] ??
      stop(`il modo «${text(row.get('modo'))}» non lo conosco: scrivi bonifico, contanti o libro soci.`)
    const statusWord = normalize(text(row.get('stato')))
    return {
      index: row.index,
      id,
      memberNumber: text(row.get('numero socio')),
      validYear,
      amount: amount ?? 0,
      date: rowDate(table, row, 'data', toCalendarDate),
      method,
      reference: text(row.get('riferimento')),
      collectedBy: text(row.get('chi incassa')),
      recordedBy: text(row.get('registrato da')),
      account: normalizeEmail(text(row.get('account'))),
      recordedOn: rowDate(table, row, 'registrato il', toCalendarDate),
      cashReceivedOn: rowDate(table, row, 'contanti ricevuti il', toCalendarDate),
      // Vuoto vale registrato; una parola sconosciuta non conta, come «in attesa»: nessuno è in regola per un refuso.
      status: statusWord ? (STATUSES[statusWord] ?? 'pendingTreasurer') : 'recorded',
      note: text(row.get('motivo o nota')),
      requestKey: text(row.get('chiave della registrazione')),
    }
  })
}

/**
 * Le righe di «Estratto conto», senza fermarsi: una data o un importo che non si leggono restano vuoti, e
 * l'abbinamento dice il perché. Una riga vuota di data, importo, causale e riferimento non c'è.
 */
export function readBankLines(table: Table, toCalendarDate: ToCalendarDate): BankLine[] {
  const lines: BankLine[] = []
  for (const row of table.rows) {
    const date = readCalendarDate(row.get('data'), toCalendarDate)
    const amountCell = row.get('importo')
    const amount = typeof amountCell === 'number' ? amountCell : readBankAmount(text(amountCell))
    const line: BankLine = {
      index: row.index,
      date: date || '',
      amount: Number.isFinite(amount) ? amount : null,
      reason: text(row.get('causale')),
      reference: text(row.get('riferimento')),
      matchedTo: text(row.get('abbinato a')),
      ignoredWhy: text(row.get('ignorato perché')),
    }
    if (line.date || line.amount !== null || line.reason || line.reference) lines.push(line)
  }
  return lines
}
