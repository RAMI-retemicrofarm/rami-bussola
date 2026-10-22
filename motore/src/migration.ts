// La migrazione del libro soci di oggi nel Foglio «Bussola · soci» (T3). Una funzione pura: la colla con Google
// legge le schede incollate e scrive Soci e Pagamenti. Il libro vero non l'abbiamo visto, quindi le intestazioni si
// riconoscono per nome, in tante forme, e ciò che non si riconosce passa com'è. Nessuna riga si perde in silenzio:
// o entra in Soci, o il resoconto dice perché no. Solo ES2020.
import {
  isFirstQuota,
  memberCounts,
  memberStatus,
  statusLabel,
  type CalendarDate,
  type DuesPayment,
  type DuesSettings,
  type MemberStatus,
} from '@bussola/condiviso'
import { readAmount, readCalendarDate, text, type ToCalendarDate } from './content.ts'
import { MEMBER_TYPE_WORDS, PAYMENT_METHOD_WORDS, PAYMENT_STATUS_WORDS, SOCI_SHEETS } from './members.ts'

export type MigrationCounts = {
  /** Le righe del libro con dati, sotto l'intestazione: sempre `migrated + notMigrated`. */
  registerRows: number
  migrated: number
  notMigrated: number
  /** Le righe portate con la quota dell'anno di oggi spuntata. */
  inGoodStandingByRegister: number
  /** Le stesse righe con lo stato calcolato dalla Bussola: «in regola» (un receduto non lo è). */
  inGoodStandingByBussola: number
  /** I pagamenti in dubbio portati in «Da abbinare». */
  doubtful: number
}

export type MigrationResult = {
  /** False se il libro non si può migrare (manca il numero, o il nome): allora Soci e Pagamenti sono vuoti. */
  ok: boolean
  /** Le righe di «Soci», per nome di colonna: quelle di `SOCI_SHEETS.members`, poi le colonne in più del libro. */
  members: Record<string, string>[]
  /** Le righe di «Pagamenti», per nome di colonna: prima le quote del libro, poi i pagamenti in dubbio. */
  payments: Record<string, string | number>[]
  /** Le intestazioni del libro che non si riconoscono, nell'ordine del libro: vanno in fondo a «Soci». */
  extraColumns: string[]
  counts: MigrationCounts
  /** Il resoconto per il segretario, una riga per cosa da sapere. */
  report: string[]
}

type Field =
  | 'numero'
  | 'cognome'
  | 'nome'
  | 'mail'
  | 'telefono'
  | 'tipo'
  | 'ammesso il'
  | 'delibera'
  | 'receduto il'
  | 'note'
  | 'fullName'

/** Le intestazioni che si riconoscono, già piegate da `fold`. */
const FIELD_NAMES: Record<string, Field> = {
  numero: 'numero',
  'numero socio': 'numero',
  'n socio': 'numero',
  n: 'numero',
  'n°': 'numero',
  'n° socio': 'numero',
  tessera: 'numero',
  'n tessera': 'numero',
  'numero tessera': 'numero',
  cognome: 'cognome',
  nome: 'nome',
  mail: 'mail',
  email: 'mail',
  'e-mail': 'mail',
  'posta elettronica': 'mail',
  telefono: 'telefono',
  cellulare: 'telefono',
  tel: 'telefono',
  cell: 'telefono',
  tipo: 'tipo',
  'tipo socio': 'tipo',
  categoria: 'tipo',
  'ammesso il': 'ammesso il',
  'data ammissione': 'ammesso il',
  'data iscrizione': 'ammesso il',
  'iscritto il': 'ammesso il',
  delibera: 'delibera',
  'delibera di ammissione': 'delibera',
  'receduto il': 'receduto il',
  'data recesso': 'receduto il',
  recesso: 'receduto il',
  'uscito il': 'receduto il',
  note: 'note',
  nota: 'note',
  'nome e cognome': 'fullName',
  'cognome e nome': 'fullName',
  nominativo: 'fullName',
}

/** «Quota 2026», «quota anno 2026», «quota sociale 2026», o l'anno da solo. */
const QUOTA_HEADER = /^(?:quota (?:anno |sociale )?)?((?:19|20)\d{2})$/

const TYPE_WORDS: Record<string, string> = {
  produttore: MEMBER_TYPE_WORDS.producer,
  professionista: MEMBER_TYPE_WORDS.producer,
  sostenitore: MEMBER_TYPE_WORDS.supporter,
  'non produttore': MEMBER_TYPE_WORDS.supporter,
}

const CHECKED = ['✓', '✔', 'x', 'si', 'pagato', 'pagata', 'vero', 'true', '1']
const UNCHECKED = ['', 'no', 'falso', 'false', '0', '-']

type DoubtfulField = 'data' | 'importo' | 'causale' | 'riferimento' | 'modo'

const DOUBTFUL_NAMES: Record<string, DoubtfulField> = {
  data: 'data',
  'data operazione': 'data',
  'data valuta': 'data',
  importo: 'importo',
  cifra: 'importo',
  euro: 'importo',
  causale: 'causale',
  descrizione: 'causale',
  riferimento: 'riferimento',
  rif: 'riferimento',
  cro: 'riferimento',
  trn: 'riferimento',
  modo: 'modo',
  metodo: 'modo',
  mezzo: 'modo',
}

const METHOD_WORDS: Record<string, string> = {
  '': PAYMENT_METHOD_WORDS.transfer,
  bonifico: PAYMENT_METHOD_WORDS.transfer,
  contanti: PAYMENT_METHOD_WORDS.cash,
}

/** Un'intestazione o una parola di cella senza maiuscole, accenti, punti e spazi doppi. */
const fold = (value: unknown): string =>
  text(value).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\./g, ' ').replace(/\s+/g, ' ').trim()

/** Una riga vuota: le caselle di Google non spuntate arrivano come FALSE anche nelle righe senza dati. */
const isEmptyRow = (cells: readonly unknown[]) => cells.every((cell) => cell === false || text(cell) === '')

const quoted = (names: readonly string[]) => names.map((name) => `«${name}»`).join(', ')
const italianDate = (date: CalendarDate) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`

/** La casella della quota: spuntata (con la cella da ricordare se dice di più), vuota, o da guardare. */
type Box = { kind: 'paid'; shown: string } | { kind: 'none' } | { kind: 'unclear'; shown: string }

function readBox(value: unknown, toCalendarDate: ToCalendarDate): Box {
  if (value === true) return { kind: 'paid', shown: '' }
  if (value === false) return { kind: 'none' }
  // Una data di Google è un istante: si mostra il giorno di Roma, non l'ora della macchina.
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { kind: 'unclear', shown: 'data non valida' }
    return { kind: 'paid', shown: italianDate(toCalendarDate(value)) }
  }
  const word = fold(value)
  if (UNCHECKED.indexOf(word) >= 0) return { kind: 'none' }
  if (CHECKED.indexOf(word) >= 0) return { kind: 'paid', shown: '' }
  const amount = readAmount(value)
  if (amount === 0) return { kind: 'none' }
  if (typeof amount === 'number') return { kind: 'paid', shown: text(value) }
  if (readCalendarDate(value, toCalendarDate)) return { kind: 'paid', shown: text(value) }
  return { kind: 'unclear', shown: text(value) }
}

type Header = {
  fields: Map<Field, number>
  quotas: { column: number; year: number; label: string }[]
  extras: { column: number; name: string }[]
  notes: string[]
}

function readHeader(names: readonly unknown[], rows: readonly (readonly unknown[])[]): Header {
  const header: Header = { fields: new Map(), quotas: [], extras: [], notes: [] }
  // Due colonne con la stessa intestazione non devono sovrascriversi in Soci, che le cerca senza le maiuscole.
  const key = (name: string) => name.trim().toLowerCase()
  const taken = new Set<string>(SOCI_SHEETS.members.columns.map(key))
  const addExtra = (column: number, name: string) => {
    let unique = name
    for (let n = 2; taken.has(key(unique)); n++) unique = `${name} (${n})`
    taken.add(key(unique))
    header.extras.push({ column, name: unique })
  }
  names.forEach((cell, column) => {
    const label = text(cell)
    const folded = fold(cell)
    if (!folded) {
      if (rows.some((cells) => text(cells[column]) !== '')) {
        addExtra(column, `colonna ${column + 1}`)
        header.notes.push(
          `La colonna ${column + 1} non ha intestazione ma ha dati: passa in Soci come «colonna ${column + 1}».`,
        )
      }
      return
    }
    const quota = QUOTA_HEADER.exec(folded)
    if (quota) {
      const year = Number(quota[1])
      const same = header.quotas.find((other) => other.year === year)
      if (!same) {
        header.quotas.push({ column, year, label })
        return
      }
      header.notes.push(
        `«${label}» è un'altra colonna delle quote ${year}, come «${same.label}»: conto la prima, la seconda passa ` +
          `com'è in Soci.`,
      )
      addExtra(column, label)
      return
    }
    const field = FIELD_NAMES[folded]
    if (field && !header.fields.has(field)) {
      header.fields.set(field, column)
      return
    }
    if (field) {
      const first = text(names[header.fields.get(field) ?? -1])
      header.notes.push(`«${label}» dice la stessa cosa di «${first}»: tengo la prima, la seconda passa com'è in Soci.`)
    }
    addExtra(column, label)
  })
  const fullName = header.fields.get('fullName')
  if (fullName !== undefined) {
    header.fields.delete('fullName')
    const label = text(names[fullName])
    if (header.fields.has('cognome') || header.fields.has('nome')) {
      addExtra(fullName, label)
    } else {
      header.fields.set('cognome', fullName)
      header.notes.push(
        `Il libro ha una colonna sola, «${label}»: va tutta in «cognome», e «nome» resta vuoto, perché non si può ` +
          `indovinare dove finisce il nome. Se serve, si divide a mano in Soci.`,
      )
    }
  }
  return header
}

const emptyCounts = (registerRows: number): MigrationCounts => ({
  registerRows,
  migrated: 0,
  notMigrated: registerRows,
  inGoodStandingByRegister: 0,
  inGoodStandingByBussola: 0,
  doubtful: 0,
})

type PaymentRow = Record<string, string | number>

export function migrateRegister(input: {
  /** La copia del libro soci di oggi, incollata in una scheda: la prima riga è l'intestazione. */
  register: unknown[][]
  /** Facoltativa: i pagamenti in dubbio dal tesoriere, con intestazione (data, importo, causale, riferimento, modo). */
  doubtful: unknown[][] | null
  today: CalendarDate
  settings: DuesSettings
  toCalendarDate: ToCalendarDate
}): MigrationResult {
  const { today, settings, toCalendarDate } = input
  const year = Number(today.slice(0, 4))
  const names = input.register[0] ?? []
  // La riga 2 del libro è la prima dopo l'intestazione; le righe tutte vuote si saltano senza dirlo.
  const rows = input.register
    .slice(1)
    .map((cells, i) => ({ line: i + 2, cells }))
    .filter((row) => !isEmptyRow(row.cells))
  const header = readHeader(
    names,
    rows.map((row) => row.cells),
  )
  const found = names.map(text).filter(Boolean)
  const stop = (why: string): MigrationResult => ({
    ok: false,
    members: [],
    payments: [],
    extraColumns: [],
    counts: emptyCounts(rows.length),
    report: [
      `${why} Nella prima riga trovo ${found.length ? quoted(found) : 'niente'}.`,
      'Non porto niente: si sistema la prima riga e si rilancia.',
    ],
  })
  if (!header.fields.has('numero')) {
    return stop(
      'Il libro non ha la colonna del numero socio (cerco «numero», «numero socio», «n. socio», «n°», «tessera»).',
    )
  }
  if (!header.fields.has('cognome') && !header.fields.has('nome')) {
    return stop('Il libro non ha né «cognome» né «nome» (né «nome e cognome», né «nominativo»).')
  }

  const counters = new Map<number, number>()
  const nextId = (forYear: number) => {
    const n = (counters.get(forYear) ?? 0) + 1
    counters.set(forYear, n)
    return `L-${forYear}-${String(n).padStart(4, '0')}`
  }
  const payment = (values: Partial<PaymentRow>): PaymentRow => ({
    id: '',
    'numero socio': '',
    "vale per l'anno": year,
    importo: settings.amount,
    data: '',
    modo: PAYMENT_METHOD_WORDS.register,
    riferimento: '',
    'chi incassa': '',
    'registrato da': PAYMENT_METHOD_WORDS.register,
    account: '',
    'registrato il': today,
    'contanti ricevuti il': '',
    stato: PAYMENT_STATUS_WORDS.recorded,
    'motivo o nota': '',
    'chiave della registrazione': '',
    ...values,
  })

  const members: Record<string, string>[] = []
  const payments: PaymentRow[] = []
  const rowNotes: string[] = []
  const firstLine = new Map<string, number>()
  const migrated: { label: string; byRegister: boolean; status: MemberStatus; leftOn: CalendarDate | '' }[] = []
  const unmigratedThisYear: number[] = []
  // Chi non ha data di ammissione né quote, alla prima quota conta come nuovo socio (`isFirstQuota`).
  const unknownSince: string[] = []

  for (const { line, cells } of rows) {
    const cell = (field: Field) => {
      const at = header.fields.get(field)
      return at === undefined ? '' : cells[at]
    }
    const number = text(cell('numero'))
    const surname = text(cell('cognome'))
    const name = text(cell('nome'))
    const who = [number ? `n. ${number}` : '', surname || name].filter(Boolean).join(' ')
    const label = who ? `riga ${line}, ${who}` : `riga ${line}`
    const boxes = header.quotas.map((quota) => ({ ...quota, box: readBox(cells[quota.column], toCalendarDate) }))
    const paidYears = boxes.filter((quota) => quota.box.kind === 'paid').map((quota) => quota.year)

    const refuse = (why: string) => {
      const had =
        paidYears.length === 1 ? `la quota ${paidYears[0]} spuntata` : `le quote ${paidYears.join(', ')} spuntate`
      rowNotes.push(`${label}: ${why}, non la porto${paidYears.length ? `; nel libro ha ${had}` : ''}.`)
      if (paidYears.indexOf(year) >= 0) unmigratedThisYear.push(line)
    }
    if (!number) {
      refuse('senza numero socio')
      continue
    }
    if (!surname && !name) {
      refuse('né cognome né nome')
      continue
    }
    const key = number.toLowerCase()
    const first = firstLine.get(key)
    if (first !== undefined) {
      refuse(`il numero ${number} c'è già alla riga ${first}`)
      continue
    }
    firstLine.set(key, line)

    // Una data che non si legge resta fuori dalla cella, perché in Soci fermerebbe la pagina della segreteria per
    // tutti: il testo del libro va in coda alla nota, così non si perde.
    const unreadDates: string[] = []
    const readDate = (field: 'ammesso il' | 'receduto il'): string => {
      const value = cell(field)
      const date = readCalendarDate(value, toCalendarDate)
      if (date !== undefined) return date ?? ''
      const left = field === 'receduto il' ? ' e non lo conto come receduto' : ''
      rowNotes.push(
        `${label}: «${field}» dice «${text(value)}», che non è una data: lascio la cella vuota e la scrivo nella ` +
          `nota${left}.`,
      )
      unreadDates.push(`${field}, nel libro: ${text(value)}`)
      return ''
    }
    const typeCell = text(cell('tipo'))
    const type = TYPE_WORDS[fold(typeCell)] ?? ''
    if (typeCell && !type) {
      rowNotes.push(`${label}: il tipo dice «${typeCell}», né professionista né sostenitore: lo lascio vuoto.`)
    }
    const admitted = readDate('ammesso il')
    const leftCell = readDate('receduto il')
    const member: Record<string, string> = {
      numero: number,
      cognome: surname,
      nome: name,
      mail: text(cell('mail')),
      telefono: text(cell('telefono')),
      tipo: type,
      'ammesso il': admitted,
      delibera: text(cell('delibera')),
      'receduto il': leftCell,
      note: [text(cell('note')), ...unreadDates].filter(Boolean).join('; '),
    }
    for (const extra of header.extras) member[extra.name] = text(cells[extra.column])
    members.push(member)

    const own: DuesPayment[] = []
    for (const quota of boxes) {
      if (quota.box.kind === 'unclear') {
        rowNotes.push(`${label}: la quota ${quota.year} dice «${quota.box.shown}»: non la conto.`)
      }
      if (quota.box.kind !== 'paid') continue
      const id = nextId(quota.year)
      const shown = quota.box.shown ? `: «${quota.box.shown}»` : ''
      payments.push(
        payment({
          id,
          'numero socio': number,
          "vale per l'anno": quota.year,
          'motivo o nota': `dal libro soci, colonna «${quota.label}»${shown}`,
        }),
      )
      own.push({
        id,
        memberNumber: number,
        validYear: quota.year,
        amount: settings.amount,
        date: '',
        method: 'register',
        reference: '',
        status: 'recorded',
      })
    }
    const leftOn = leftCell
    const status = memberStatus(leftOn, own, today)
    migrated.push({ label, byRegister: paidYears.indexOf(year) >= 0, status, leftOn })
    if (status !== 'left' && !admitted && isFirstQuota({ memberNumber: number, admittedOn: admitted }, today, own))
      unknownSince.push(number)
  }

  const doubtfulNotes = migrateDoubtful(input.doubtful, { year, settings, toCalendarDate, nextId, payment })
  payments.push(...doubtfulNotes.payments)

  const byRegister = migrated.filter((row) => row.byRegister).length
  const byBussola = migrated.filter((row) => row.status === 'inGoodStanding').length
  const counts = memberCounts(migrated.map((row) => row.status))
  const differences: string[] = []
  for (const row of migrated) {
    const inBussola = row.status === 'inGoodStanding'
    if (row.byRegister === inBussola) continue
    const why = !row.byRegister
      ? `per la Bussola è in regola, ma nel libro la quota ${year} non è spuntata`
      : row.status === 'left' && row.leftOn
        ? `quota ${year} spuntata ma receduto il ${italianDate(row.leftOn)}`
        : `quota ${year} spuntata ma per la Bussola è «${statusLabel(row.status, year)}»`
    differences.push(`${row.label}: ${why}.`)
  }

  const report = [
    `Righe del libro con dati: ${rows.length}. Le porto in Soci: ${migrated.length}; non le porto: ` +
      `${rows.length - migrated.length}, ognuna qui sotto col suo perché.`,
  ]
  if (header.quotas.length) {
    report.push(
      `Le colonne delle quote: ${quoted(header.quotas.map((quota) => quota.label))}. Ogni casella spuntata diventa ` +
        `un pagamento «${PAYMENT_METHOD_WORDS.register}», con l'importo della quota (${settings.amount} €) e senza data.`,
    )
  } else {
    report.push('Non trovo colonne delle quote («Quota 2026», «2026»…): nessuno risulta in regola.')
  }
  if (header.extras.length) {
    report.push(
      `Le colonne che non riconosco passano così come sono in Soci, in fondo: ` +
        `${quoted(header.extras.map((extra) => extra.name))}.`,
    )
  }
  report.push(...header.notes, ...rowNotes, ...doubtfulNotes.report)
  if (unknownSince.length) report.push(unknownSinceNote(unknownSince, settings))
  report.push(`In Soci: ${migrated.length}, di cui ${counts.left} receduti: i soci sono ${counts.members}.`)
  if (unmigratedThisYear.length) {
    const lines = `${unmigratedThisYear.length === 1 ? 'riga' : 'righe'} ${unmigratedThisYear.join(', ')}`
    report.push(
      `Nel libro le righe con la quota ${year} spuntata sono ${byRegister + unmigratedThisYear.length}: ` +
        `${byRegister} portate e ${unmigratedThisYear.length} no (${lines}).`,
    )
  }
  report.push(`In regola per il ${year}: ${byRegister} secondo il libro, ${byBussola} secondo la Bussola.`)
  report.push(differences.length ? 'La differenza, riga per riga:' : 'I due numeri tornano.', ...differences)

  return {
    ok: true,
    members,
    payments,
    extraColumns: header.extras.map((extra) => extra.name),
    counts: {
      registerRows: rows.length,
      migrated: migrated.length,
      notMigrated: rows.length - migrated.length,
      inGoodStandingByRegister: byRegister,
      inGoodStandingByBussola: byBussola,
      doubtful: doubtfulNotes.payments.length,
    },
    report,
  }
}

/**
 * Chi non ha data di ammissione né quote, alla prima quota la Bussola lo tratta da nuovo socio: con la regola di
 * ottobre, la quota pagata dal giorno di cambio anno vale per l'anno dopo. Un socio storico va riconosciuto prima.
 */
function unknownSinceNote(numbers: readonly string[], settings: DuesSettings): string {
  const [month = '', dayOfMonth = ''] = settings.yearSwitchDay.split('-')
  const from = `dal ${dayOfMonth}/${month}`
  const which = `(n. ${numbers.join(', ')})`
  const rule = settings.newMemberOnly ? `, e ${from} la quota varrà per l'anno dopo` : ''
  return numbers.length === 1
    ? `1 socio senza data di ammissione né quote ${which}: alla prima quota conterà come nuovo socio${rule}. ` +
        'Se è un socio di anni passati, scrivi la data in «ammesso il».'
    : `${numbers.length} soci senza data di ammissione né quote ${which}: alla prima quota conteranno come nuovi ` +
        `soci${rule}. Se sono soci di anni passati, scrivi la data in «ammesso il».`
}

/** I pagamenti in dubbio del tesoriere: tutti senza socio, cioè in «Da abbinare», numerati dopo le quote. */
function migrateDoubtful(
  sheet: unknown[][] | null,
  tools: {
    year: number
    settings: DuesSettings
    toCalendarDate: ToCalendarDate
    nextId: (year: number) => string
    payment: (values: Partial<PaymentRow>) => PaymentRow
  },
): { payments: PaymentRow[]; report: string[] } {
  if (!sheet) return { payments: [], report: ['Nessun elenco dei pagamenti in dubbio: «Da abbinare» resta vuoto.'] }
  const names = sheet[0] ?? []
  const columns = new Map<DoubtfulField, number>()
  names.forEach((cell, column) => {
    const field = DOUBTFUL_NAMES[fold(cell)]
    if (field && !columns.has(field)) columns.set(field, column)
  })
  const rows = sheet
    .slice(1)
    .map((cells, i) => ({ line: i + 2, cells }))
    .filter((row) => !isEmptyRow(row.cells))
  if (!columns.size) {
    return {
      payments: [],
      report: [
        `L'elenco dei pagamenti in dubbio non ha colonne che riconosco (cerco «data», «importo», «causale», ` +
          `«riferimento», «modo»; trovo ${quoted(names.map(text).filter(Boolean))}): non porto nessuno dei ` +
          `${rows.length} pagamenti, si sistema la prima riga e si rilancia.`,
      ],
    }
  }
  const report: string[] = []
  const payments = rows.map(({ line, cells }) => {
    const cell = (field: DoubtfulField) => {
      const at = columns.get(field)
      return at === undefined ? '' : cells[at]
    }
    const label = `Pagamenti in dubbio, riga ${line}`
    const date = readCalendarDate(cell('data'), tools.toCalendarDate)
    const causale = text(cell('causale'))
    let note = causale ? `in dubbio dalla migrazione: «${causale}»` : 'in dubbio dalla migrazione'
    if (date === undefined) {
      note += `; la data dice «${text(cell('data'))}»`
      report.push(`${label}: la data dice «${text(cell('data'))}», che non è una data: la scrivo nella nota.`)
    }
    const amount = readAmount(cell('importo'))
    if (typeof amount !== 'number') {
      const said = text(cell('importo'))
      const what = said ? `l'importo dice «${said}»` : "l'importo manca"
      report.push(`${label}: ${what}: metto ${tools.settings.amount} €, da controllare.`)
    }
    const method = text(cell('modo'))
    const methodWord = METHOD_WORDS[fold(method)]
    if (methodWord === undefined) {
      report.push(`${label}: il modo dice «${method}», né bonifico né contanti: scrivo bonifico.`)
    }
    const forYear = date ? Number(date.slice(0, 4)) : tools.year
    return tools.payment({
      id: tools.nextId(forYear),
      "vale per l'anno": forYear,
      importo: typeof amount === 'number' ? amount : tools.settings.amount,
      data: date ?? '',
      modo: methodWord ?? PAYMENT_METHOD_WORDS.transfer,
      riferimento: text(cell('riferimento')),
      'motivo o nota': note,
    })
  })
  const word = payments.length === 1 ? 'pagamento' : 'pagamenti'
  report.unshift(
    `Porto ${payments.length} ${word} in dubbio in «Pagamenti» senza socio: stanno in «Da abbinare» finché ` +
      `qualcuno non li abbina.`,
  )
  return { payments, report }
}
