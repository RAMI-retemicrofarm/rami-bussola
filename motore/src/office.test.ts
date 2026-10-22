import { matchesFilter, MEMBER_STATUSES, romeDate, type MemberFilter } from '@bussola/condiviso'
import { describe, expect, it } from 'vitest'
import { DEMO_EMAILS } from './demo.ts'
import {
  DEMO_INSTRUCTIONS_URL,
  DEMO_OFFICE,
  DEMO_SHARED_ACCOUNT,
  DEMO_SOCI_COUNTS,
  DEMO_SOCI_NOW,
  demoSociSheets,
} from './demo-soci.ts'
import { SOCI_SHEETS } from './members.ts'
import { memoryState, memoryWorkbook } from './memory.ts'
import {
  cancelPayment,
  changePaymentYear,
  openOffice,
  previewPayment,
  recordPayment,
  type OfficeDeps,
} from './office.ts'
import type { OfficeView, PaymentInput } from './office-api.ts'
import type { Mail } from './receipt.ts'
import { SHARING_STATE_KEY } from './sharing.ts'

const formatInstant = (instant: Date) =>
  new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' }).format(instant)

type Setup = { email?: string; sheets?: Record<string, unknown[][]>; mailFails?: boolean }

function office({ email = DEMO_EMAILS.office, sheets = demoSociSheets(), mailFails = false }: Setup = {}) {
  const workbook = memoryWorkbook(sheets)
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
  }
  return { deps, sheets, writes, mails, state, locks: () => locks }
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
    expect(view.todayForSecretary).toEqual({
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
    expect(viewOf(openOffice(deps, '')).todayForSecretary).toMatchObject({
      sharingCheckedOn: '2026-11-05',
      sharing: [finding],
    })
  })

  it('per chi non è il segretario «Oggi» non ha queste voci', () => {
    expect(viewOf(open({ email: DEMO_SHARED_ACCOUNT }, DEMO_OFFICE.treasurer)).todayForSecretary).toBeNull()
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
    const result = recordPayment(office().deps, input({ memberNumber: '7', date: '2026-03-01', reference: '0004' }))
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
    const result = recordPayment(office().deps, input({ memberNumber: '18', reference: '5501' }))
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

  it('le giunture della segreteria non hanno KV: con la vetrina ferma si registra lo stesso', () => {
    const { deps } = office()
    expect(Object.keys(deps).sort()).toEqual([
      'email',
      'formatInstant',
      'now',
      'sendMail',
      'state',
      'toCalendarDate',
      'withLock',
      'workbook',
    ])
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
