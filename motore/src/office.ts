// La pagina della segreteria, lato motore (ADR 0002, flusso D): chi entra, la vista di Soci e «Oggi», l'anteprima, la
// registrazione di un pagamento, l'annullamento e il cambio d'anno. Le regole delle quote stanno in `dues` (condiviso).
// Tutto entra come parametro, così si prova in Node; in Apps Script le giunture le fa google.ts. Fra le giunture non
// c'è KV: la segreteria registra anche con la vetrina ferma.
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
  validYearFor,
  type CalendarDate,
  type PaymentStatus,
} from '@bussola/condiviso'
import { recentAccessChanges } from './access-log.ts'
import {
  columnOf,
  ContentError,
  readAmount,
  readTable,
  rowValues,
  type ToCalendarDate,
  type Workbook,
} from './content.ts'
import {
  memberCell,
  paymentMethodCell,
  paymentStatusCell,
  readAccess,
  readMembers,
  readOfficeSettings,
  readPayments,
  SOCI_SHEETS,
  type AccessRow,
  type MemberRow,
  type OfficeSettings,
  type PaymentRow,
} from './members.ts'
import type {
  CancelInput,
  ChangeResult,
  ChangeYearInput,
  InvalidField,
  OfficeMember,
  OfficeOpenResult,
  OfficePayment,
  OfficeView,
  PaymentInput,
  PreviewResult,
  RecordResult,
} from './office-api.ts'
import type { PublishState } from './publish.ts'
import { euro, italianDate, receiptMail, type Mail } from './receipt.ts'
import { readSharingReport } from './sharing.ts'

export type OfficeDeps = {
  /** Il Foglio «Bussola · soci». */
  workbook: Workbook
  /** L'account di chi usa la pagina (`Session.getActiveUser()`): vuoto se Google non lo dà. */
  email: string
  now: Date
  toCalendarDate: ToCalendarDate
  /** Data e ora nel fuso di Roma, per il «Registro di Accessi». */
  formatInstant: (instant: Date) => string
  /** Esegue dentro il lucchetto dello script; se non lo prende, lancia un `ContentError` da riprovare. */
  withLock: <T>(run: () => T) => T
  sendMail: (mail: Mail) => void
  /** Le proprietà dello script, dove il controllo di ogni giorno salva le condivisioni. */
  state: Pick<PublishState, 'get'>
}

type Sheet = {
  access: AccessRow[]
  settings: OfficeSettings
  members: MemberRow[]
  payments: PaymentRow[]
}

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
  status: payment.status,
  note: payment.note,
})

/** Dal più recente: l'anno di validità, poi la data, poi l'id. */
const newestFirst = (a: PaymentRow, b: PaymentRow) =>
  b.validYear - a.validYear || b.date.localeCompare(a.date) || b.id.localeCompare(a.id)

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
  const isSecretary = row.role === 'segretario'
  let todayForSecretary: OfficeView['todayForSecretary'] = null
  if (isSecretary) {
    const sharing = readSharingReport(deps.state)
    todayForSecretary = {
      accessChanges: recentAccessChanges(
        readTable(deps.workbook, SOCI_SHEETS.accessLog),
        today,
        deps.toCalendarDate,
        deps.formatInstant,
      ),
      sharingCheckedOn: sharing.checkedOn,
      sharing: sharing.findings,
    }
  }
  return {
    today,
    year: yearOf(today),
    person: row.person,
    names,
    canRecord: row.canRecord,
    isSecretary,
    amount: sheet.settings.dues.amount,
    instructionsUrl: sheet.settings.instructionsUrl,
    counts: memberCounts(members.map((member) => member.status)),
    members,
    todayForSecretary,
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
        // Chi può confermare registra solo i contanti che ha in mano: nascono già ricevuti (la regola è di T4).
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
    const view = buildView(deps, load(deps), found.row, found.names)
    const status = view.members.find((candidate) => candidate.number === payment.memberNumber)?.status ?? null
    let mail: 'sent' | 'noEmail' | 'failed' | 'none' = 'none'
    if (outcome.kind === 'new' && member && countsTowardsDues(payment)) {
      mail = member.email ? 'sent' : 'noEmail'
      if (member.email)
        try {
          deps.sendMail(
            receiptMail({
              firstName: member.firstName,
              email: member.email,
              payment,
              cashReceipt: outcome.settings.cashReceipt,
              inGoodStanding: status === 'inGoodStanding' || status === 'paidAhead',
            }),
          )
        } catch {
          // Il pagamento resta registrato: la pagina dice che la mail non è partita.
          mail = 'failed'
        }
    }
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

type Change = { person: string; paymentId: string; reason: string; validYear?: number }

/** Annullare e cambiare l'anno: stessi controlli, una riga in più in «motivo o nota». */
function changePayment(
  deps: OfficeDeps,
  input: Change,
  apply: (
    payment: PaymentRow,
    line: (what: string) => string,
    sheet: Sheet,
  ) => { cells: Record<string, unknown> } | InvalidField,
): ChangeResult {
  return guard((): ChangeResult => {
    const today = todayOf(deps)
    const access = readAccessRows(deps)
    const found = who(access, deps.email, input.person)
    if (found.kind !== 'ok') return noAccess(deps)
    if (!found.row.canRecord)
      return {
        kind: 'error',
        message: 'Annullare un pagamento o cambiarne l’anno spetta a chi ha «può registrare pagamenti» in «Accessi».',
      }
    const reason = written(input.reason)
    if (!reason) return invalid('reason', 'Scrivi il motivo.')
    const paymentId = written(input.paymentId)

    const outcome = deps.withLock(() => {
      const sheet = load(deps)
      const payment = sheet.payments.find((candidate) => candidate.id === paymentId)
      if (!payment) return invalid('payment', `Non trovo il pagamento ${paymentId}.`)
      if (payment.status === 'cancelled') return invalid('payment', `Il pagamento ${paymentId} è annullato.`)
      const line = (what: string) => `${what} il ${italianDate(today)} da ${found.row.person}: ${reason}`
      const change = apply(payment, line, sheet)
      if ('kind' in change) return change
      const table = readTable(deps.workbook, SOCI_SHEETS.payments)
      for (const [column, value] of Object.entries(change.cells))
        deps.workbook.setCell(table.spec.name, payment.index, columnOf(table, column), value)
      return null
    })
    if (outcome) return outcome
    return { kind: 'done', view: buildView(deps, load(deps), found.row, found.names) }
  })
}

const withLine = (note: string, line: string) => (note ? `${note}\n${line}` : line)

export function cancelPayment(deps: OfficeDeps, input: CancelInput): ChangeResult {
  return changePayment(deps, input, (payment, line) => ({
    cells: { stato: paymentStatusCell('cancelled'), 'motivo o nota': withLine(payment.note, line('Annullato')) },
  }))
}

export function changePaymentYear(deps: OfficeDeps, input: ChangeYearInput): ChangeResult {
  const latest = yearOf(todayOf(deps)) + 5
  return changePayment(deps, input, (payment, line, sheet) => {
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
