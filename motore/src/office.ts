// La pagina della segreteria, lato motore (ADR 0002, flusso D): chi entra, la vista di Soci, «Oggi» e Pagamenti,
// l'anteprima, la registrazione di un pagamento, l'annullamento, il cambio d'anno, la conferma del tesoriere, i
// contanti ricevuti, l'abbinamento a un socio, l'estratto conto e «Non è una quota», «Fatta» sulle scadenze e il libro
// soci nel Drive. Le regole delle quote stanno in `dues` (condiviso). Tutto entra come parametro, così si prova in
// Node; in Apps Script le giunture le fa google.ts. KV c'è solo per i numeri dei soci della Riservata, dopo ogni
// registrazione: se non risponde, la registrazione resta e «Oggi» lo dice finché la pubblicazione non riesce.
import {
  countsTowardsDues,
  findPossibleDuplicate,
  firstFreeYear,
  isCalendarDate,
  isFirstQuota,
  memberCounts,
  memberStatus,
  nextPaymentId,
  normalizeEmail,
  renewalsLabel,
  validYearFor,
  daysBetween,
  type CalendarDate,
  type PaymentStatus,
} from '@bussola/condiviso'
import { recentAccessChanges } from './access-log.ts'
import { markDeadlineDone, readOfficeDeadlines, type OfficeDeadline } from './agenda.ts'
import { parseBankText } from './bank.ts'
import { countToWrite } from './commitments.ts'
import {
  columnOf,
  ContentError,
  readAmount,
  readTable,
  rowValues,
  SHEETS,
  text,
  type ToCalendarDate,
  type Workbook,
} from './content.ts'
import type { KvStore } from './kv.ts'
import {
  memberCell,
  paymentMethodCell,
  paymentStatusCell,
  readAccess,
  readBankLines,
  readMembers,
  readOfficeSettings,
  readPayments,
  SOCI_SHEETS,
  type AccessRow,
  type MemberRow,
  type OfficeSettings,
  type PaymentRow,
} from './members.ts'
import {
  buildMembersSnapshot,
  LAST_RECORDING_DAYS,
  publishMembersSnapshot,
  readMembersPublication,
} from './members-snapshot.ts'
import type {
  AssignMemberInput,
  CancelInput,
  ChangeResult,
  ChangeYearInput,
  DeadlineDoneInput,
  HealthLine,
  IgnoreBankLineInput,
  ImportBankInput,
  ImportResult,
  InvalidField,
  MailOutcome,
  OfficeDashboard,
  OfficeMember,
  OfficeOpenResult,
  OfficePayment,
  OfficeView,
  PaymentActionInput,
  PaymentInput,
  PaymentWithMember,
  PreviewResult,
  RecordResult,
  SaveRegisterInput,
  SetAsideLine,
} from './office-api.ts'
import type { PublishState } from './publish.ts'
import { euro, italianDate, receiptMail, type Mail } from './receipt.ts'
import {
  bankLineKey,
  isAutoReason,
  MATCH_WINDOW_DAYS,
  memberNumberInReason,
  notDuesWhy,
  reconcile,
  splitPasted,
  type BankLine,
  type IgnoredKind,
} from './reconcile.ts'
import { readRegisterState, saveMemberRegister, type RegisterStore } from './register.ts'
import { readSharingReport } from './sharing.ts'

export type OfficeDeps = {
  /** Il Foglio «Bussola · soci». */
  workbook: Workbook
  /** Il Foglio «Bussola · contenuti», per le scadenze e «Salute»; null se non è collegato. */
  content: (() => Workbook) | null
  /** L'account di chi usa la pagina (`Session.getActiveUser()`): vuoto se Google non lo dà. */
  email: string
  now: Date
  toCalendarDate: ToCalendarDate
  /** Data e ora nel fuso di Roma, per il «Registro di Accessi» e «Salute». */
  formatInstant: (instant: Date) => string
  /** Esegue dentro il lucchetto dello script; se non lo prende, lancia un `ContentError` da riprovare. */
  withLock: <T>(run: () => T) => T
  sendMail: (mail: Mail) => void
  /** Le proprietà dello script: le condivisioni, il libro soci, la pubblicazione dei numeri. */
  state: PublishState
  /** KV, per i numeri dei soci nella Riservata; null se non è configurato. Una scrittura caduta non ferma niente. */
  kv: KvStore | null
  scope: string
  sha256Hex: (text: string) => string
  /** Il Drive, per «Salva nel Drive»; null se non c'è. */
  registerStore: RegisterStore | null
}

type Sheet = {
  access: AccessRow[]
  settings: OfficeSettings
  members: MemberRow[]
  payments: PaymentRow[]
}

export { LAST_RECORDING_DAYS }

const readAccessRows = (deps: OfficeDeps) => readAccess(readTable(deps.workbook, SOCI_SHEETS.access))

/** Il resto del Foglio si legge dopo il controllo di «Accessi»: i suoi errori possono citare dei dati. */
function load(deps: OfficeDeps, access: AccessRow[] = readAccessRows(deps)): Sheet {
  const { workbook, toCalendarDate } = deps
  return {
    access,
    settings: readOfficeSettings(readTable(workbook, SOCI_SHEETS.settings), toCalendarDate),
    members: readMembers(readTable(workbook, SOCI_SHEETS.members), toCalendarDate),
    payments: readPayments(readTable(workbook, SOCI_SHEETS.payments), toCalendarDate),
  }
}

type Who = { kind: 'none' } | { kind: 'ask'; names: string[] } | { kind: 'ok'; row: AccessRow; names: string[] }

/**
 * Chi sta usando la pagina: le righe di «Accessi» con «entra» sì, uno dei tre ruoli e la stessa mail. Senza ruolo non
 * si entra, anche con «entra» sì: un refuso darebbe tutta l'anagrafica. Con più di una (un account
 * condiviso) conta la persona scelta nel «Chi sei?», se è fra quelle. La pagina non è mai una prova: si rifà sempre.
 */
function who(access: readonly AccessRow[], email: string, person: unknown): Who {
  const account = normalizeEmail(email)
  if (!account) return { kind: 'none' }
  const candidates = access.filter((row) => row.enters && row.role !== '' && row.email === account)
  const names = candidates.map((row) => row.person)
  const [only] = candidates
  if (!only) return { kind: 'none' }
  if (candidates.length === 1) return { kind: 'ok', row: only, names }
  const chosen = typeof person === 'string' ? person.trim() : ''
  const row = candidates.find((candidate) => candidate.person === chosen)
  return row ? { kind: 'ok', row, names } : { kind: 'ask', names }
}

/** Solo la mail di chi guarda: la pagina gli dice con quale account è entrato. Nessun altro dato. */
const noAccess = (deps: OfficeDeps) => ({ kind: 'noAccess' as const, email: normalizeEmail(deps.email) })

/** Un `ContentError` diventa un errore in italiano per la pagina; gli altri errori vanno al failure handler. */
function guard<T>(run: () => T): T | { kind: 'error'; message: string } {
  try {
    return run()
  } catch (error) {
    if (error instanceof ContentError) return { kind: 'error', message: error.message }
    throw error
  }
}

const todayOf = (deps: OfficeDeps): CalendarDate => deps.toCalendarDate(deps.now)
const yearOf = (date: CalendarDate) => Number(date.slice(0, 4))
const fullName = (member: MemberRow | undefined) => (member ? `${member.firstName} ${member.lastName}`.trim() : '')
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Solo i campi del contratto: la vista passa da `google.script.run`, che vuole JSON semplice. */
const officePayment = (payment: Omit<PaymentRow, 'index'>): OfficePayment => ({
  id: payment.id,
  memberNumber: payment.memberNumber,
  validYear: payment.validYear,
  amount: payment.amount,
  date: payment.date,
  method: payment.method,
  reference: payment.reference,
  collectedBy: payment.collectedBy,
  recordedBy: payment.recordedBy,
  recordedOn: payment.recordedOn,
  cashReceivedOn: payment.cashReceivedOn,
  status: payment.status,
  note: payment.note,
})

/** Dal più recente: l'anno di validità, poi la data, poi l'id. */
const newestFirst = (a: PaymentRow, b: PaymentRow) =>
  b.validYear - a.validYear || b.date.localeCompare(a.date) || b.id.localeCompare(a.id)

/** La scheda «Estratto conto»: può mancare in un Foglio di prima di T4, e allora «Da controllare» lo dice. */
function readBank(deps: OfficeDeps, toCheck: string[]): BankLine[] {
  if (!deps.workbook.values(SOCI_SHEETS.bank.name)) {
    toCheck.push(`Manca la scheda «${SOCI_SHEETS.bank.name}»: la crea setupSoci, dall’editor.`)
    return []
  }
  return readBankLines(readTable(deps.workbook, SOCI_SHEETS.bank), deps.toCalendarDate)
}

/** Una cella di «Salute» a parole: le date e le ore del Foglio nel fuso di Roma. */
const healthCell = (deps: OfficeDeps, value: unknown) =>
  value instanceof Date ? deps.formatInstant(value) : text(value)

function readHealth(deps: OfficeDeps, content: Workbook): HealthLine[] {
  if (!content.values(SHEETS.health.name)) return []
  return readTable(content, SHEETS.health).rows.map((row) => ({
    piece: text(row.get('pezzo')),
    status: text(row.get('stato')),
    checkedOn: healthCell(deps, row.get('ultimo controllo')),
    updatedOn: healthCell(deps, row.get('ultimo aggiornamento')),
    note: text(row.get('nota')),
  }))
}

/**
 * Le scadenze, «Salute» e, da T6, gli impegni da scrivere dal Foglio contenuti; se non c'è o non si legge,
 * `contentProblem` lo dice.
 */
function readContent(
  deps: OfficeDeps,
  today: CalendarDate,
): {
  deadlines: OfficeDeadline[]
  health: HealthLine[]
  warnings: string[]
  contentProblem: string
  commitmentsToWrite: number | null
} {
  const none = { deadlines: [], health: [], warnings: [], commitmentsToWrite: null }
  if (!deps.content) return { ...none, contentProblem: 'Il Foglio contenuti non è collegato.' }
  try {
    const content = deps.content()
    const { deadlines, warnings } = readOfficeDeadlines(content, deps.toCalendarDate, today)
    const toWrite = countToWrite(content, deps.toCalendarDate, today)
    if (toWrite.problem) warnings.push(toWrite.problem)
    return {
      deadlines,
      health: readHealth(deps, content),
      warnings,
      contentProblem: '',
      commitmentsToWrite: toWrite.count,
    }
  } catch (error) {
    return { ...none, contentProblem: `Il Foglio contenuti non si legge: ${errorText(error)}` }
  }
}

const cents = (amount: number) => Math.round(amount * 100) / 100

const countWord = (count: number) => (count === 2 ? 'Due' : count === 3 ? 'Tre' : String(count))

/** «5 e 7», «5, 7 e 9»: le righe del Foglio, con l'intestazione nella riga 1. */
function listRows(lines: readonly BankLine[]): string {
  const rows = lines.map((line) => String(line.index + 1))
  return rows.length > 1 ? `${rows.slice(0, -1).join(', ')} e ${rows[rows.length - 1]}` : (rows[0] ?? '')
}

function buildDashboard(deps: OfficeDeps, sheet: Sheet, row: AccessRow, today: CalendarDate): OfficeDashboard {
  const toCheck: string[] = []
  const bankLines = readBank(deps, toCheck)
  const payments = sheet.payments.map(officePayment)
  const outcome = reconcile(bankLines, payments, { today })
  // Solo ciò che si può chiudere: una cella che non si legge si corregge. Le uscite e gli importi a zero non sono
  // quote di soci: si contano a parte, altrimenti la prima commissione terrebbe «Da controllare» piena per sempre. Le
  // iscrizioni al Raduno e le righe «Non è una quota» hanno un conteggio loro, con l'elenco e il perché.
  const aside = (kind: IgnoredKind): SetAsideLine[] =>
    outcome.ignored.filter((item) => item.kind === kind).map(({ line, why }) => ({ line, why }))
  const outflows = aside('outflow').length
  for (const { line, why } of aside('unreadable'))
    toCheck.push(`«${SOCI_SHEETS.bank.name}», riga ${line.index + 1}: ${why}.`)
  for (const group of outcome.sameLines)
    toCheck.push(
      `${countWord(group.length)} righe uguali il ${italianDate(group[0]?.date as CalendarDate)} («${SOCI_SHEETS.bank.name}», righe ${listRows(group)}): controlla che non sia la stessa incollata due volte.`,
    )
  for (const { line, paymentIds, registered, how } of outcome.amountMismatch) {
    const same =
      how === 'reference'
        ? 'Riferimento uguale'
        : `Socio n. ${memberNumberInReason(line.reason) ?? ''} nei ${MATCH_WINDOW_DAYS} giorni`
    // Per socio, spesso è un socio che dona o compra le magliette e scrive il suo numero: il motivo a mano la toglie.
    const notDues =
      how === 'member'
        ? ' Se non è una quota (una donazione, le magliette), scrivi il motivo nella colonna «ignorato perché» della stessa riga.'
        : ''
    toCheck.push(
      `${same}, importo diverso: «${SOCI_SHEETS.bank.name}», riga ${line.index + 1} (${euro(line.amount ?? 0)} €) e ${paymentIds.join(', ')} (${euro(registered)} €).${notDues}`,
    )
  }
  const { deadlines, health, warnings, contentProblem, commitmentsToWrite } = readContent(deps, today)
  toCheck.push(...warnings)
  for (const deadline of deadlines)
    if (!deadline.ownerRole.trim()) toCheck.push(`La scadenza «${deadline.what}» non ha nessuno che la segua.`)
  // Un account condiviso è voluto, ma «Conferma» confronta solo i nomi: chi non registra (e quindi manda i suoi
  // pagamenti in attesa) può cambiare «Chi sei?» in chi conferma. Lo dice al segretario, che cura «Accessi», e
  // sparisce quando la configurazione cambia.
  if (row.role === 'segretario') {
    const byAccount = new Map<string, AccessRow[]>()
    for (const access of sheet.access)
      if (access.email && access.enters && access.role)
        byAccount.set(access.email, [...(byAccount.get(access.email) ?? []), access])
    for (const [email, rows] of byAccount)
      if (
        rows.some(
          (pending) => !pending.canRecord && rows.some((other) => other.canConfirm && other.person !== pending.person),
        )
      )
        toCheck.push(
          `L’account ${email} ha ${rows.length === 2 ? 'due' : rows.length} righe in «Accessi», e una può confermare: così si può confermare un proprio pagamento.`,
        )
  }

  const named = (payment: OfficePayment): PaymentWithMember => ({
    ...payment,
    memberName: fullName(sheet.members.find((member) => member.number === payment.memberNumber)),
  })
  const byRecording = (a: OfficePayment, b: OfficePayment) =>
    (a.recordedOn || a.date).localeCompare(b.recordedOn || b.date) || a.id.localeCompare(b.id)
  const cash = payments
    .filter((payment) => payment.method === 'cash' && payment.status !== 'cancelled' && !payment.cashReceivedOn)
    .sort(byRecording)
  const recorded = sheet.payments
    .filter((payment) => payment.method !== 'register' && payment.recordedOn)
    .sort((a, b) => a.recordedOn.localeCompare(b.recordedOn) || a.id.localeCompare(b.id))
  const last = recorded[recorded.length - 1]
  const renewals = buildMembersSnapshot(sheet.members, sheet.payments, sheet.settings.dues, today).renewals
  const sharing = row.role === 'segretario' ? readSharingReport(deps.state) : null
  const dates = bankLines
    .map((line) => line.date)
    .filter(Boolean)
    .sort()

  return {
    renewals,
    renewalsLabel: renewals ? renewalsLabel(renewals) : '',
    toMatch: outcome.toMatch,
    matchedLines: outcome.matched.length,
    bank: {
      lines: bankLines.length,
      outflows,
      lastDate: dates[dates.length - 1] ?? '',
      raduno: aside('raduno'),
      notDues: aside('notDues'),
    },
    pendingTreasurer: payments
      .filter((payment) => payment.status === 'pendingTreasurer')
      .sort(byRecording)
      .map(named),
    cashToDeliver: { payments: cash.map(named), total: cents(cash.reduce((sum, payment) => sum + payment.amount, 0)) },
    lastRecording: last ? { id: last.id, on: last.recordedOn, daysAgo: daysBetween(last.recordedOn, today) } : null,
    deadlines,
    toCheck,
    health,
    register: readRegisterState(deps.state),
    publication: readMembersPublication(deps.state),
    contentProblem,
    commitmentsToWrite,
    access: sharing
      ? {
          accessChanges: recentAccessChanges(
            readTable(deps.workbook, SOCI_SHEETS.accessLog),
            today,
            deps.toCalendarDate,
            deps.formatInstant,
          ),
          sharingCheckedOn: sharing.checkedOn,
          sharing: sharing.findings,
        }
      : null,
  }
}

function buildView(deps: OfficeDeps, sheet: Sheet, row: AccessRow, names: string[]): OfficeView {
  const today = todayOf(deps)
  const members: OfficeMember[] = [...sheet.members]
    .sort((a, b) => a.lastName.localeCompare(b.lastName, 'it') || a.firstName.localeCompare(b.firstName, 'it'))
    .map((member) => {
      const own = sheet.payments.filter((payment) => payment.memberNumber === member.number)
      return {
        number: member.number,
        lastName: member.lastName,
        firstName: member.firstName,
        email: member.email,
        phone: member.phone,
        type: member.type,
        admittedOn: member.admittedOn,
        leftOn: member.leftOn,
        status: memberStatus(member.leftOn, own, today),
        payments: own.sort(newestFirst).map(officePayment),
      }
    })
  return {
    today,
    year: yearOf(today),
    person: row.person,
    names,
    canRecord: row.canRecord,
    canConfirm: row.canConfirm,
    isSecretary: row.role === 'segretario',
    amount: sheet.settings.dues.amount,
    instructionsUrl: sheet.settings.instructionsUrl,
    counts: memberCounts(members.map((member) => member.status)),
    members,
    dashboard: buildDashboard(deps, sheet, row, today),
  }
}

/**
 * I numeri dei soci su KV, dopo ogni cambio del registro. Non ferma mai la pagina: se KV non risponde, o non è
 * configurato, lo stato lo ricorda e il giro dei 10 minuti riprova.
 */
function publishNumbers(deps: OfficeDeps, sheet: Sheet): void {
  if (!deps.kv) return
  try {
    publishMembersSnapshot(
      {
        kv: deps.kv,
        state: deps.state,
        sha256Hex: deps.sha256Hex,
        now: deps.now,
        scope: deps.scope,
        today: todayOf(deps),
      },
      buildMembersSnapshot(sheet.members, sheet.payments, sheet.settings.dues, todayOf(deps)),
    )
  } catch {
    // Lo stato della pubblicazione l'ha già scritto publishMembersSnapshot, quando poteva.
  }
}

/** All'apertura della pagina. `person` è il nome scelto nel «Chi sei?», o vuoto. */
export function openOffice(deps: OfficeDeps, person: unknown): OfficeOpenResult {
  return guard((): OfficeOpenResult => {
    const access = readAccessRows(deps)
    const found = who(access, deps.email, person)
    if (found.kind === 'none') return noAccess(deps)
    if (found.kind === 'ask') return { kind: 'whoAreYou', names: found.names }
    return { kind: 'ok', view: buildView(deps, load(deps, access), found.row, found.names) }
  })
}

const invalid = (field: InvalidField['field'], message: string): InvalidField => ({ kind: 'invalid', field, message })
const written = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

/** L'importo come l'ha scritto la persona: «30», «30,00», «30.50», «30 €». Null se non è un numero sopra lo zero. */
function readAmountInput(value: unknown): number | null {
  const plain = written(value).replace(/[€\s]/g, '')
  const amount = /^\d+\.\d{1,2}$/.test(plain) ? Number(plain) : readAmount(plain)
  return typeof amount === 'number' && amount > 0 ? amount : null
}

type Checked = {
  member: MemberRow | undefined
  amount: number
  date: CalendarDate
  method: 'transfer' | 'cash'
  reference: string
  collectedBy: string
  note: string
}

/** I controlli dei campi, nell'ordine dello schermo, coi messaggi del flusso D. */
function checkFields(input: PaymentInput, sheet: Sheet, today: CalendarDate): Checked | InvalidField {
  const memberNumber = written(input.memberNumber)
  const member = sheet.members.find((candidate) => candidate.number === memberNumber)
  if (memberNumber && !member)
    return invalid(
      'member',
      `Nessun socio con il numero ${memberNumber}. Prova col numero socio o solo col cognome. Se non è un socio, registra senza socio.`,
    )
  const amount = readAmountInput(input.amount)
  if (amount === null) return invalid('amount', "Scrivi l'importo in euro, per esempio 30.")
  const date = written(input.date)
  if (!isCalendarDate(date)) return invalid('date', 'Scrivi la data della contabile.')
  if (date > today) return invalid('date', 'La data non può essere nel futuro.')
  const method = input.method === 'cash' ? 'cash' : 'transfer'
  const reference = method === 'transfer' ? written(input.reference) : ''
  if (method === 'transfer' && !reference)
    return invalid('reference', 'Manca il riferimento del bonifico: lo trovi sulla contabile.')
  const collectedBy = method === 'cash' ? written(input.collectedBy) : ''
  if (method === 'cash' && !collectedBy) return invalid('collectedBy', 'Scrivi chi ha incassato.')
  const note = written(input.note)
  if (input.notADuplicate === true && !note) return invalid('note', 'Scrivi una nota, per esempio «quota di due anni».')
  return { member, amount, date, method, reference, collectedBy, note }
}

/** L'anno di validità; con «È un altro pagamento», il primo anno libero del socio da lì in avanti. */
function validYear(checked: Checked, input: PaymentInput, sheet: Sheet): number {
  const number = checked.member?.number ?? ''
  const member = { memberNumber: number, admittedOn: checked.member?.admittedOn ?? '' }
  const year = validYearFor(checked.date, isFirstQuota(member, checked.date, sheet.payments), sheet.settings.dues)
  return number && input.notADuplicate === true ? firstFreeYear(number, year, sheet.payments) : year
}

const ROLE_TEXT: Record<string, string> = {
  segretario: 'dal segretario',
  'segreteria part-time': 'dalla segreteria part-time',
  tesoriere: 'dal tesoriere',
}

/** «dal tesoriere», «dal libro soci», «da [nome]»: per il messaggio del possibile doppione. */
function recordedByText(payment: PaymentRow, access: readonly AccessRow[]): string {
  if (payment.method === 'register') return 'dal libro soci'
  const role = access.find((row) => row.person === payment.recordedBy)?.role
  if (role) return ROLE_TEXT[role] ?? `da ${payment.recordedBy}`
  return payment.recordedBy ? `da ${payment.recordedBy}` : 'senza il nome di chi l’ha registrato'
}

export function previewPayment(deps: OfficeDeps, input: PaymentInput): PreviewResult {
  return guard((): PreviewResult => {
    const access = readAccessRows(deps)
    const found = who(access, deps.email, input.person)
    if (found.kind !== 'ok') return noAccess(deps)
    const sheet = load(deps, access)
    const checked = checkFields(input, sheet, todayOf(deps))
    if ('kind' in checked) return checked
    return {
      kind: 'preview',
      validYear: validYear(checked, input, sheet),
      memberName: fullName(checked.member),
      hasEmail: Boolean(checked.member?.email),
      pending: !found.row.canRecord,
      leftOn: checked.member?.leftOn ?? '',
    }
  })
}

/** La riga entrata con la stessa chiave ha i dati di questa registrazione? «chi incassa» e la nota non contano. */
const sameData = (payment: PaymentRow, checked: Checked) =>
  payment.memberNumber === (checked.member?.number ?? '') &&
  payment.amount === checked.amount &&
  payment.date === checked.date &&
  payment.method === checked.method &&
  payment.reference === checked.reference

/** Lo stato di un pagamento nuovo: chi non ha «può registrare pagamenti» lo manda in attesa del tesoriere. */
const statusFor = (row: AccessRow): PaymentStatus => (row.canRecord ? 'recorded' : 'pendingTreasurer')

/**
 * La ricevuta al socio, se il pagamento conta e il socio ha la mail. `inGoodStanding` dice lo stato dopo il
 * pagamento: una quota di un anno passato non mette in regola.
 */
function sendReceipt(
  deps: OfficeDeps,
  member: MemberRow | undefined,
  payment: Omit<PaymentRow, 'index'>,
  settings: OfficeSettings,
  view: OfficeView,
): MailOutcome {
  if (!member || !countsTowardsDues(payment)) return 'none'
  if (!member.email) return 'noEmail'
  const status = view.members.find((candidate) => candidate.number === member.number)?.status ?? null
  try {
    deps.sendMail(
      receiptMail({
        firstName: member.firstName,
        email: member.email,
        payment,
        cashReceipt: settings.cashReceipt,
        inGoodStanding: status === 'inGoodStanding' || status === 'paidAhead',
      }),
    )
    return 'sent'
  } catch {
    // Il pagamento resta registrato: la pagina dice che la mail non è partita.
    return 'failed'
  }
}

export function recordPayment(deps: OfficeDeps, input: PaymentInput): RecordResult {
  return guard((): RecordResult => {
    const today = todayOf(deps)
    const access = readAccessRows(deps)
    const found = who(access, deps.email, input.person)
    if (found.kind !== 'ok') return noAccess(deps)
    const before = load(deps, access)
    const checked = checkFields(input, before, today)
    if ('kind' in checked) return checked
    const requestKey = written(input.requestKey)

    // Dentro il lucchetto si rilegge il registro: un'altra registrazione può essere entrata nel frattempo.
    const outcome = deps.withLock(() => {
      const sheet = load(deps)
      const again = requestKey ? sheet.payments.find((payment) => payment.requestKey === requestKey) : undefined
      // Con la stessa chiave e altri dati «registrato» mentirebbe: la pagina mostrerebbe un pagamento mai scritto.
      if (again && !sameData(again, checked)) {
        const name = fullName(sheet.members.find((member) => member.number === again.memberNumber)) || 'nessun socio'
        const message = `Questa registrazione è già entrata con altri dati: ${again.id}, ${euro(again.amount)} € per ${name}. Se era sbagliata, annullala dalla scheda del socio, poi registra di nuovo.`
        return { kind: 'error' as const, result: { kind: 'error' as const, message } }
      }
      if (again) return { kind: 'again' as const, payment: again }

      const year = validYear(checked, input, sheet)
      const number = checked.member?.number ?? ''
      if (number && input.notADuplicate !== true) {
        const candidate = { memberNumber: number, validYear: year, reference: checked.reference }
        const existing = findPossibleDuplicate(candidate, sheet.payments)
        const row = sheet.payments.find((payment) => payment === existing)
        if (row)
          return {
            kind: 'duplicate' as const,
            result: {
              kind: 'duplicate' as const,
              existing: officePayment(row),
              memberName: fullName(checked.member),
              recordedByText: recordedByText(row, sheet.access),
              yearIfAnother: firstFreeYear(number, year, sheet.payments),
            },
          }
      }

      const status = statusFor(found.row)
      const table = readTable(deps.workbook, SOCI_SHEETS.payments)
      const id = nextPaymentId(
        yearOf(today),
        sheet.payments.map((payment) => payment.id),
      )
      const payment: Omit<PaymentRow, 'index'> = {
        id,
        memberNumber: number,
        validYear: year,
        amount: checked.amount,
        date: checked.date,
        method: checked.method,
        reference: checked.reference,
        collectedBy: checked.collectedBy,
        recordedBy: found.row.person,
        account: normalizeEmail(deps.email),
        recordedOn: today,
        // Chi può confermare registra solo i contanti che ha in mano: nascono già ricevuti.
        cashReceivedOn: checked.method === 'cash' && found.row.canConfirm ? today : '',
        status,
        note: checked.note,
        requestKey,
      }
      deps.workbook.appendRow(
        table.spec.name,
        rowValues(table, {
          id,
          'numero socio': memberCell(number),
          "vale per l'anno": year,
          importo: payment.amount,
          data: payment.date,
          modo: paymentMethodCell(payment.method),
          riferimento: payment.reference,
          'chi incassa': payment.collectedBy,
          'registrato da': payment.recordedBy,
          account: payment.account,
          'registrato il': today,
          'contanti ricevuti il': payment.cashReceivedOn,
          stato: paymentStatusCell(status),
          'motivo o nota': payment.note,
          'chiave della registrazione': requestKey,
        }),
      )
      return { kind: 'new' as const, payment, settings: sheet.settings }
    })
    if (outcome.kind === 'duplicate' || outcome.kind === 'error') return outcome.result

    const { payment } = outcome
    const member = before.members.find((candidate) => candidate.number === payment.memberNumber)
    const after = load(deps)
    // I numeri su KV prima della vista, che dice se la pubblicazione è riuscita.
    if (outcome.kind === 'new') publishNumbers(deps, after)
    const view = buildView(deps, after, found.row, found.names)
    const status = view.members.find((candidate) => candidate.number === payment.memberNumber)?.status ?? null
    const mail = outcome.kind === 'new' ? sendReceipt(deps, member, payment, outcome.settings, view) : 'none'
    return {
      kind: 'recorded',
      payment: officePayment(payment),
      memberName: fullName(member),
      pending: payment.status === 'pendingTreasurer',
      status,
      mail,
      view,
    }
  })
}

type Change = { person: string; paymentId: string; reason?: string }

type Applied = {
  cells: Record<string, unknown>
  /** La ricevuta parte se, dopo il cambio, il pagamento conta e il socio ha la mail. */
  receipt?: boolean
}

type Rules = {
  /** Vuoto se la persona può fare il cambio; se no, il messaggio che dice a chi spetta. */
  allowed: (row: AccessRow) => string
  /** Il cambio vuole il motivo, che va nella nota. */
  needsReason: boolean
}

const RECORD_RULE: Rules = {
  allowed: (row) =>
    row.canRecord
      ? ''
      : 'Annullare un pagamento o cambiarne l’anno spetta a chi ha «può registrare pagamenti» in «Accessi».',
  needsReason: true,
}

const CONFIRM_RULE: Rules = {
  allowed: (row) =>
    row.canConfirm
      ? ''
      : 'Confermare un pagamento e segnare i contanti ricevuti spetta a chi ha «può confermare pagamenti» in «Accessi».',
  needsReason: false,
}

const ANYONE: Rules = { allowed: () => '', needsReason: false }

/**
 * Un cambio su un pagamento che c'è e non è annullato: i controlli di chi può, il lucchetto, le celle, la vista rifatta,
 * la ricevuta se il cambio la vuole, i numeri su KV. `line` scrive una riga per la nota: «Annullato il … da …: motivo».
 */
function changePayment(
  deps: OfficeDeps,
  input: Change,
  rules: Rules,
  apply: (payment: PaymentRow, line: (what: string) => string, sheet: Sheet, row: AccessRow) => Applied | InvalidField,
): ChangeResult {
  return guard((): ChangeResult => {
    const today = todayOf(deps)
    const access = readAccessRows(deps)
    const found = who(access, deps.email, input.person)
    if (found.kind !== 'ok') return noAccess(deps)
    const refused = rules.allowed(found.row)
    if (refused) return { kind: 'error', message: refused }
    const reason = written(input.reason)
    if (rules.needsReason && !reason) return invalid('reason', 'Scrivi il motivo.')
    const paymentId = written(input.paymentId)

    const outcome = deps.withLock(() => {
      const sheet = load(deps)
      const payment = sheet.payments.find((candidate) => candidate.id === paymentId)
      if (!payment) return invalid('payment', `Non trovo il pagamento ${paymentId}.`)
      if (payment.status === 'cancelled') return invalid('payment', `Il pagamento ${paymentId} è annullato.`)
      const line = (what: string) =>
        `${what} il ${italianDate(today)} da ${found.row.person}${reason ? `: ${reason}` : ''}`
      const change = apply(payment, line, sheet, found.row)
      if ('kind' in change) return change
      const table = readTable(deps.workbook, SOCI_SHEETS.payments)
      for (const [column, value] of Object.entries(change.cells))
        deps.workbook.setCell(table.spec.name, payment.index, columnOf(table, column), value)
      return { payment, receipt: change.receipt === true, settings: sheet.settings }
    })
    if ('kind' in outcome) return outcome
    const after = load(deps)
    publishNumbers(deps, after)
    const view = buildView(deps, after, found.row, found.names)
    const changed = after.payments.find((candidate) => candidate.id === outcome.payment.id)
    const member = after.members.find((candidate) => candidate.number === changed?.memberNumber)
    const mail = outcome.receipt && changed ? sendReceipt(deps, member, changed, outcome.settings, view) : 'none'
    return { kind: 'done', view, mail }
  })
}

const withLine = (note: string, line: string) => (note ? `${note}\n${line}` : line)

export function cancelPayment(deps: OfficeDeps, input: CancelInput): ChangeResult {
  return changePayment(deps, input, RECORD_RULE, (payment, line) => ({
    cells: { stato: paymentStatusCell('cancelled'), 'motivo o nota': withLine(payment.note, line('Annullato')) },
  }))
}

export function changePaymentYear(deps: OfficeDeps, input: ChangeYearInput): ChangeResult {
  const latest = yearOf(todayOf(deps)) + 5
  return changePayment(deps, input, RECORD_RULE, (payment, line, sheet) => {
    const year = input.validYear
    if (!(Number.isInteger(year) && year >= 2000 && year <= latest))
      return invalid('validYear', `Scegli un anno fra 2000 e ${latest}.`)
    if (year === payment.validYear) return invalid('validYear', `Il pagamento vale già per il ${year}.`)
    // Due pagamenti nello stesso anno lascerebbero scoperto, senza una parola, l'anno da cui si parte.
    const taken = payment.memberNumber
      ? sheet.payments.find(
          (other) =>
            other !== payment &&
            other.memberNumber === payment.memberNumber &&
            other.validYear === year &&
            other.status !== 'cancelled',
        )
      : undefined
    if (taken)
      return invalid(
        'validYear',
        `Il socio ha già un pagamento per il ${year} (${taken.id}): annullalo, o scegli un altro anno.`,
      )
    return {
      cells: {
        "vale per l'anno": year,
        'motivo o nota': withLine(payment.note, line(`Anno cambiato da ${payment.validYear} a ${year}`)),
      },
    }
  })
}

/**
 * «Conferma», sui pagamenti in attesa del tesoriere: da chi ha «può confermare pagamenti», mai su un pagamento
 * registrato da sé. Il pagamento conta da ora, e al socio parte la ricevuta.
 */
export function confirmPayment(deps: OfficeDeps, input: PaymentActionInput): ChangeResult {
  return changePayment(deps, input, CONFIRM_RULE, (payment, line, _sheet, row) => {
    if (payment.status !== 'pendingTreasurer')
      return invalid('payment', `Il pagamento ${payment.id} non è in attesa del tesoriere.`)
    if (payment.recordedBy === row.person)
      return invalid('payment', 'Un pagamento lo conferma una persona diversa da chi l’ha registrato.')
    return {
      cells: { stato: paymentStatusCell('recorded'), 'motivo o nota': withLine(payment.note, line('Confermato')) },
      receipt: true,
    }
  })
}

/** «Ricevuti», sui contanti da consegnare: da chi ha «può confermare pagamenti», anche su un pagamento suo. */
export function cashReceived(deps: OfficeDeps, input: PaymentActionInput): ChangeResult {
  return changePayment(deps, input, CONFIRM_RULE, (payment, line) => {
    if (payment.method !== 'cash') return invalid('payment', `Il pagamento ${payment.id} non è in contanti.`)
    if (payment.cashReceivedOn)
      return invalid(
        'payment',
        `I contanti di ${payment.id} sono già segnati ricevuti il ${italianDate(payment.cashReceivedOn)}.`,
      )
    return {
      cells: {
        'contanti ricevuti il': todayOf(deps),
        'motivo o nota': withLine(payment.note, line('Contanti ricevuti')),
      },
    }
  })
}

/**
 * «Abbina a un socio» un pagamento registrato senza socio. Conta subito solo se chi l'ha registrato e chi lo abbina
 * hanno «può registrare pagamenti»; se no va in attesa del tesoriere. L'anno di validità si rifà col socio.
 */
export function assignMember(deps: OfficeDeps, input: AssignMemberInput): ChangeResult {
  const memberNumber = written(input.memberNumber)
  return changePayment(deps, input, ANYONE, (payment, line, sheet, row) => {
    if (payment.memberNumber)
      return invalid('payment', `Il pagamento ${payment.id} ha già il socio n. ${payment.memberNumber}.`)
    const member = sheet.members.find((candidate) => candidate.number === memberNumber)
    if (!member) return invalid('member', `Nessun socio con il numero ${memberNumber}.`)
    const date = payment.date || todayOf(deps)
    const first = isFirstQuota({ memberNumber: member.number, admittedOn: member.admittedOn }, date, sheet.payments)
    const year = validYearFor(date, first, sheet.settings.dues)
    const duplicate = findPossibleDuplicate(
      { memberNumber, validYear: year, reference: payment.reference },
      sheet.payments,
    )
    if (duplicate)
      return invalid(
        'member',
        `${fullName(member)} ha già un pagamento per il ${year} (${duplicate.id}): annullalo, oppure scegli un altro socio.`,
      )
    const status: PaymentStatus = payment.status === 'recorded' && row.canRecord ? 'recorded' : 'pendingTreasurer'
    return {
      cells: {
        'numero socio': memberCell(memberNumber),
        "vale per l'anno": year,
        stato: paymentStatusCell(status),
        'motivo o nota': withLine(payment.note, line(`Abbinato al socio n. ${memberNumber}`)),
      },
      receipt: true,
    }
  })
}

/** La vista rifatta dopo un cambio fuori dal registro dei pagamenti (scadenze, libro soci). */
function viewAfter(
  deps: OfficeDeps,
  person: string,
  run: (row: AccessRow) => InvalidField | { kind: 'error'; message: string } | null,
): ChangeResult {
  return guard((): ChangeResult => {
    const access = readAccessRows(deps)
    const found = who(access, deps.email, person)
    if (found.kind !== 'ok') return noAccess(deps)
    const problem = run(found.row)
    if (problem) return problem
    return { kind: 'done', view: buildView(deps, load(deps, access), found.row, found.names), mail: 'none' }
  })
}

/** «Fatta» su una scadenza; per la misura del mese anche il numero in «Misure». */
export function deadlineDone(deps: OfficeDeps, input: DeadlineDoneInput): ChangeResult {
  return viewAfter(deps, input.person, () => {
    if (!deps.content)
      return { kind: 'error', message: 'Il Foglio contenuti non è collegato: le scadenze non si segnano da qui.' }
    const content = deps.content()
    const done = deps.withLock(() =>
      markDeadlineDone(content, {
        id: written(input.deadlineId),
        today: todayOf(deps),
        toCalendarDate: deps.toCalendarDate,
        measure: input.measure,
      }),
    )
    if (done.kind === 'invalid')
      return invalid(done.message.startsWith('Scrivi') ? 'measure' : 'deadline', done.message)
    return null
  })
}

/** «Salva nel Drive»: il libro soci di oggi. Se il Drive non risponde, «Oggi» lo dice. */
export function saveRegister(deps: OfficeDeps, input: SaveRegisterInput): ChangeResult {
  return viewAfter(deps, input.person, () => {
    if (!deps.registerStore)
      return { kind: 'error', message: 'Il Drive non è collegato: il libro soci non si salva da qui.' }
    const store = deps.registerStore
    const result = deps.withLock(() =>
      saveMemberRegister({
        workbook: deps.workbook,
        toCalendarDate: deps.toCalendarDate,
        today: todayOf(deps),
        store,
        state: deps.state,
      }),
    )
    return result.failedOn === todayOf(deps) && result.error
      ? { kind: 'error', message: `Il libro soci non è stato salvato: ${result.error}` }
      : null
  })
}

/**
 * L'estratto conto: le righe incollate o il CSV della banca vanno in «Estratto conto», tranne quelle che ci sono già;
 * poi l'abbinamento scrive «abbinato a» e «ignorato perché» su tutte le righe. Il motivo di «Non è una quota» resta
 * nella cella anche quando una cella rotta o la causale mettono la riga da parte per un altro perché: corretta la
 * cella, la riga torna fra quelle che non sono quote col suo motivo. Spetta a chi registra i pagamenti.
 */
export function importBank(deps: OfficeDeps, input: ImportBankInput): ImportResult {
  return guard((): ImportResult => {
    const access = readAccessRows(deps)
    const found = who(access, deps.email, input.person)
    if (found.kind !== 'ok') return noAccess(deps)
    if (!found.row.canRecord)
      return {
        kind: 'error',
        message: 'Importare l’estratto conto spetta a chi ha «può registrare pagamenti» in «Accessi».',
      }
    const parsed = parseBankText(typeof input.text === 'string' ? input.text : '')
    if (!parsed.length) return invalid('bank', 'Incolla le righe della banca, o il suo CSV.')
    const today = todayOf(deps)

    const counts = deps.withLock(() => {
      if (!deps.workbook.values(SOCI_SHEETS.bank.name))
        throw new ContentError(`Manca la scheda «${SOCI_SHEETS.bank.name}»: la crea setupSoci, dall’editor.`)
      const table = readTable(deps.workbook, SOCI_SHEETS.bank)
      const existing = readBankLines(table, deps.toCalendarDate)
      const sheet = load(deps)
      // `splitPasted`: reincollare lo stesso estratto non aggiunge niente, anche senza riferimento; una riga col
      // riferimento entra una volta sola, e due bonifici veri uguali senza riferimento nello stesso estratto entrano
      // tutti e due.
      const first = Math.max(0, ...existing.map((line) => line.index)) + 1
      const { fresh, alreadyPasted } = splitPasted(
        existing,
        parsed.map((line) => ({ ...line, index: 0, matchedTo: '', ignoredWhy: '' })),
      )
      const added = fresh.map((line, offset) => ({ ...line, index: first + offset }))
      const all = [...existing, ...added]
      const outcome = reconcile(all, sheet.payments.map(officePayment), { today })
      const matchedTo = new Map(outcome.matched.map((match) => [match.line.index, match.paymentIds.join(', ')]))
      const ignored = new Map(outcome.ignored.map(({ line, why }) => [line.index, why]))
      // Il motivo a mano vince sul perché dell'abbinamento solo nella cella: la pagina segue l'abbinamento.
      const cells = (line: BankLine) => ({
        matchedTo: matchedTo.get(line.index) ?? '',
        ignoredWhy: notDuesWhy(line) || (ignored.get(line.index) ?? ''),
      })
      for (const line of added) {
        const { matchedTo: to, ignoredWhy: why } = cells(line)
        deps.workbook.appendRow(
          table.spec.name,
          rowValues(table, {
            data: line.date,
            importo: line.amount ?? '',
            causale: line.reason,
            riferimento: line.reference,
            'abbinato a': to,
            'ignorato perché': why,
          }),
        )
      }
      for (const line of existing) {
        const { matchedTo: to, ignoredWhy: why } = cells(line)
        if (to !== line.matchedTo) deps.workbook.setCell(table.spec.name, line.index, columnOf(table, 'abbinato a'), to)
        if (why !== line.ignoredWhy)
          deps.workbook.setCell(table.spec.name, line.index, columnOf(table, 'ignorato perché'), why)
      }
      return {
        added: added.length,
        alreadyPasted: alreadyPasted.length,
        ignored: added.filter((line) => ignored.has(line.index)).length,
        matched: added.filter((line) => matchedTo.has(line.index)).length,
      }
    })
    return { kind: 'imported', ...counts, view: buildView(deps, load(deps, access), found.row, found.names) }
  })
}

/** Il motivo di «Non è una quota» sta in una cella, e la pagina lo mostra in un elenco: poche parole. */
export const NOT_DUES_REASON_MAX = 100

/**
 * «Non è una quota» su una riga della banca in «Da abbinare» (Raduno pagato insieme ad altro, donazioni, magliette,
 * bandi): il motivo va in «ignorato perché», e l'abbinamento la lascia da parte finché nessuno lo cancella dalla scheda.
 * La riga deve essere ancora quella mostrata dalla pagina, e ancora da abbinare: il motivo che un altro ha già scritto
 * non si sovrascrive, e lo stesso motivo una seconda volta non cambia niente. Spetta a chi registra i pagamenti.
 */
export function ignoreBankLine(deps: OfficeDeps, input: IgnoreBankLineInput): ChangeResult {
  return viewAfter(deps, input.person, (row) => {
    if (!row.canRecord)
      return {
        kind: 'error',
        message: 'Segnare le righe dell’estratto conto spetta a chi ha «può registrare pagamenti» in «Accessi».',
      }
    const reason = written(input.reason)
    if (!reason) return invalid('reason', 'Scrivi il motivo, per esempio «donazione» o «magliette».')
    if (reason.length > NOT_DUES_REASON_MAX)
      return invalid('reason', `Bastano poche parole: al massimo ${NOT_DUES_REASON_MAX} segni.`)
    if (isAutoReason(reason))
      return invalid(
        'reason',
        'Queste parole le scrive la Bussola da sola, e le ricalcola a ogni importazione: scrivi il motivo con parole tue, per esempio «Raduno».',
      )
    const shown = input.line
    return deps.withLock(() => {
      if (!deps.workbook.values(SOCI_SHEETS.bank.name))
        throw new ContentError(`Manca la scheda «${SOCI_SHEETS.bank.name}»: la crea setupSoci, dall’editor.`)
      const table = readTable(deps.workbook, SOCI_SHEETS.bank)
      const lines = readBankLines(table, deps.toCalendarDate)
      const line = lines.find((candidate) => candidate.index === shown?.index)
      // La stessa identità con cui l'importazione riconosce le righe già incollate: data, importo, causale, riferimento.
      const same =
        line &&
        bankLineKey(line) ===
          bankLineKey({
            ...line,
            date: written(shown.date) as CalendarDate,
            amount: typeof shown.amount === 'number' ? shown.amount : null,
            reason: typeof shown.reason === 'string' ? shown.reason : '',
            reference: typeof shown.reference === 'string' ? shown.reference : '',
          })
      if (!line || !same)
        return {
          kind: 'error',
          message: 'Questa riga dell’estratto conto è cambiata nel Foglio: torna a Pagamenti e riprova.',
        }
      // Segretario, segreteria e tesoriere registrano tutti: una pagina vecchia può mostrare una riga già segnata.
      const already = notDuesWhy(line)
      if (already === reason) return null
      if (already) return { kind: 'error', message: `Questa riga è già segnata: «${already}». Torna a Pagamenti.` }
      const outcome = reconcile(lines, load(deps).payments.map(officePayment), { today: todayOf(deps) })
      const toMatch = outcome.toMatch.some(
        (item) => item.kind === 'bankWithoutPayment' && item.line.index === line.index,
      )
      if (!toMatch) return { kind: 'error', message: 'Questa riga non è più da abbinare: torna a Pagamenti.' }
      deps.workbook.setCell(table.spec.name, line.index, columnOf(table, 'ignorato perché'), reason)
      if (line.matchedTo) deps.workbook.setCell(table.spec.name, line.index, columnOf(table, 'abbinato a'), '')
      return null
    })
  })
}
