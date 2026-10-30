import { matchesFilter, MEMBER_STATUSES, MEMBERS_KEY, romeDate, type MemberFilter } from '@bussola/condiviso'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { readTable, SHEETS } from './content.ts'
import { DEMO_EMAILS, demoSheets } from './demo.ts'
import {
  DEMO_INSTRUCTIONS_URL,
  DEMO_OFFICE,
  DEMO_SHARED_ACCOUNT,
  DEMO_SOCI_COUNTS,
  DEMO_SOCI_NOW,
  demoSociSheets,
} from './demo-soci.ts'
import { SOCI_SHEETS } from './members.ts'
import { MEMBERS_PUBLICATION_KEY } from './members-snapshot.ts'
import { memoryKv, memoryState, memoryWorkbook } from './memory.ts'
import {
  assignMember,
  cancelPayment,
  cashReceived,
  changePaymentYear,
  confirmPayment,
  deadlineDone,
  ignoreBankLine,
  importBank,
  LAST_RECORDING_DAYS,
  openOffice,
  previewPayment,
  recordPayment,
  saveRegister,
  type OfficeDeps,
} from './office.ts'
import type { OfficeView, PaymentInput } from './office-api.ts'
import type { Mail } from './receipt.ts'
import { REGISTER_STATE_KEY, type RegisterStore } from './register.ts'
import { SHARING_STATE_KEY } from './sharing.ts'

const formatInstant = (instant: Date) =>
  new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' }).format(instant)

const sha256Hex = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

type Setup = {
  email?: string
  sheets?: Record<string, unknown[][]>
  mailFails?: boolean
  /** Il Foglio contenuti; `null` per una segreteria senza. */
  content?: Record<string, unknown[][]> | null
  kvDown?: boolean
  driveFails?: boolean
}

function office({
  email = DEMO_EMAILS.office,
  sheets = demoSociSheets(),
  mailFails = false,
  content = demoSheets(DEMO_SOCI_NOW),
  kvDown = false,
  driveFails = false,
}: Setup = {}) {
  const workbook = memoryWorkbook(sheets)
  const contentWorkbook = content ? memoryWorkbook(content) : null
  const kv = memoryKv()
  kv.down = kvDown
  const drive: { name: string; rows: unknown[][] }[] = []
  const registerStore: RegisterStore = {
    save(name, rows) {
      if (driveFails) throw new Error('Drive non risponde')
      drive.push({ name, rows })
      return `https://docs.google.com/spreadsheets/d/libro-${drive.length}/edit`
    },
  }
  // Ogni scrittura, per scheda: «Accessi» non la scrive nessuno.
  const writes: string[] = []
  const mails: Mail[] = []
  let locks = 0
  const state = memoryState()
  const deps: OfficeDeps = {
    workbook: {
      values: workbook.values,
      setCell: (sheet, row, column, value) => (writes.push(sheet), workbook.setCell(sheet, row, column, value)),
      appendRow: (sheet, values) => (writes.push(sheet), workbook.appendRow(sheet, values)),
    },
    content: contentWorkbook ? () => contentWorkbook : null,
    email,
    now: DEMO_SOCI_NOW,
    toCalendarDate: romeDate,
    formatInstant,
    withLock: (run) => {
      locks++
      return run()
    },
    sendMail: (mail) => {
      if (mailFails) throw new Error('Limite di invio raggiunto')
      mails.push(mail)
    },
    state,
    kv,
    scope: 'prova',
    sha256Hex,
    registerStore,
  }
  return { deps, sheets, content: contentWorkbook, writes, mails, state, kv, drive, locks: () => locks }
}

const viewOf = (result: { kind: string; view?: OfficeView }): OfficeView => {
  if (!result.view) throw new Error(`nessuna vista: ${JSON.stringify(result)}`)
  return result.view
}
const open = (setup: Setup = {}, person = '') => openOffice(office(setup).deps, person)
const statusOf = (view: OfficeView, number: string) => view.members.find((member) => member.number === number)?.status
const paymentRows = (sheets: Record<string, unknown[][]>) => (sheets[SOCI_SHEETS.payments.name] ?? []).slice(1)
const cell = (row: unknown[] | undefined, column: string) =>
  row?.[SOCI_SHEETS.payments.columns.indexOf(column as never)]

const input = (change: Partial<PaymentInput> = {}): PaymentInput => ({
  requestKey: 'schermo-1',
  person: '',
  memberNumber: '18',
  amount: '30',
  method: 'transfer',
  date: '2026-11-03',
  reference: '9001',
  collectedBy: '',
  note: '',
  notADuplicate: false,
  ...change,
})

describe('chi entra', () => {
  it('senza account, con un account fuori da «Accessi» o con «entra» no: nessun accesso, nessun dato', () => {
    // Solo la mail di chi guarda, perché la pagina gli dica con quale account è entrato.
    expect(open({ email: '' })).toEqual({ kind: 'noAccess', email: '' })
    expect(open({ email: ' Curioso@example.org' })).toEqual({ kind: 'noAccess', email: 'curioso@example.org' })
    expect(open({ email: 'dario.conti@example.org' })).toEqual({ kind: 'noAccess', email: 'dario.conti@example.org' })
  })

  it('con «entra» sì ma senza uno dei tre ruoli non si entra: si vedrebbe tutta l’anagrafica', () => {
    for (const role of ['', 'presidente']) {
      const sheets = demoSociSheets()
      sheets[SOCI_SHEETS.access.name]?.push(['Ospite', 'ospite@example.org', role, 'sì', 'sì', 'sì'])
      const none = { kind: 'noAccess', email: 'ospite@example.org' }
      expect(open({ sheets, email: 'ospite@example.org' }), role).toEqual(none)
      expect(recordPayment(office({ sheets, email: 'ospite@example.org' }).deps, input()), role).toEqual(none)
    }
  })

  it('un account con una persona sola entra come lei, senza maiuscole e spazi', () => {
    const view = viewOf(open({ email: ' Segreteria@Example.org' }))
    expect(view).toMatchObject({
      person: DEMO_OFFICE.secretary,
      names: [DEMO_OFFICE.secretary],
      isSecretary: true,
      canRecord: true,
    })
  })

  it('un account condiviso chiede «Chi sei?» coi nomi; con un nome dei suoi entra come lui', () => {
    expect(open({ email: DEMO_SHARED_ACCOUNT })).toEqual({
      kind: 'whoAreYou',
      names: [DEMO_OFFICE.partTime, DEMO_OFFICE.treasurer],
    })
    expect(open({ email: DEMO_SHARED_ACCOUNT }, DEMO_OFFICE.secretary)).toMatchObject({ kind: 'whoAreYou' })
    const view = viewOf(open({ email: DEMO_SHARED_ACCOUNT }, DEMO_OFFICE.partTime))
    expect(view).toMatchObject({ person: DEMO_OFFICE.partTime, isSecretary: false, canRecord: false })
    expect(view.names).toEqual([DEMO_OFFICE.partTime, DEMO_OFFICE.treasurer])
  })

  it('le altre chiamate rifanno il controllo: senza la persona giusta non registrano', () => {
    const { deps, sheets } = office({ email: DEMO_SHARED_ACCOUNT })
    const none = { kind: 'noAccess', email: DEMO_SHARED_ACCOUNT }
    expect(recordPayment(deps, input({ person: '' }))).toEqual(none)
    expect(recordPayment(deps, input({ person: DEMO_OFFICE.secretary }))).toEqual(none)
    expect(previewPayment(deps, input({ person: 'Chiunque' }))).toEqual(none)
    expect(cancelPayment(deps, { person: '', paymentId: 'P-2026-0001', reason: 'x' })).toEqual(none)
    expect(paymentRows(sheets)).toHaveLength(30)
  })

  it('chi non entra non vede nemmeno gli errori del Foglio, che possono citare dei dati', () => {
    const sheets = demoSociSheets()
    sheets[SOCI_SHEETS.members.name]?.push([1, 'Doppio', 'Numero', 'doppio@example.org'])
    const none = { kind: 'noAccess', email: 'curioso@example.org' }
    expect(open({ sheets, email: 'curioso@example.org' })).toEqual(none)
    const { deps } = office({ sheets, email: 'curioso@example.org' })
    expect(recordPayment(deps, input())).toEqual(none)
    expect(open({ sheets })).toMatchObject({ kind: 'error', message: expect.stringContaining('il numero 1 c’è già') })
  })

  it('un id di pagamento ripetuto ferma tutto, e lo dice solo a chi è in «Accessi»', () => {
    const sheets = demoSociSheets()
    const copied = sheets[SOCI_SHEETS.payments.name]?.[3]
    sheets[SOCI_SHEETS.payments.name]?.push([...(copied ?? [])])
    expect(open({ sheets, email: 'curioso@example.org' })).toEqual({ kind: 'noAccess', email: 'curioso@example.org' })
    expect(open({ sheets })).toEqual({
      kind: 'error',
      message: '«Pagamenti», riga 32: il numero P-2024-0003 c’è già alla riga 4.',
    })
  })

  it('un Foglio scritto male diventa un errore in italiano', () => {
    const sheets = demoSociSheets()
    sheets[SOCI_SHEETS.settings.name]?.push(['importo della quota', 'trenta'])
    sheets[SOCI_SHEETS.settings.name]?.splice(4, 1)
    const result = open({ sheets })
    expect(result).toMatchObject({ kind: 'error' })
    expect(result.kind === 'error' && result.message).toMatch(/«importo della quota» vale «trenta»/)
  })
})

describe('la vista', () => {
  const view = viewOf(open())

  it('i numeri tornano col conto fatto a mano, e la loro somma è il totale dei soci non receduti', () => {
    expect(view.counts).toEqual(DEMO_SOCI_COUNTS)
    const { inGoodStanding, paidAhead, dueForRenewal, notInGoodStanding, members } = view.counts
    expect(inGoodStanding + paidAhead + dueForRenewal + notInGoodStanding).toBe(members)
    expect(view.members).toHaveLength(20)
  })

  it('ogni socio ha uno stato solo, quello del conto a mano', () => {
    const expected: Record<string, string> = {
      '5': 'left',
      '7': 'paidAhead',
      '8': 'paidAhead',
      '2': 'dueForRenewal',
      '9': 'dueForRenewal',
      '10': 'dueForRenewal',
      '18': 'dueForRenewal',
      '4': 'notInGoodStanding',
      '17': 'notInGoodStanding',
    }
    for (const member of view.members) {
      expect(MEMBER_STATUSES).toContain(member.status)
      expect(member.status, member.number).toBe(expected[member.number] ?? 'inGoodStanding')
    }
  })

  it('i filtri Tutti, In regola e Da rinnovare tornano col conto fatto a mano', () => {
    const count = (filter: MemberFilter) => view.members.filter((member) => matchesFilter(member.status, filter)).length
    expect([count('all'), count('inGoodStanding'), count('dueForRenewal')]).toEqual([20, 11, 4])
  })

  it('i soci per cognome e nome; i pagamenti dal più recente, annullati compresi', () => {
    const names = view.members.map((member) => `${member.lastName} ${member.firstName}`)
    expect(names.slice(10, 14)).toEqual(['Marino Elena', 'Moretti Fabio', 'Neri Giulia', 'Neri Tommaso'])
    const pace = view.members.find((member) => member.number === '16')
    expect(pace?.payments.map((payment) => payment.id)).toEqual(['P-2026-0012', 'P-2026-0011'])
    const leone = view.members.find((member) => member.number === '9')
    expect(leone?.payments.map((payment) => [payment.id, payment.status])).toEqual([
      ['P-2026-0006', 'cancelled'],
      ['P-2025-0004', 'recorded'],
    ])
    expect(leone).toMatchObject({ email: 'chiara.leone@example.org', type: 'supporter', admittedOn: '2020-03-14' })
  })

  it('importo e link alle istruzioni dalle impostazioni', () => {
    expect(view).toMatchObject({ today: '2026-11-05', year: 2026, amount: 30, instructionsUrl: DEMO_INSTRUCTIONS_URL })
  })

  it('è JSON semplice: google.script.run la restituisce uguale', () => {
    expect(JSON.parse(JSON.stringify(view))).toEqual(view)
  })

  it('«Oggi» del segretario: i cambi di «Accessi» degli ultimi 30 giorni e l’ultimo controllo delle condivisioni', () => {
    expect(view.dashboard.access).toEqual({
      accessChanges: [
        {
          when: formatInstant(new Date('2026-10-26T15:40:00Z')),
          who: DEMO_EMAILS.office,
          cells: 'A4:F4',
          before: '',
          after: `Ugo Bassi · ${DEMO_SHARED_ACCOUNT}`,
        },
      ],
      sharingCheckedOn: '',
      sharing: [],
    })
    const { deps, state } = office()
    const finding = { where: 'il Foglio soci', account: 'curioso@example.org', access: 'lettura' }
    state.set(SHARING_STATE_KEY, JSON.stringify({ checkedOn: '2026-11-05', findings: [finding] }))
    expect(viewOf(openOffice(deps, '')).dashboard.access).toMatchObject({
      sharingCheckedOn: '2026-11-05',
      sharing: [finding],
    })
  })

  it('per chi non è il segretario «Oggi» non ha le voci di «Accessi», ma ha il resto', () => {
    const treasurer = viewOf(open({ email: DEMO_SHARED_ACCOUNT }, DEMO_OFFICE.treasurer))
    expect(treasurer.dashboard.access).toBeNull()
    expect(treasurer.dashboard.pendingTreasurer).toHaveLength(1)
    expect(treasurer).toMatchObject({ canConfirm: true, canRecord: true })
  })
})

describe('l’anteprima', () => {
  const preview = (change: Partial<PaymentInput>, setup: Setup = {}) =>
    previewPayment(office(setup).deps, input(change))

  it('per un socio receduto porta la data del recesso, perché la pagina lo dica prima di registrare', () => {
    expect(preview({ memberNumber: '5' })).toMatchObject({ kind: 'preview', leftOn: '2026-06-30' })
    expect(preview({ memberNumber: '18' })).toMatchObject({ kind: 'preview', leftOn: '' })
  })

  it('un socio con la quota 2025 che paga il 20/10/2026 è in regola per il 2026; un nuovo socio per il 2027', () => {
    expect(preview({ memberNumber: '18', date: '2026-10-20' })).toEqual({
      kind: 'preview',
      validYear: 2026,
      memberName: 'Elisa Santoro',
      hasEmail: true,
      pending: false,
      leftOn: '',
    })
    expect(preview({ memberNumber: '17', date: '2026-10-20' })).toMatchObject({ validYear: 2027 })
    expect(preview({ memberNumber: '', date: '2026-10-20' })).toMatchObject({ validYear: 2027, memberName: '' })
  })

  it('un socio ammesso anni fa, senza quote nel registro, che paga il 20/10/2026 rinnova per il 2026', () => {
    const sheets = demoSociSheets()
    const [header, ...members] = sheets[SOCI_SHEETS.members.name] ?? []
    const riva = members.find((row) => row[header?.indexOf('numero') ?? 0] === 17)
    if (riva) riva[header?.indexOf('ammesso il') ?? 0] = '2020-03-14'
    expect(preview({ memberNumber: '17', date: '2026-10-20' }, { sheets })).toMatchObject({ validYear: 2026 })
  })

  it('con «la regola di ottobre vale anche per chi rinnova in ritardo» a sì, il rinnovo tardivo vale per il 2027', () => {
    const sheets = demoSociSheets()
    const settings = sheets[SOCI_SHEETS.settings.name] ?? []
    const rule = settings.find((row) => String(row[0]).startsWith('la regola di ottobre'))
    if (rule) rule[1] = 'sì'
    expect(preview({ memberNumber: '18', date: '2026-10-20' }, { sheets })).toMatchObject({ validYear: 2027 })
  })

  it('un nuovo socio del 14/10 vale per l’anno in corso, del 15/10 per l’anno dopo; il giorno si cambia', () => {
    expect(preview({ memberNumber: '17', date: '2026-10-14' })).toMatchObject({ validYear: 2026 })
    expect(preview({ memberNumber: '17', date: '2026-10-15' })).toMatchObject({ validYear: 2027 })
    const sheets = demoSociSheets()
    const day = (sheets[SOCI_SHEETS.settings.name] ?? []).find((row) => row[0] === 'giorno di cambio anno')
    if (day) day[1] = '1 ottobre'
    expect(preview({ memberNumber: '17', date: '2026-10-05' }, { sheets })).toMatchObject({ validYear: 2027 })
  })

  it('dice se il socio non ha la mail e se il pagamento va in attesa del tesoriere; non scrive niente', () => {
    expect(preview({ memberNumber: '15' })).toMatchObject({ hasEmail: false, pending: false })
    const { deps, writes } = office({ email: DEMO_SHARED_ACCOUNT })
    expect(previewPayment(deps, input({ person: DEMO_OFFICE.partTime }))).toMatchObject({ pending: true })
    expect(writes).toEqual([])
  })

  it('non controlla il doppione, ma fa gli stessi controlli dei campi', () => {
    expect(preview({ memberNumber: '1', date: '2026-03-01' })).toMatchObject({ kind: 'preview', validYear: 2026 })
    expect(preview({ amount: '0' })).toMatchObject({ kind: 'invalid', field: 'amount' })
  })
})

describe('la registrazione', () => {
  it('un bonifico: id P-AAAA-NNNN, la riga nel registro, il socio in regola, la mail', () => {
    const { deps, sheets, mails } = office()
    const result = recordPayment(deps, input())
    expect(result).toMatchObject({
      kind: 'recorded',
      payment: {
        id: 'P-2026-0016',
        memberNumber: '18',
        validYear: 2026,
        amount: 30,
        date: '2026-11-03',
        method: 'transfer',
        reference: '9001',
        recordedBy: DEMO_OFFICE.secretary,
        recordedOn: '2026-11-05',
        status: 'recorded',
      },
      memberName: 'Elisa Santoro',
      pending: false,
      status: 'inGoodStanding',
      mail: 'sent',
    })
    expect(statusOf(viewOf(result), '18')).toBe('inGoodStanding')
    const row = paymentRows(sheets).at(-1)
    expect(row).toEqual([
      'P-2026-0016',
      18,
      2026,
      30,
      '2026-11-03',
      'bonifico',
      '9001',
      '',
      DEMO_OFFICE.secretary,
      DEMO_EMAILS.office,
      '2026-11-05',
      '',
      'registrato',
      '',
      'schermo-1',
    ])
    expect(mails).toEqual([
      {
        to: 'elisa.santoro@example.org',
        name: 'Segreteria RAMI',
        replyTo: 'segreteria@retemicrofarm.it',
        subject: 'Quota ricevuta, sei in regola',
        body: expect.stringContaining(
          'quota di 30 € per il 2026: bonifico del 03/11/2026, rif. 9001.\nNumero del pagamento: P-2026-0016.',
        ),
      },
    ])
  })

  it('la conferma e la ricevuta dicono lo stato vero: una quota di un anno passato non mette in regola', () => {
    const { deps, mails } = office()
    const result = recordPayment(deps, input({ memberNumber: '4', date: '2025-12-01', reference: '7001' }))
    expect(result).toMatchObject({ kind: 'recorded', payment: { validYear: 2025 }, status: 'dueForRenewal' })
    expect(mails.map((mail) => mail.subject)).toEqual(['Quota ricevuta'])
  })

  it('un socio receduto: il pagamento si registra, la conferma lo dice, la ricevuta non dice «sei in regola»', () => {
    const { deps, mails } = office()
    const result = recordPayment(deps, input({ memberNumber: '5', reference: '7002' }))
    expect(result).toMatchObject({ kind: 'recorded', status: 'left', mail: 'sent' })
    expect(mails.map((mail) => mail.subject)).toEqual(['Quota ricevuta'])
  })

  it('l’importo si legge anche con la virgola o il punto', () => {
    for (const amount of ['30,50', '30.50', ' 30,5 €']) {
      const result = recordPayment(office().deps, input({ amount }))
      expect(result.kind === 'recorded' && result.payment.amount, amount).toBe(30.5)
    }
  })

  it('il doppio tocco: la stessa registrazione ripetuta vale una, una riga e una mail', () => {
    const { deps, sheets, mails, locks } = office()
    const first = recordPayment(deps, input())
    const second = recordPayment(deps, input())
    expect(second).toMatchObject({ kind: 'recorded', mail: 'none' })
    expect(second.kind === 'recorded' && second.payment).toEqual(first.kind === 'recorded' && first.payment)
    expect(paymentRows(sheets)).toHaveLength(31)
    expect(mails).toHaveLength(1)
    expect(locks()).toBe(2)
    const third = recordPayment(deps, input({ requestKey: 'schermo-2', memberNumber: '17' }))
    expect(third.kind === 'recorded' && third.payment.id).toBe('P-2026-0017')
  })

  it('la stessa chiave con altri dati non dice «registrato»: dice cosa è entrato e come rimediare', () => {
    const { deps, sheets, mails } = office()
    recordPayment(deps, input())
    const changes: Partial<PaymentInput>[] = [
      { amount: '60' },
      { memberNumber: '17' },
      { date: '2026-11-02' },
      { reference: '9002' },
      { method: 'cash', reference: '', collectedBy: 'Ugo Bassi' },
    ]
    for (const change of changes)
      expect(recordPayment(deps, input(change)), JSON.stringify(change)).toEqual({
        kind: 'error',
        message:
          'Questa registrazione è già entrata con altri dati: P-2026-0016, 30 € per Elisa Santoro. Se era sbagliata, annullala dalla scheda del socio, poi registra di nuovo.',
      })
    expect(paymentRows(sheets)).toHaveLength(31)
    expect(mails).toHaveLength(1)
    // Gli stessi dati scritti in un altro modo sono la stessa registrazione.
    expect(recordPayment(deps, input({ amount: '30,00 €', reference: ' 9001 ' }))).toMatchObject({ kind: 'recorded' })
  })

  it('un possibile doppione, stesso socio e stesso anno, si ferma subito e non scrive niente', () => {
    const { deps, sheets, writes } = office()
    expect(recordPayment(deps, input({ memberNumber: '1', date: '2026-03-01', reference: '7777' }))).toEqual({
      kind: 'duplicate',
      existing: expect.objectContaining({ id: 'P-2026-0001', validYear: 2026 }),
      memberName: 'Lucia Abate',
      recordedByText: 'dal segretario',
      yearIfAnother: 2027,
    })
    expect(paymentRows(sheets)).toHaveLength(30)
    expect(writes).toEqual([])
  })

  it('un possibile doppione per lo stesso riferimento, con un anno diverso', () => {
    const result = recordPayment(office().deps, input({ memberNumber: '7', date: '2026-03-01', reference: '60004' }))
    expect(result).toMatchObject({ kind: 'duplicate', existing: { id: 'P-2026-0004', validYear: 2027 } })
  })

  it('chi l’ha registrato: il tesoriere, il libro soci, oppure il nome', () => {
    const duplicateOf = (memberNumber: string, date: string, method: 'transfer' | 'cash' = 'transfer') => {
      const result = recordPayment(
        office().deps,
        input({ memberNumber, date, method, reference: method === 'cash' ? '' : '1', collectedBy: 'Ugo Bassi' }),
      )
      return result.kind === 'duplicate' ? result.recordedByText : result.kind
    }
    expect(duplicateOf('6', '2026-11-01', 'cash')).toBe('dal tesoriere')
    expect(duplicateOf('11', '2026-11-01')).toBe('dal libro soci')
    expect(duplicateOf('19', '2024-05-01')).toBe('da Franco Neri')
  })

  it('lo stesso riferimento per due soci diversi non è mai un doppione', () => {
    const result = recordPayment(office().deps, input({ memberNumber: '18', reference: '55001' }))
    expect(result).toMatchObject({ kind: 'recorded' })
  })

  it('«È un altro pagamento» vuole la nota, e registra per il primo anno libero con la nota', () => {
    const { deps, sheets } = office()
    const another = input({ memberNumber: '1', date: '2026-03-01', notADuplicate: true })
    expect(recordPayment(deps, another)).toEqual({
      kind: 'invalid',
      field: 'note',
      message: 'Scrivi una nota, per esempio «quota di due anni».',
    })
    const result = recordPayment(deps, { ...another, note: 'quota di due anni' })
    expect(result).toMatchObject({ kind: 'recorded', payment: { validYear: 2027, note: 'quota di due anni' } })
    expect(cell(paymentRows(sheets).at(-1), 'motivo o nota')).toBe('quota di due anni')
  })

  it('i campi sbagliati, coi messaggi del flusso D', () => {
    const { deps, sheets } = office()
    const cases: [Partial<PaymentInput>, string, string][] = [
      [
        { memberNumber: '99' },
        'member',
        'Nessun socio con il numero 99. Prova col numero socio o solo col cognome. Se non è un socio, registra senza socio.',
      ],
      [{ amount: 'trenta' }, 'amount', "Scrivi l'importo in euro, per esempio 30."],
      [{ amount: '0' }, 'amount', "Scrivi l'importo in euro, per esempio 30."],
      [{ amount: '-30' }, 'amount', "Scrivi l'importo in euro, per esempio 30."],
      [{ date: '2026-02-30' }, 'date', 'Scrivi la data della contabile.'],
      [{ date: '' }, 'date', 'Scrivi la data della contabile.'],
      [{ date: '2026-11-06' }, 'date', 'La data non può essere nel futuro.'],
      [{ reference: ' ' }, 'reference', 'Manca il riferimento del bonifico: lo trovi sulla contabile.'],
      [{ method: 'cash', reference: '', collectedBy: '' }, 'collectedBy', 'Scrivi chi ha incassato.'],
    ]
    for (const [change, field, message] of cases)
      expect(recordPayment(deps, input(change)), JSON.stringify(change)).toEqual({ kind: 'invalid', field, message })
    expect(paymentRows(sheets)).toHaveLength(30)
  })

  it('senza socio va in «Da abbinare», chiunque lo registri, e non manda mail', () => {
    const { deps, sheets, mails } = office()
    expect(recordPayment(deps, input({ memberNumber: '' }))).toMatchObject({
      kind: 'recorded',
      payment: { memberNumber: '', status: 'recorded' },
      memberName: '',
      mail: 'none',
    })
    expect(cell(paymentRows(sheets).at(-1), 'numero socio')).toBe('')
    const shared = office({ email: DEMO_SHARED_ACCOUNT })
    const result = recordPayment(shared.deps, input({ person: DEMO_OFFICE.partTime, memberNumber: '' }))
    expect(result).toMatchObject({ kind: 'recorded', payment: { memberNumber: '' }, mail: 'none' })
    expect(mails).toEqual([])
  })

  it('chi non ha «può registrare pagamenti»: in attesa del tesoriere, non conta, niente mail', () => {
    const { deps, sheets, mails } = office({ email: DEMO_SHARED_ACCOUNT })
    const result = recordPayment(deps, input({ person: DEMO_OFFICE.partTime }))
    expect(result).toMatchObject({
      kind: 'recorded',
      payment: { status: 'pendingTreasurer', recordedBy: DEMO_OFFICE.partTime },
      pending: true,
      mail: 'none',
    })
    expect(statusOf(viewOf(result), '18')).toBe('dueForRenewal')
    expect(cell(paymentRows(sheets).at(-1), 'stato')).toBe('in attesa del tesoriere')
    expect(cell(paymentRows(sheets).at(-1), 'account')).toBe(DEMO_SHARED_ACCOUNT)
    expect(mails).toEqual([])
  })

  it('i contanti: «chi incassa» è chi ha incassato davvero, «registrato da» chi registra', () => {
    const { deps, sheets, mails } = office({ email: DEMO_SHARED_ACCOUNT })
    const cash = input({ person: DEMO_OFFICE.treasurer, method: 'cash', reference: '9001', collectedBy: 'Luisa' })
    const result = recordPayment(deps, cash)
    expect(result).toMatchObject({
      kind: 'recorded',
      payment: { method: 'cash', reference: '', collectedBy: 'Luisa', recordedBy: DEMO_OFFICE.treasurer },
    })
    // Il tesoriere può confermare: i contanti che registra li ha in mano (la regola è di T4).
    expect(cell(paymentRows(sheets).at(-1), 'contanti ricevuti il')).toBe('2026-11-05')
    expect(mails[0]?.body).toContain(
      'contanti del 03/11/2026.\nNumero del pagamento: P-2026-0016.\nQuesta mail vale come ricevuta.',
    )
    const bySecretary = office()
    recordPayment(bySecretary.deps, { ...cash, person: '' })
    expect(cell(paymentRows(bySecretary.sheets).at(-1), 'contanti ricevuti il')).toBe('')
  })

  it('la mail: noEmail per chi non ce l’ha; failed se l’invio cade, e il pagamento resta registrato', () => {
    expect(recordPayment(office().deps, input({ memberNumber: '15', date: '2025-12-01' }))).toMatchObject({
      mail: 'noEmail',
    })
    const { deps, sheets } = office({ mailFails: true })
    const result = recordPayment(deps, input())
    expect(result).toMatchObject({ kind: 'recorded', mail: 'failed' })
    expect(paymentRows(sheets)).toHaveLength(31)
    expect(statusOf(viewOf(result), '18')).toBe('inGoodStanding')
  })

  it('dopo la registrazione i numeri dei soci vanno su KV, senza nomi; con KV irraggiungibile la registrazione resta e «Oggi» lo dice finché non riesce', () => {
    const { deps, kv, sheets } = office()
    const result = recordPayment(deps, input())
    expect(result).toMatchObject({ kind: 'recorded' })
    expect(kv.writes).toEqual([MEMBERS_KEY])
    const published = JSON.parse(kv.values.get(MEMBERS_KEY) ?? '{}')
    expect(published.counts).toEqual({ ...DEMO_SOCI_COUNTS, inGoodStanding: 12, dueForRenewal: 3 })
    expect(JSON.stringify(published)).not.toContain('Santoro')
    expect(viewOf(result).dashboard.publication).toEqual({ pendingSince: '', error: '' })

    const down = office({ kvDown: true })
    const again = recordPayment(down.deps, input({ memberNumber: '2', reference: '9002' }))
    expect(again).toMatchObject({ kind: 'recorded', mail: 'sent' })
    expect(paymentRows(down.sheets)).toHaveLength(31)
    expect(paymentRows(sheets)).toHaveLength(31)
    expect(viewOf(again).dashboard.publication).toEqual({
      pendingSince: '2026-11-05',
      error: 'KV ha risposto 503 scrivendo v1/soci.json: Service Unavailable',
    })
    expect(down.state.get(MEMBERS_PUBLICATION_KEY)).toContain('2026-11-05')
    // Quando KV torna, la prima pubblicazione cancella l'avviso.
    down.kv.down = false
    const later = cancelPayment(down.deps, { person: '', paymentId: 'P-2026-0016', reason: 'x' })
    expect(viewOf(later).dashboard.publication).toEqual({ pendingSince: '', error: '' })
    expect(down.kv.writes).toEqual([MEMBERS_KEY])
  })

  it('senza KV configurato la segreteria registra lo stesso, e non pubblica', () => {
    const { deps, sheets } = office()
    const result = recordPayment({ ...deps, kv: null }, input())
    expect(result).toMatchObject({ kind: 'recorded', mail: 'sent' })
    expect(paymentRows(sheets)).toHaveLength(31)
  })

  it('un lucchetto occupato diventa un errore da riprovare', () => {
    const { deps, sheets } = office()
    const busy: OfficeDeps = {
      ...deps,
      withLock: () => {
        throw new (class extends Error {})('occupato')
      },
    }
    expect(() => recordPayment(busy, input())).toThrow('occupato')
    expect(paymentRows(sheets)).toHaveLength(30)
  })
})

describe('annullare e cambiare l’anno', () => {
  it('annullato col motivo: il socio torna allo stato di prima, e il pagamento resta nel registro', () => {
    const { deps, sheets } = office()
    recordPayment(deps, input())
    const result = cancelPayment(deps, { person: '', paymentId: 'P-2026-0016', reason: 'contabile di un altro socio' })
    expect(statusOf(viewOf(result), '18')).toBe('dueForRenewal')
    const row = paymentRows(sheets).at(-1)
    expect(cell(row, 'stato')).toBe('annullato')
    expect(cell(row, 'motivo o nota')).toBe('Annullato il 05/11/2026 da Carla Segre: contabile di un altro socio')
    const santoro = viewOf(result).members.find((member) => member.number === '18')
    expect(santoro?.payments[0]).toMatchObject({ id: 'P-2026-0016', status: 'cancelled' })
  })

  it('l’anno cambiato col motivo: lo stato segue l’anno nuovo, e il motivo si aggiunge alla nota', () => {
    const { deps, sheets } = office()
    recordPayment(deps, input({ note: 'dalla contabile' }))
    const result = changePaymentYear(deps, {
      person: '',
      paymentId: 'P-2026-0016',
      validYear: 2027,
      reason: 'la quota 2026 l’aveva già pagata in contanti',
    })
    expect(statusOf(viewOf(result), '18')).toBe('paidAhead')
    const row = paymentRows(sheets).at(-1)
    expect(cell(row, "vale per l'anno")).toBe(2027)
    expect(cell(row, 'motivo o nota')).toBe(
      'dalla contabile\nAnno cambiato da 2026 a 2027 il 05/11/2026 da Carla Segre: la quota 2026 l’aveva già pagata in contanti',
    )
  })

  it('solo chi ha «può registrare pagamenti», col motivo, su un pagamento che c’è e non è annullato', () => {
    const shared = office({ email: DEMO_SHARED_ACCOUNT })
    expect(cancelPayment(shared.deps, { person: DEMO_OFFICE.partTime, paymentId: 'P-2026-0001', reason: 'x' })).toEqual(
      {
        kind: 'error',
        message: 'Annullare un pagamento o cambiarne l’anno spetta a chi ha «può registrare pagamenti» in «Accessi».',
      },
    )
    const { deps, writes } = office()
    expect(cancelPayment(deps, { person: '', paymentId: 'P-2026-0001', reason: ' ' })).toEqual({
      kind: 'invalid',
      field: 'reason',
      message: 'Scrivi il motivo.',
    })
    expect(cancelPayment(deps, { person: '', paymentId: 'P-2026-9999', reason: 'x' })).toEqual({
      kind: 'invalid',
      field: 'payment',
      message: 'Non trovo il pagamento P-2026-9999.',
    })
    expect(changePaymentYear(deps, { person: '', paymentId: 'P-2026-0006', validYear: 2027, reason: 'x' })).toEqual({
      kind: 'invalid',
      field: 'payment',
      message: 'Il pagamento P-2026-0006 è annullato.',
    })
    expect(writes).toEqual([])
  })

  it('l’anno nuovo non può essere un anno che il socio ha già pagato, se quel pagamento non è annullato', () => {
    const { deps, writes } = office()
    const change = (paymentId: string, validYear: number) =>
      changePaymentYear(deps, { person: '', paymentId, validYear, reason: 'x' })
    expect(change('P-2026-0011', 2027)).toEqual({
      kind: 'invalid',
      field: 'validYear',
      message: 'Il socio ha già un pagamento per il 2027 (P-2026-0012): annullalo, o scegli un altro anno.',
    })
    expect(writes).toEqual([])
    cancelPayment(deps, { person: '', paymentId: 'P-2026-0012', reason: 'x' })
    expect(change('P-2026-0011', 2027)).toMatchObject({ kind: 'done' })
  })

  it('l’anno nuovo è un intero fra il 2000 e l’anno di oggi più 5', () => {
    const { deps } = office()
    const change = (validYear: number) =>
      changePaymentYear(deps, { person: '', paymentId: 'P-2026-0001', validYear, reason: 'x' })
    for (const year of [1999, 2032, 2026.5, Number.NaN])
      expect(change(year), String(year)).toEqual({
        kind: 'invalid',
        field: 'validYear',
        message: 'Scegli un anno fra 2000 e 2031.',
      })
    expect(change(2026)).toEqual({ kind: 'invalid', field: 'validYear', message: 'Il pagamento vale già per il 2026.' })
    expect(change(2031)).toMatchObject({ kind: 'done' })
  })
})

it('nessuna chiamata scrive in «Accessi»', () => {
  const { deps, writes } = office()
  openOffice(deps, '')
  previewPayment(deps, input())
  recordPayment(deps, input())
  recordPayment(deps, input({ memberNumber: '1', date: '2026-03-01' }))
  changePaymentYear(deps, { person: '', paymentId: 'P-2026-0016', validYear: 2027, reason: 'x' })
  cancelPayment(deps, { person: '', paymentId: 'P-2026-0016', reason: 'x' })
  expect(writes.length).toBeGreaterThan(0)
  expect(writes).not.toContain(SOCI_SHEETS.access.name)
})

describe('«Oggi»', () => {
  const dashboard = viewOf(open()).dashboard

  it('da abbinare, in attesa del tesoriere, contanti da consegnare col totale, l’ultima registrazione', () => {
    expect(
      dashboard.toMatch.map((item) => (item.kind === 'bankWithoutPayment' ? item.line.reason : item.payment.id)),
    ).toEqual(['quota Verdi', 'P-2026-0015'])
    expect(dashboard.matchedLines).toBe(3)
    expect(dashboard.bank).toEqual({ lines: 4, outflows: 0, lastDate: '2026-11-02', raduno: [], notDues: [] })
    expect(dashboard.pendingTreasurer.map((payment) => [payment.id, payment.memberName])).toEqual([
      ['P-2026-0007', 'Giorgio Mancini'],
    ])
    expect(dashboard.cashToDeliver.payments.map((payment) => [payment.id, payment.memberName])).toEqual([
      ['P-2026-0003', 'Luca Fabbri'],
      ['P-2026-0007', 'Giorgio Mancini'],
    ])
    expect(dashboard.cashToDeliver.total).toBe(60)
    expect(dashboard.lastRecording).toEqual({ id: 'P-2026-0007', on: '2026-10-30', daysAgo: 6 })
    expect(LAST_RECORDING_DAYS).toBe(7)
  })

  it('un’ultima registrazione di più di 7 giorni fa si vede dai giorni; le quote del libro soci non sono registrazioni', () => {
    const sheets = demoSociSheets()
    const rows = sheets[SOCI_SHEETS.payments.name] ?? []
    const recordedOn = SOCI_SHEETS.payments.columns.indexOf('registrato il')
    for (const row of rows.slice(1)) if (String(row[recordedOn]) > '2026-10-20') row[recordedOn] = '2026-10-20'
    const { lastRecording } = viewOf(open({ sheets })).dashboard
    expect(lastRecording).toMatchObject({ on: '2026-10-20', daysAgo: 16 })
    expect(lastRecording && lastRecording.daysAgo > LAST_RECORDING_DAYS).toBe(true)
  })

  it('le scadenze da guardare, con chi le segue e il ritardo: un adempimento passato da 3 giorni è in ritardo di 3', () => {
    const content = demoSheets(DEMO_SOCI_NOW)
    content[SHEETS.deadlines.name]?.push([
      'SCA-0020',
      'Bilancio al Direttivo',
      'adempimento',
      '2026-11-02',
      'il tesoriere',
      '',
      '',
      'no',
    ])
    const { deadlines } = viewOf(open({ content })).dashboard
    expect(deadlines.map((deadline) => [deadline.id, deadline.lateByDays])).toEqual([
      ['SCA-0001', 5],
      ['SCA-0020', 3],
      ['SCA-0008', null],
      ['SCA-0002', null],
      ['SCA-0003', null],
      ['SCA-0004', null],
    ])
    expect(deadlines[1]).toMatchObject({ what: 'Bilancio al Direttivo', ownerRole: 'il tesoriere', daysLeft: -3 })
  })

  const sharedAccountWarning =
    'L’account segreteria.condivisa@example.org ha due righe in «Accessi», e una può confermare: così si può confermare un proprio pagamento.'

  it('«Da controllare»: la scadenza senza nessuno, le righe della banca che non si leggono, uguali o con un altro importo', () => {
    expect(dashboard.toCheck).toEqual([
      'La scadenza «Nomina per la piattaforma della newsletter» non ha nessuno che la segua.',
      sharedAccountWarning,
    ])
    const sheets = demoSociSheets()
    sheets[SOCI_SHEETS.bank.name]?.push(
      ['ieri', 30, 'Quota', '', '', ''],
      ['2026-11-02', 30, 'quota Verdi', 'TRN 90210', '', ''],
      // Due bonifici uguali senza riferimento: possono essere due quote vere, nessuna si scarta.
      ['2026-11-03', 30, 'Quota RAMI 2026', '', '', ''],
      ['2026-11-03', 30, 'Quota RAMI 2026', '', '', ''],
      ['2026-11-04', -1.5, 'Commissione', '', '', ''],
      ['2026-11-04', -1.5, 'Commissione', '', '', ''],
      // Il riferimento di P-2026-0008 e P-2026-0009 (60 € in due quote), ma con un altro importo.
      ['2026-11-04', 30, 'quota Neri', 'TRN 55001', '', ''],
      // Il socio 16 ha registrato due quote da 30 € il 02/04: 300 € con «socio n. 16» non tornano.
      ['2026-04-05', 300, 'quota socio n. 16', '', '', ''],
    )
    const { toCheck, toMatch, bank } = viewOf(open({ sheets })).dashboard
    expect(toCheck).toEqual([
      '«Estratto conto», riga 6: la data non si legge.',
      'Due righe uguali il 02/11/2026 («Estratto conto», righe 5 e 7): controlla che non sia la stessa incollata due volte.',
      'Due righe uguali il 03/11/2026 («Estratto conto», righe 8 e 9): controlla che non sia la stessa incollata due volte.',
      'Riferimento uguale, importo diverso: «Estratto conto», riga 12 (30 €) e P-2026-0008, P-2026-0009 (60 €).',
      'Socio n. 16 nei 7 giorni, importo diverso: «Estratto conto», riga 13 (300 €) e P-2026-0011, P-2026-0012 (60 €). Se non è una quota (una donazione, le magliette), scrivi il motivo nella colonna «ignorato perché» della stessa riga.',
      'La scadenza «Nomina per la piattaforma della newsletter» non ha nessuno che la segua.',
      sharedAccountWarning,
    ])
    // Le uscite non sono quote di soci: si contano a parte, e non sono da controllare.
    expect(bank).toMatchObject({ lines: 12, outflows: 2 })
    // Le righe uguali entrano tutte in «Da abbinare»; quelle con l'importo diverso no.
    expect(toMatch.map((item) => (item.kind === 'bankWithoutPayment' ? item.line.index : item.kind))).toEqual([
      4,
      6,
      7,
      8,
      'paymentWithoutMember',
    ])
  })

  it('con le uscite, le righe uguali abbinate e l’account a posto, «Da controllare» torna vuota', () => {
    const sheets = demoSociSheets()
    // Il tesoriere sul suo account, e nessuna riga della banca senza pagamento.
    for (const row of sheets[SOCI_SHEETS.access.name] ?? [])
      if (row[0] === DEMO_OFFICE.treasurer) row[1] = 'tesoriere@example.org'
    sheets[SOCI_SHEETS.bank.name]?.splice(3, 2)
    sheets[SOCI_SHEETS.bank.name]?.push(
      ['2026-10-31', -1.5, 'Commissione', '', '', ''],
      ['2026-10-31', -1.5, 'Commissione', '', '', ''],
      ['2026-10-31', 0, 'Storno', '', '', ''],
      // La quota di due anni del socio 16: due righe uguali, abbinate tutte e due.
      ['2026-04-03', 30, 'quota socio n. 16', '', '', ''],
      ['2026-04-03', 30, 'quota socio n. 16', '', '', ''],
      // Due bonifici uguali senza riferimento né «socio n.» di più di 45 giorni fa: non si abbinano mai, restano in
      // «Da abbinare» ma non sono più da controllare (M14).
      ['2026-09-01', 30, 'Bonifico quota', '', '', ''],
      ['2026-09-01', 30, 'Bonifico quota', '', '', ''],
    )
    const content = demoSheets(DEMO_SOCI_NOW)
    const owner = SHEETS.deadlines.columns.indexOf('chi segue (ruolo)')
    for (const row of content[SHEETS.deadlines.name] ?? []) if (row[0] === 'SCA-0003') row[owner] = 'il segretario'
    const { toCheck, bank, toMatch } = viewOf(open({ sheets, content })).dashboard
    expect(toCheck).toEqual([])
    expect(bank).toMatchObject({ outflows: 3 })
    expect(
      toMatch.filter((item) => item.kind === 'bankWithoutPayment' && item.line.date === '2026-09-01'),
    ).toHaveLength(2)
  })

  it('l’avviso sull’account lo vede solo il segretario, e solo se chi non registra divide l’account con chi conferma', () => {
    // Il segretario, che cura «Accessi», lo vede; il tesoriere sull'account condiviso no.
    expect(viewOf(open()).dashboard.toCheck).toContain(sharedAccountWarning)
    const treasurer = viewOf(open({ email: DEMO_SHARED_ACCOUNT }, DEMO_OFFICE.treasurer))
    expect(treasurer.dashboard.toCheck).not.toContain(sharedAccountWarning)
    // Se anche la part-time registra, i suoi pagamenti non aspettano «Conferma»: niente da confermare per sé.
    const sheets = demoSociSheets()
    for (const row of sheets[SOCI_SHEETS.access.name] ?? []) if (row[0] === DEMO_OFFICE.partTime) row[4] = 'sì'
    expect(viewOf(open({ sheets })).dashboard.toCheck).not.toContain(sharedAccountWarning)
  })

  it('un account con due righe in «Accessi» di cui una può confermare sta in «Da controllare»; con account diversi no', () => {
    const sheets = demoSociSheets()
    const access = sheets[SOCI_SHEETS.access.name] ?? []
    // La riga del tesoriere, che può confermare, sul suo account.
    const treasurer = access.find((row) => row[0] === DEMO_OFFICE.treasurer)
    if (treasurer) treasurer[1] = 'tesoriere@example.org'
    expect(viewOf(open({ sheets })).dashboard.toCheck).not.toContain(sharedAccountWarning)
    // Due righe sullo stesso account, nessuna può confermare: niente da segnalare.
    const neither = demoSociSheets()
    for (const row of neither[SOCI_SHEETS.access.name] ?? []) if (row[0] === DEMO_OFFICE.treasurer) row[5] = 'no'
    expect(viewOf(open({ sheets: neither })).dashboard.toCheck).not.toContain(sharedAccountWarning)
  })

  it('«Salute» del Foglio contenuti, una riga per pezzo, con le date nel fuso di Roma', () => {
    const content = demoSheets(DEMO_SOCI_NOW)
    content[SHEETS.health.name]?.push(
      [
        'Istantanea riservata (v1/riservata.json)',
        'a posto',
        new Date('2026-11-05T08:50:00Z'),
        new Date('2026-11-04T17:00:00Z'),
        'Pubblicata: era cambiata.',
      ],
      [
        'Ultima registrazione di un pagamento',
        'a posto',
        new Date('2026-11-05T08:50:00Z'),
        '30/10/2026',
        'P-2026-0007.',
      ],
    )
    const { health } = viewOf(open({ content })).dashboard
    expect(health).toEqual([
      {
        piece: 'Istantanea riservata (v1/riservata.json)',
        status: 'a posto',
        checkedOn: formatInstant(new Date('2026-11-05T08:50:00Z')),
        updatedOn: formatInstant(new Date('2026-11-04T17:00:00Z')),
        note: 'Pubblicata: era cambiata.',
      },
      {
        piece: 'Ultima registrazione di un pagamento',
        status: 'a posto',
        checkedOn: formatInstant(new Date('2026-11-05T08:50:00Z')),
        updatedOn: '30/10/2026',
        note: 'P-2026-0007.',
      },
    ])
  })

  it('senza il Foglio contenuti, o se non si legge, lo dice e il resto c’è', () => {
    const none = viewOf(open({ content: null })).dashboard
    expect(none.contentProblem).toBe('Il Foglio contenuti non è collegato.')
    expect(none.deadlines).toEqual([])
    expect(none.pendingTreasurer).toHaveLength(1)
    const broken = viewOf(open({ content: {} })).dashboard
    expect(broken.contentProblem).toBe('')
    expect(broken.toCheck).toContain('Manca la scheda «Scadenze».')
  })

  it('dati 2 impegni «da scrivere», «Oggi» dice «Impegni da scrivere: 2»; senza la scheda niente', () => {
    expect(viewOf(open()).dashboard.commitmentsToWrite).toBe(2)
    const content = demoSheets(DEMO_SOCI_NOW)
    const rows = content[SHEETS.commitments.name] ?? []
    const status = SHEETS.commitments.columns.indexOf('stato')
    for (const row of rows.slice(1)) if (row[status] === 'da scrivere') row[status] = 'proposto'
    expect(viewOf(open({ content })).dashboard.commitmentsToWrite).toBe(0)
    delete content[SHEETS.commitments.name]
    expect(viewOf(open({ content })).dashboard.commitmentsToWrite).toBeNull()
    expect(viewOf(open({ content: null })).dashboard.commitmentsToWrite).toBeNull()
  })

  it('una scheda «Impegni» senza una colonna lo dice in «Da controllare», e le scadenze ci sono', () => {
    const content = demoSheets(DEMO_SOCI_NOW)
    content[SHEETS.commitments.name] = [
      ['id', 'titolo'],
      ['IMP-0001', 'La cura della Bussola'],
    ]
    const { commitmentsToWrite, toCheck, deadlines } = viewOf(open({ content })).dashboard
    expect(commitmentsToWrite).toBeNull()
    expect(toCheck).toContain('«Impegni»: manca la colonna «anno».')
    expect(deadlines.length).toBeGreaterThan(0)
  })

  it('senza la scheda «Estratto conto» lo dice in «Da controllare», e niente è da abbinare dalla banca', () => {
    const sheets = demoSociSheets()
    delete sheets[SOCI_SHEETS.bank.name]
    const { toCheck, toMatch } = viewOf(open({ sheets })).dashboard
    expect(toCheck[0]).toBe('Manca la scheda «Estratto conto»: la crea setupSoci, dall’editor.')
    expect(toMatch.map((item) => item.kind)).toEqual(['paymentWithoutMember'])
  })

  it('da gennaio ad aprile la riga dei rinnovi, con le parole della Riservata', () => {
    expect(dashboard.renewals).toBeNull()
    expect(dashboard.renewalsLabel).toBe('')
    const { deps } = office()
    const february = viewOf(openOffice({ ...deps, now: new Date('2027-02-01T10:00:00Z') }, '')).dashboard
    expect(february.renewals).toEqual({ year: 2027, renewed: 1, base: 11, percent: 9, until: '03-31' })
    expect(february.renewalsLabel).toBe('Rinnovi 2027: 1 su 11 (9%) · bersaglio: oltre il 92% al 31/3')
  })

  it('il libro soci nel Drive: la data dell’ultimo, e se la copia di stanotte non è riuscita', () => {
    expect(dashboard.register).toEqual({ savedOn: '', url: '', failedOn: '', error: '' })
    const { deps, state } = office()
    state.set(
      REGISTER_STATE_KEY,
      JSON.stringify({
        savedOn: '2026-10-01',
        url: 'https://docs.google.com/spreadsheets/d/x/edit',
        failedOn: '2026-11-01',
        error: 'Drive non risponde',
      }),
    )
    expect(viewOf(openOffice(deps, '')).dashboard.register).toEqual({
      savedOn: '2026-10-01',
      url: 'https://docs.google.com/spreadsheets/d/x/edit',
      failedOn: '2026-11-01',
      error: 'Drive non risponde',
    })
  })
})

describe('la conferma del tesoriere e i contanti', () => {
  const treasurer = () => office({ email: DEMO_SHARED_ACCOUNT })
  const asTreasurer = { person: DEMO_OFFICE.treasurer }

  it('confermare un pagamento in attesa lo fa contare, il socio cambia stato e parte la ricevuta', () => {
    const { deps, sheets, mails } = treasurer()
    expect(statusOf(viewOf(openOffice(deps, DEMO_OFFICE.treasurer)), '10')).toBe('dueForRenewal')
    const result = confirmPayment(deps, { ...asTreasurer, paymentId: 'P-2026-0007' })
    expect(result).toMatchObject({ kind: 'done', mail: 'sent' })
    const view = viewOf(result)
    expect(statusOf(view, '10')).toBe('inGoodStanding')
    expect(view.dashboard.pendingTreasurer).toEqual([])
    const row = paymentRows(sheets).find((candidate) => cell(candidate, 'id') === 'P-2026-0007')
    expect(cell(row, 'stato')).toBe('registrato')
    expect(cell(row, 'motivo o nota')).toBe('Confermato il 05/11/2026 da Ugo Bassi')
    expect(mails.map((mail) => [mail.to, mail.subject])).toEqual([
      ['giorgio.mancini@example.org', 'Quota ricevuta, sei in regola'],
    ])
  })

  it('«Conferma» non vale su un pagamento registrato da sé, né su uno che non è in attesa', () => {
    const { deps, writes } = treasurer()
    const own = recordPayment(
      office({ email: DEMO_SHARED_ACCOUNT, sheets: deps.workbook.values('Soci') ? demoSociSheets() : {} }).deps,
      input({ person: DEMO_OFFICE.partTime }),
    )
    expect(own).toMatchObject({ kind: 'recorded', pending: true })
    const partTime = office({ email: DEMO_SHARED_ACCOUNT })
    const sheets = partTime.sheets
    sheets[SOCI_SHEETS.access.name]?.splice(2, 1, [
      DEMO_OFFICE.partTime,
      DEMO_SHARED_ACCOUNT,
      'segreteria part-time',
      'sì',
      'no',
      'sì',
    ])
    expect(confirmPayment(partTime.deps, { person: DEMO_OFFICE.partTime, paymentId: 'P-2026-0007' })).toEqual({
      kind: 'invalid',
      field: 'payment',
      message: 'Un pagamento lo conferma una persona diversa da chi l’ha registrato.',
    })
    expect(confirmPayment(deps, { ...asTreasurer, paymentId: 'P-2026-0001' })).toEqual({
      kind: 'invalid',
      field: 'payment',
      message: 'Il pagamento P-2026-0001 non è in attesa del tesoriere.',
    })
    expect(writes).toEqual([])
  })

  it('chi non ha «può confermare pagamenti» non conferma e non segna i ricevuti', () => {
    const { deps, writes } = office()
    const refused = {
      kind: 'error',
      message:
        'Confermare un pagamento e segnare i contanti ricevuti spetta a chi ha «può confermare pagamenti» in «Accessi».',
    }
    expect(confirmPayment(deps, { person: '', paymentId: 'P-2026-0007' })).toEqual(refused)
    expect(cashReceived(deps, { person: '', paymentId: 'P-2026-0003' })).toEqual(refused)
    expect(viewOf(openOffice(deps, ''))).toMatchObject({ canConfirm: false, canRecord: true })
    expect(writes).toEqual([])
  })

  it('«Ricevuti» toglie i contanti da «Contanti da consegnare» con la data, e il totale scende', () => {
    const { deps, sheets } = treasurer()
    const result = cashReceived(deps, { ...asTreasurer, paymentId: 'P-2026-0003' })
    expect(result).toMatchObject({ kind: 'done', mail: 'none' })
    const { cashToDeliver } = viewOf(result).dashboard
    expect(cashToDeliver.payments.map((payment) => payment.id)).toEqual(['P-2026-0007'])
    expect(cashToDeliver.total).toBe(30)
    const row = paymentRows(sheets).find((candidate) => cell(candidate, 'id') === 'P-2026-0003')
    expect(cell(row, 'contanti ricevuti il')).toBe('2026-11-05')
    const fabbri = viewOf(result).members.find((member) => member.number === '6')
    expect(fabbri?.payments.find((payment) => payment.id === 'P-2026-0003')?.cashReceivedOn).toBe('2026-11-05')
    expect(cashReceived(deps, { ...asTreasurer, paymentId: 'P-2026-0003' })).toEqual({
      kind: 'invalid',
      field: 'payment',
      message: 'I contanti di P-2026-0003 sono già segnati ricevuti il 05/11/2026.',
    })
    expect(cashReceived(deps, { ...asTreasurer, paymentId: 'P-2026-0001' })).toEqual({
      kind: 'invalid',
      field: 'payment',
      message: 'Il pagamento P-2026-0001 non è in contanti.',
    })
  })

  it('i contanti registrati da chi ha il permesso nascono «contanti ricevuti» e contano subito; gli altri no', () => {
    const { deps, sheets } = treasurer()
    const cash = input({
      person: DEMO_OFFICE.treasurer,
      memberNumber: '4',
      method: 'cash',
      reference: '',
      collectedBy: 'Ugo Bassi',
    })
    const result = recordPayment(deps, cash)
    expect(result).toMatchObject({
      kind: 'recorded',
      pending: false,
      payment: { cashReceivedOn: '2026-11-05', status: 'recorded' },
    })
    expect(cell(paymentRows(sheets).at(-1), 'contanti ricevuti il')).toBe('2026-11-05')
    expect(viewOf(result).dashboard.cashToDeliver.payments.map((payment) => payment.id)).toEqual([
      'P-2026-0003',
      'P-2026-0007',
    ])
    const secretary = office()
    const other = recordPayment(secretary.deps, { ...cash, person: '', collectedBy: 'Carla Segre' })
    expect(other).toMatchObject({ kind: 'recorded', payment: { cashReceivedOn: '', status: 'recorded' } })
    expect(viewOf(other).dashboard.cashToDeliver.payments.map((payment) => payment.id)).toEqual([
      'P-2026-0003',
      'P-2026-0007',
      'P-2026-0016',
    ])
    expect(viewOf(other).dashboard.cashToDeliver.total).toBe(90)
  })
})

describe('abbinare a un socio', () => {
  it('un pagamento senza socio, abbinato da chi può registrare a un pagamento registrato da chi può: conta subito', () => {
    const { deps, sheets, mails } = office()
    expect(statusOf(viewOf(openOffice(deps, '')), '4')).toBe('notInGoodStanding')
    const result = assignMember(deps, { person: '', paymentId: 'P-2026-0015', memberNumber: '4' })
    expect(result).toMatchObject({ kind: 'done', mail: 'sent' })
    const view = viewOf(result)
    // Donati è socio dal 2020: il bonifico del 25/10 vale per il 2026, non per il 2027.
    expect(statusOf(view, '4')).toBe('inGoodStanding')
    expect(view.dashboard.toMatch.map((item) => item.kind)).toEqual(['bankWithoutPayment'])
    const row = paymentRows(sheets).find((candidate) => cell(candidate, 'id') === 'P-2026-0015')
    expect(cell(row, 'numero socio')).toBe(4)
    expect(cell(row, "vale per l'anno")).toBe(2026)
    expect(cell(row, 'stato')).toBe('registrato')
    expect(cell(row, 'motivo o nota')).toBe(
      'causale «quota Rossi», nessun socio Rossi\nAbbinato al socio n. 4 il 05/11/2026 da Carla Segre',
    )
    expect(mails.map((mail) => mail.to)).toEqual(['paolo.donati@example.org'])
  })

  it('registrato da chi non ha «può registrare pagamenti», abbinato a un socio, va «In attesa del tesoriere»', () => {
    const sheets = demoSociSheets()
    const partTime = office({ email: DEMO_SHARED_ACCOUNT, sheets })
    const recorded = recordPayment(
      partTime.deps,
      input({ person: DEMO_OFFICE.partTime, memberNumber: '', reference: '7700' }),
    )
    expect(recorded).toMatchObject({ kind: 'recorded', pending: true, payment: { memberNumber: '' } })
    const secretary = office({ sheets })
    const result = assignMember(secretary.deps, { person: '', paymentId: 'P-2026-0016', memberNumber: '4' })
    expect(result).toMatchObject({ kind: 'done', mail: 'none' })
    expect(statusOf(viewOf(result), '4')).toBe('notInGoodStanding')
    expect(viewOf(result).dashboard.pendingTreasurer.map((payment) => payment.id)).toEqual([
      'P-2026-0007',
      'P-2026-0016',
    ])
    // E chi non può registrare, abbinando un pagamento registrato da chi può, lo manda in attesa lo stesso.
    const again = assignMember(partTime.deps, {
      person: DEMO_OFFICE.partTime,
      paymentId: 'P-2026-0015',
      memberNumber: '17',
    })
    expect(again).toMatchObject({ kind: 'done', mail: 'none' })
    expect(viewOf(again).dashboard.pendingTreasurer.map((payment) => payment.id)).toEqual([
      'P-2026-0015',
      'P-2026-0007',
      'P-2026-0016',
    ])
  })

  it('i controlli: il socio che non c’è, il pagamento che ha già un socio, il possibile doppione', () => {
    const { deps, writes } = office()
    expect(assignMember(deps, { person: '', paymentId: 'P-2026-0015', memberNumber: '99' })).toEqual({
      kind: 'invalid',
      field: 'member',
      message: 'Nessun socio con il numero 99.',
    })
    expect(assignMember(deps, { person: '', paymentId: 'P-2026-0001', memberNumber: '4' })).toEqual({
      kind: 'invalid',
      field: 'payment',
      message: 'Il pagamento P-2026-0001 ha già il socio n. 1.',
    })
    expect(assignMember(deps, { person: '', paymentId: 'P-2026-0015', memberNumber: '1' })).toEqual({
      kind: 'invalid',
      field: 'member',
      message: 'Lucia Abate ha già un pagamento per il 2026 (P-2026-0001): annullalo, oppure scegli un altro socio.',
    })
    expect(writes).toEqual([])
  })
})

describe('l’estratto conto', () => {
  const bankRows = (sheets: Record<string, unknown[][]>) => (sheets[SOCI_SHEETS.bank.name] ?? []).slice(1)
  const text = [
    'Data;Importo;Causale;Riferimento',
    '03/11/2026;30,00;Quota RAMI 2026 socio n. 18;TRN 5555',
    '02/11/2026;30,00;quota Verdi;TRN 90210',
    '04/11/2026;-12,00;Canone;TRN 1',
    '04/11/2026;30,00;Bonifico da BELLINI MARCO;90001',
  ].join('\n')

  it('importa le righe nuove, abbina quelle che tornano e scrive il perché su quelle ignorate', () => {
    const { deps, sheets } = office()
    recordPayment(deps, input({ memberNumber: '2', date: '2026-11-03', reference: '90001' }))
    recordPayment(deps, input({ memberNumber: '18', date: '2026-11-02', reference: '90002', requestKey: 'schermo-2' }))
    const result = importBank(deps, { person: '', text })
    expect(result).toMatchObject({ kind: 'imported', added: 3, alreadyPasted: 1, ignored: 1, matched: 2 })
    const rows = bankRows(sheets)
    expect(rows).toHaveLength(7)
    expect(rows.slice(4)).toEqual([
      ['2026-11-03', 30, 'Quota RAMI 2026 socio n. 18', 'TRN 5555', 'P-2026-0017', ''],
      ['2026-11-04', -12, 'Canone', 'TRN 1', '', 'è un’uscita'],
      ['2026-11-04', 30, 'Bonifico da BELLINI MARCO', '90001', 'P-2026-0016', ''],
    ])
    // Le righe di prima prendono «abbinato a» alla prima importazione.
    expect(rows.slice(0, 3).map((row) => row[4])).toEqual(['P-2026-0014', 'P-2026-0004', 'P-2026-0015'])
    const { toMatch, toCheck } = viewOf(result).dashboard
    expect(toMatch.map((item) => (item.kind === 'bankWithoutPayment' ? item.line.reason : item.payment.id))).toEqual([
      'quota Verdi',
      'P-2026-0015',
    ])
    // L'uscita resta scritta nella scheda, ma non è da controllare: si conta a parte.
    expect(toCheck.filter((item) => item.includes('«Estratto conto»'))).toEqual([])
    expect(viewOf(result).dashboard.bank).toMatchObject({ lines: 7, outflows: 1 })
  })

  it('incollando due volte le stesse righe, si scartano e non nasce nessun pagamento nuovo', () => {
    const { deps, sheets } = office()
    const first = importBank(deps, { person: '', text })
    expect(first).toMatchObject({ kind: 'imported', added: 3, alreadyPasted: 1 })
    const again = importBank(deps, { person: '', text })
    expect(again).toMatchObject({ kind: 'imported', added: 0, alreadyPasted: 4, ignored: 0, matched: 0 })
    expect(bankRows(sheets)).toHaveLength(7)
    expect(paymentRows(sheets)).toHaveLength(30)
  })

  it('lo stesso blocco col riferimento copiato due volte in un incolla: entra una volta sola', () => {
    const { deps, sheets } = office()
    const one = ['03/11/2026;30,00;Bonifico da ROSSI;REF77001', '04/11/2026;45,00;Bonifico da BIANCHI;REF77002']
    const result = importBank(deps, {
      person: '',
      text: ['Data;Importo;Causale;Riferimento', ...one, ...one].join('\n'),
    })
    expect(result).toMatchObject({ kind: 'imported', added: 2, alreadyPasted: 2 })
    expect(bankRows(sheets)).toHaveLength(6)
    const { toCheck, toMatch } = viewOf(result).dashboard
    expect(toCheck.filter((item) => item.startsWith('Due righe'))).toEqual([])
    expect(toMatch.flatMap((item) => (item.kind === 'bankWithoutPayment' ? [item.line.reference] : []))).toEqual(
      expect.arrayContaining(['REF77001', 'REF77002']),
    )
    expect(
      toMatch.filter((item) => item.kind === 'bankWithoutPayment' && item.line.reference.startsWith('REF')),
    ).toHaveLength(2)
  })

  it('lo stesso estratto senza riferimento incollato due volte: la seconda volta non entra niente', () => {
    const { deps, sheets } = office()
    const plain = [
      'Data;Importo;Causale',
      '03/11/2026;30,00;Quota RAMI 2026',
      '04/11/2026;30,00;Quota RAMI 2026',
      '05/11/2026;30,00;Quota RAMI 2026',
    ].join('\n')
    expect(importBank(deps, { person: '', text: plain })).toMatchObject({
      kind: 'imported',
      added: 3,
      alreadyPasted: 0,
    })
    const again = importBank(deps, { person: '', text: plain })
    expect(again).toMatchObject({ kind: 'imported', added: 0, alreadyPasted: 3 })
    expect(bankRows(sheets)).toHaveLength(7)
    expect(viewOf(again).dashboard.toCheck.filter((item) => item.startsWith('Due righe'))).toEqual([])
    expect(paymentRows(sheets)).toHaveLength(30)
  })

  it('un estratto che si sovrappone al vecchio aggiunge solo le righe in più, anche una uguale a una vecchia', () => {
    const { deps, sheets } = office()
    const old = ['Data;Importo;Causale', '03/11/2026;30,00;Quota RAMI 2026', '04/11/2026;30,00;Quota RAMI 2026']
    importBank(deps, { person: '', text: old.join('\n') })
    // Il nuovo estratto riprende il 04/11 e porta un secondo bonifico uguale quel giorno, più uno del 05/11.
    const overlapping = [
      'Data;Importo;Causale',
      '04/11/2026;30,00;Quota RAMI 2026',
      '04/11/2026;30,00;Quota RAMI 2026',
      '05/11/2026;30,00;Quota RAMI 2026',
    ]
    const result = importBank(deps, { person: '', text: overlapping.join('\n') })
    expect(result).toMatchObject({ kind: 'imported', added: 2, alreadyPasted: 1 })
    expect(
      bankRows(sheets)
        .slice(4)
        .map((row) => row[0]),
    ).toEqual(['2026-11-03', '2026-11-04', '2026-11-04', '2026-11-05'])
  })

  it('due righe uguali senza riferimento non sono una riga incollata due volte: entrano, e «Oggi» le segnala', () => {
    const { deps, sheets } = office()
    const twice = [
      'Data;Importo;Causale;Riferimento',
      '02/11/2026;30,00;Quota RAMI 2026;',
      '02/11/2026;30,00;Quota RAMI 2026;',
      '03/11/2026;-1,50;Commissione;',
      '03/11/2026;-1,50;Commissione;',
    ].join('\n')
    const result = importBank(deps, { person: '', text: twice })
    expect(result).toMatchObject({ kind: 'imported', added: 4, alreadyPasted: 0, ignored: 2, matched: 0 })
    expect(bankRows(sheets).slice(4)).toEqual([
      ['2026-11-02', 30, 'Quota RAMI 2026', '', '', ''],
      ['2026-11-02', 30, 'Quota RAMI 2026', '', '', ''],
      ['2026-11-03', -1.5, 'Commissione', '', '', 'è un’uscita'],
      ['2026-11-03', -1.5, 'Commissione', '', '', 'è un’uscita'],
    ])
    const { toCheck, toMatch } = viewOf(result).dashboard
    // Le due quote uguali sono da controllare finché non sono abbinate; due commissioni uguali sono normali.
    expect(toCheck.filter((item) => item.includes('«Estratto conto»'))).toEqual([
      'Due righe uguali il 02/11/2026 («Estratto conto», righe 6 e 7): controlla che non sia la stessa incollata due volte.',
    ])
    expect(toMatch.filter((item) => item.kind === 'bankWithoutPayment')).toHaveLength(3)
  })

  it('spetta a chi può registrare pagamenti, e vuole delle righe', () => {
    const partTime = office({ email: DEMO_SHARED_ACCOUNT })
    expect(importBank(partTime.deps, { person: DEMO_OFFICE.partTime, text })).toEqual({
      kind: 'error',
      message: 'Importare l’estratto conto spetta a chi ha «può registrare pagamenti» in «Accessi».',
    })
    const { deps, writes } = office()
    expect(importBank(deps, { person: '', text: ' \n ' })).toEqual({
      kind: 'invalid',
      field: 'bank',
      message: 'Incolla le righe della banca, o il suo CSV.',
    })
    expect(writes).toEqual([])
  })

  it('senza la scheda «Estratto conto» lo dice', () => {
    const sheets = demoSociSheets()
    delete sheets[SOCI_SHEETS.bank.name]
    expect(importBank(office({ sheets }).deps, { person: '', text })).toEqual({
      kind: 'error',
      message: 'Manca la scheda «Estratto conto»: la crea setupSoci, dall’editor.',
    })
  })
})

describe('le righe che non sono quote', () => {
  const bankRows = (sheets: Record<string, unknown[][]>) => (sheets[SOCI_SHEETS.bank.name] ?? []).slice(1)
  const extract = [
    'Data;Importo;Causale;Riferimento',
    '03/11/2026;-1,50;Commissione;',
    '03/11/2026;45,00;raduno rete microfarm 2027 (solo soci);CRO 701',
    '04/11/2026;45,00;RADUNO RETE MICROFARM 2027 BIANCHI;CRO 702',
    '04/11/2026;3850,00;erogazione liberale a sostegno attivita;CRO 703',
    '04/11/2026;15,00;magliette;',
  ].join('\n')
  /** La riga di «Da abbinare» con quella causale, come la manda la pagina. */
  const toMatchLine = (view: OfficeView, reason: string) => {
    const found = view.dashboard.toMatch.find(
      (item) => item.kind === 'bankWithoutPayment' && item.line.reason === reason,
    )
    if (found?.kind !== 'bankWithoutPayment') throw new Error(`nessuna riga «${reason}» da abbinare`)
    return found.line
  }

  it('una riga del Raduno col riferimento di un bonifico registrato si abbina, e non si conta fra le ignorate', () => {
    const { deps, sheets } = office()
    recordPayment(deps, input({ memberNumber: '2', date: '2026-11-03', reference: '70100' }))
    const result = importBank(deps, {
      person: '',
      text: ['Data;Importo;Causale;Riferimento', '03/11/2026;30,00;raduno;CRO 70100'].join('\n'),
    })
    expect(result).toMatchObject({ kind: 'imported', added: 1, ignored: 0, matched: 1 })
    expect(bankRows(sheets).at(-1)?.slice(4)).toEqual(['P-2026-0016', ''])
  })

  it('le iscrizioni al Raduno si contano a parte, col motivo, e non vanno fra le uscite né in «Da abbinare»', () => {
    const { deps, sheets } = office()
    const result = importBank(deps, { person: '', text: extract })
    expect(result).toMatchObject({ kind: 'imported', added: 5, ignored: 3 })
    expect(bankRows(sheets).map((row) => row[5])).toEqual([
      '',
      '',
      '',
      '',
      'è un’uscita',
      'Iscrizione al Raduno',
      'Iscrizione al Raduno',
      '',
      '',
    ])
    const { bank, toMatch, toCheck } = viewOf(result).dashboard
    expect(bank.outflows).toBe(1)
    expect(bank.raduno.map(({ line, why }) => [line.reference, why])).toEqual([
      ['CRO 701', 'Iscrizione al Raduno'],
      ['CRO 702', 'Iscrizione al Raduno'],
    ])
    expect(bank.notDues).toEqual([])
    expect(toMatch.flatMap((item) => (item.kind === 'bankWithoutPayment' ? [item.line.reason] : []))).toEqual([
      'quota Verdi',
      'erogazione liberale a sostegno attivita',
      'magliette',
    ])
    expect(toCheck.filter((item) => item.includes('«Estratto conto»'))).toEqual([])
  })

  it('«Non è una quota» mette la riga da parte col motivo: esce da «Da abbinare» e si conta a parte', () => {
    const { deps, sheets } = office()
    const view = viewOf(importBank(deps, { person: '', text: extract }))
    const line = toMatchLine(view, 'erogazione liberale a sostegno attivita')
    const result = ignoreBankLine(deps, { person: '', line, reason: '  donazione ' })
    expect(result).toMatchObject({ kind: 'done', mail: 'none' })
    expect(bankRows(sheets)[line.index - 1]?.[5]).toBe('donazione')
    const { bank, toMatch } = viewOf(result).dashboard
    expect(bank.notDues.map(({ line: aside, why }) => [aside.reference, why])).toEqual([['CRO 703', 'donazione']])
    expect(bank.outflows).toBe(1)
    expect(toMatch.some((item) => item.kind === 'bankWithoutPayment' && item.line.reference === 'CRO 703')).toBe(false)
    expect(paymentRows(sheets)).toHaveLength(30)
  })

  it('reincollare lo stesso estratto, o uno che lo contiene, non cancella il motivo scritto a mano', () => {
    const { deps, sheets } = office()
    const view = viewOf(importBank(deps, { person: '', text: extract }))
    ignoreBankLine(deps, { person: '', line: toMatchLine(view, 'magliette'), reason: 'magliette' })
    ignoreBankLine(deps, {
      person: '',
      line: toMatchLine(view, 'erogazione liberale a sostegno attivita'),
      reason: 'donazione',
    })
    const why = () => bankRows(sheets).map((row) => row[5])
    const before = why()
    expect(importBank(deps, { person: '', text: extract })).toMatchObject({ kind: 'imported', added: 0 })
    expect(why()).toEqual(before)
    const longer = `${extract}\n05/11/2026;30,00;tesseramento socio 2027 n. 9;CRO 704`
    const result = importBank(deps, { person: '', text: longer })
    expect(result).toMatchObject({ kind: 'imported', added: 1, alreadyPasted: 5 })
    expect(why().slice(0, -1)).toEqual(before)
    expect(viewOf(result).dashboard.bank.notDues.map(({ why: reason }) => reason)).toEqual(['donazione', 'magliette'])
  })

  it('il motivo a mano resta nella cella anche se la riga passa per un perché dell’abbinamento e poi si corregge', () => {
    const { deps, sheets } = office()
    const view = viewOf(importBank(deps, { person: '', text: extract }))
    const line = toMatchLine(view, 'magliette')
    ignoreBankLine(deps, { person: '', line, reason: 'magliette del banchetto' })
    const row = sheets[SOCI_SHEETS.bank.name]?.[line.index] ?? []
    const why = () => bankRows(sheets)[line.index - 1]?.[5]
    // L'importo si rompe a mano: l'abbinamento la mette fra quelle che non si leggono, ma la cella tiene il motivo.
    row[1] = '1S,00'
    const broken = importBank(deps, { person: '', text: `${extract}\n05/11/2026;30,00;quota Verdi;CRO 705` })
    expect(why()).toBe('magliette del banchetto')
    expect(viewOf(broken).dashboard.toCheck).toContain(
      `«Estratto conto», riga ${line.index + 1}: l’importo non si legge.`,
    )
    row[1] = 15
    const fixed = importBank(deps, { person: '', text: `${extract}\n06/11/2026;30,00;quota Neri;CRO 706` })
    expect(why()).toBe('magliette del banchetto')
    expect(viewOf(fixed).dashboard.bank.notDues.map(({ why: reason }) => reason)).toEqual(['magliette del banchetto'])
  })

  it('una riga già segnata da un altro non si risegna con un altro motivo: lo stesso motivo va bene', () => {
    const { deps, sheets } = office()
    const view = viewOf(importBank(deps, { person: '', text: extract }))
    const line = toMatchLine(view, 'magliette')
    expect(ignoreBankLine(deps, { person: '', line, reason: 'magliette' })).toMatchObject({ kind: 'done' })
    // La seconda persona ha ancora la pagina di prima, con la riga in «Da abbinare».
    expect(ignoreBankLine(deps, { person: '', line, reason: 'donazione' })).toEqual({
      kind: 'error',
      message: 'Questa riga è già segnata: «magliette». Torna a Pagamenti.',
    })
    expect(bankRows(sheets)[line.index - 1]?.[5]).toBe('magliette')
    expect(ignoreBankLine(deps, { person: '', line, reason: ' magliette ' })).toMatchObject({ kind: 'done' })
  })

  it('il motivo è obbligatorio e breve, spetta a chi registra, e la riga deve essere ancora quella', () => {
    const { deps, sheets, writes } = office()
    const view = viewOf(importBank(deps, { person: '', text: extract }))
    const line = toMatchLine(view, 'magliette')
    writes.length = 0
    expect(ignoreBankLine(deps, { person: '', line, reason: '  ' })).toEqual({
      kind: 'invalid',
      field: 'reason',
      message: 'Scrivi il motivo, per esempio «donazione» o «magliette».',
    })
    expect(ignoreBankLine(deps, { person: '', line, reason: 'x'.repeat(101) })).toEqual({
      kind: 'invalid',
      field: 'reason',
      message: 'Bastano poche parole: al massimo 100 segni.',
    })
    // Un perché dell'abbinamento si ricalcola a ogni importazione: come motivo a mano si perderebbe.
    for (const reason of [' iscrizione al Raduno ', 'è un’uscita'])
      expect(ignoreBankLine(deps, { person: '', line, reason })).toEqual({
        kind: 'invalid',
        field: 'reason',
        message:
          'Queste parole le scrive la Bussola da sola, e le ricalcola a ogni importazione: scrivi il motivo con parole tue, per esempio «Raduno».',
      })
    const partTime = office({ email: DEMO_SHARED_ACCOUNT, sheets })
    expect(ignoreBankLine(partTime.deps, { person: DEMO_OFFICE.partTime, line, reason: 'magliette' })).toEqual({
      kind: 'error',
      message: 'Segnare le righe dell’estratto conto spetta a chi ha «può registrare pagamenti» in «Accessi».',
    })
    expect(ignoreBankLine(deps, { person: '', line: { ...line, amount: 16 }, reason: 'magliette' })).toEqual({
      kind: 'error',
      message: 'Questa riga dell’estratto conto è cambiata nel Foglio: torna a Pagamenti e riprova.',
    })
    // Una riga abbinata, o già messa da parte dall'abbinamento, non è da abbinare.
    const matched = bankRows(sheets)[0] ?? []
    const first = {
      index: 1,
      date: String(matched[0]),
      amount: Number(matched[1]),
      reason: String(matched[2]),
      reference: String(matched[3]),
    }
    expect(ignoreBankLine(deps, { person: '', line: first, reason: 'magliette' })).toEqual({
      kind: 'error',
      message: 'Questa riga non è più da abbinare: torna a Pagamenti.',
    })
    expect(writes).toEqual([])
  })
})

describe('le scadenze dalla segreteria', () => {
  it('«Fatta» scrive la data nel Foglio contenuti, e la scadenza esce da «Oggi»', () => {
    const { deps, content } = office()
    const result = deadlineDone(deps, { person: '', deadlineId: 'SCA-0001' })
    expect(result).toMatchObject({ kind: 'done' })
    expect(viewOf(result).dashboard.deadlines.map((deadline) => deadline.id)).not.toContain('SCA-0001')
    const row =
      content && readTable(content, SHEETS.deadlines).rows.find((candidate) => candidate.get('id') === 'SCA-0001')
    expect(row?.get('fatta il')).toBe('2026-11-05')
  })

  it('la misura del mese chiede il numero e lo scrive in «Misure», riga O9', () => {
    const contentSheets = demoSheets(DEMO_SOCI_NOW)
    contentSheets[SHEETS.deadlines.name]?.push([
      'MIS-O9-2026-11',
      'Conta i messaggi senza risposta da più di 5 giorni (mail e Instagram)',
      'misura',
      '2026-11-30',
      'il segretario',
      '',
      '',
      'no',
    ])
    const { deps, content } = office({ content: contentSheets })
    expect(
      viewOf(openOffice(deps, '')).dashboard.deadlines.find((deadline) => deadline.id === 'MIS-O9-2026-11'),
    ).toMatchObject({
      kind: 'measure',
      measureObjective: 'O9',
    })
    expect(deadlineDone(deps, { person: '', deadlineId: 'MIS-O9-2026-11' })).toEqual({
      kind: 'invalid',
      field: 'measure',
      message: 'Scrivi quanti messaggi sono senza risposta da più di 5 giorni.',
    })
    expect(deadlineDone(deps, { person: '', deadlineId: 'MIS-O9-2026-11', measure: '2' })).toMatchObject({
      kind: 'done',
    })
    const o9 =
      content && readTable(content, SHEETS.measures).rows.find((row) => String(row.get('obiettivo')).startsWith('O9'))
    expect(o9?.get('prima')).toBe(2)
  })

  it('una scadenza che non c’è, o senza il Foglio contenuti, lo dice', () => {
    const { deps } = office()
    expect(deadlineDone(deps, { person: '', deadlineId: 'SCA-9999' })).toEqual({
      kind: 'invalid',
      field: 'deadline',
      message: 'Non trovo la scadenza SCA-9999.',
    })
    expect(deadlineDone(office({ content: null }).deps, { person: '', deadlineId: 'SCA-0001' })).toEqual({
      kind: 'error',
      message: 'Il Foglio contenuti non è collegato: le scadenze non si segnano da qui.',
    })
  })
})

describe('il libro soci dalla segreteria', () => {
  it('«Salva nel Drive» crea la copia di oggi e «Oggi» ne dice la data', () => {
    const { deps, drive } = office()
    const result = saveRegister(deps, { person: '' })
    expect(result).toMatchObject({ kind: 'done' })
    expect(drive.map((file) => file.name)).toEqual(['Libro soci al 2026-11-05'])
    expect(drive[0]?.rows[0]).not.toContain('mail')
    expect(viewOf(result).dashboard.register).toEqual({
      savedOn: '2026-11-05',
      url: 'https://docs.google.com/spreadsheets/d/libro-1/edit',
      failedOn: '',
      error: '',
    })
  })

  it('se il Drive non risponde lo dice, e «Oggi» lo ricorda', () => {
    const { deps } = office({ driveFails: true })
    expect(saveRegister(deps, { person: '' })).toEqual({
      kind: 'error',
      message: 'Il libro soci non è stato salvato: Drive non risponde',
    })
    expect(viewOf(openOffice(deps, '')).dashboard.register).toMatchObject({
      failedOn: '2026-11-05',
      error: 'Drive non risponde',
    })
    expect(saveRegister({ ...deps, registerStore: null }, { person: '' })).toEqual({
      kind: 'error',
      message: 'Il Drive non è collegato: il libro soci non si salva da qui.',
    })
  })
})
