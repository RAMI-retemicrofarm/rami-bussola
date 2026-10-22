import { romeDate } from '@bussola/condiviso'
import { describe, expect, it } from 'vitest'
import { ContentError, readTable } from './content.ts'
import {
  isYes,
  OFFICE_SETTINGS,
  paymentMethodCell,
  paymentStatusCell,
  readAccess,
  readDayMonth,
  readMembers,
  readOfficeSettings,
  readPayments,
  SOCI_SHEETS,
} from './members.ts'
import { memoryWorkbook } from './memory.ts'

const table = (spec: (typeof SOCI_SHEETS)[keyof typeof SOCI_SHEETS], rows: unknown[][]) =>
  readTable(memoryWorkbook({ [spec.name]: [[...spec.columns], ...rows] }), spec)

describe('isYes', () => {
  it('«sì», «si», «x» e vero valgono sì; tutto il resto no', () => {
    for (const value of ['sì', 'Sì ', 'si', 'SI', 'x', 'X', true]) expect(isYes(value), String(value)).toBe(true)
    for (const value of ['no', '', 'forse', 'yes', false, 1, null, undefined])
      expect(isYes(value), String(value)).toBe(false)
  })
})

describe('readAccess', () => {
  it('legge persona, mail senza maiuscole e spazi, ruolo e i tre sì/no', () => {
    const access = readAccess(
      table(SOCI_SHEETS.access, [
        ['Rossana Ferri', ' Segreteria@Example.org ', 'Segretario', 'sì', 'x', ''],
        ['Piero Neri', 'condivisa@example.org', 'tesoriere', true, 'si', 'sì'],
        ['Ugo Bassi', 'ugo@example.org', 'presidente', 'no', 'sì', 'sì'],
        ['', '', '', '', '', ''],
      ]),
    )
    expect(access).toEqual([
      {
        index: 1,
        person: 'Rossana Ferri',
        email: 'segreteria@example.org',
        role: 'segretario',
        enters: true,
        canRecord: true,
        canConfirm: false,
      },
      {
        index: 2,
        person: 'Piero Neri',
        email: 'condivisa@example.org',
        role: 'tesoriere',
        enters: true,
        canRecord: true,
        canConfirm: true,
      },
      // Un ruolo che non è dei tre resta vuoto: la persona non è il segretario.
      {
        index: 3,
        person: 'Ugo Bassi',
        email: 'ugo@example.org',
        role: '',
        enters: false,
        canRecord: true,
        canConfirm: true,
      },
    ])
  })
})

describe('readDayMonth', () => {
  it('legge «15/10», «15 ottobre», «1/4» e una data di Google come «MM-GG»', () => {
    expect(readDayMonth('15/10', romeDate)).toBe('10-15')
    expect(readDayMonth(' 15 Ottobre ', romeDate)).toBe('10-15')
    expect(readDayMonth('1/4', romeDate)).toBe('04-01')
    expect(readDayMonth('29/2', romeDate)).toBe('02-29')
    expect(readDayMonth('15/10/2026', romeDate)).toBe('10-15')
    expect(readDayMonth(new Date('2026-10-14T22:00:00Z'), romeDate)).toBe('10-15')
  })

  it('un giorno che non esiste o non si legge non vale', () => {
    for (const value of ['31/4', '0/10', '15/13', 'metà ottobre', '15-10', 12])
      expect(readDayMonth(value, romeDate)).toBeNull()
  })
})

describe('readOfficeSettings', () => {
  const settings = (rows: unknown[][]) => readOfficeSettings(table(SOCI_SHEETS.settings, rows), romeDate)

  it('una voce che manca prende il valore di partenza', () => {
    expect(settings([])).toEqual({
      dues: { yearSwitchDay: '10-15', newMemberOnly: true, graceUntil: '03-31', amount: 30 },
      cashReceipt: true,
      instructionsUrl: '',
      readers: [],
    })
  })

  it('i valori di partenza scritti da setupSoci si leggono come le regole di partenza', () => {
    const rows = Object.values(OFFICE_SETTINGS).map(({ voce, partenza }) => [voce, partenza, ''])
    expect(settings(rows)).toEqual(settings([]))
  })

  it('legge giorno, regola di ottobre, grazia, importo, ricevuta, istruzioni e chi legge il Foglio soci', () => {
    expect(
      settings([
        ['Giorno di cambio anno', '1 ottobre'],
        ['la regola di ottobre vale anche per chi rinnova in ritardo', 'sì'],
        ['fine della grazia', new Date('2026-04-29T22:00:00Z')],
        ['importo della quota', '35,50'],
        ['per i contanti, la mail fa da ricevuta', 'no'],
        ['link alle Istruzioni della segreteria', 'https://docs.google.com/document/d/abc/edit'],
        ['legge il Foglio soci', ' Cura@Example.org ', 'chi cura la Bussola'],
        ['legge il Foglio soci', '', 'chi cura la Bussola: scrivi la sua mail'],
        ['legge il Foglio soci', 'copia@progetto.iam.gserviceaccount.com', 'la copia'],
        ['una voce che il motore non conosce', 'qualcosa'],
      ]),
    ).toEqual({
      dues: { yearSwitchDay: '10-01', newMemberOnly: false, graceUntil: '04-30', amount: 35.5 },
      cashReceipt: false,
      instructionsUrl: 'https://docs.google.com/document/d/abc/edit',
      readers: ['cura@example.org', 'copia@progetto.iam.gserviceaccount.com'],
    })
  })

  it('«la regola di ottobre…» a no o vuota vale solo per i nuovi soci', () => {
    const rule = 'la regola di ottobre vale anche per chi rinnova in ritardo'
    expect(settings([[rule, 'no']]).dues.newMemberOnly).toBe(true)
    expect(settings([[rule, '']]).dues.newMemberOnly).toBe(true)
    expect(settings([[rule, 'x']]).dues.newMemberOnly).toBe(false)
  })

  it('una voce scritta male ferma tutto, e dice quale voce e come scriverla', () => {
    const cases: [string, unknown, RegExp][] = [
      ['giorno di cambio anno', 'metà ottobre', /«giorno di cambio anno».*per esempio 15\/10/],
      ['fine della grazia', '31/2', /«fine della grazia».*per esempio 31\/3/],
      ['la regola di ottobre vale anche per chi rinnova in ritardo', 'forse', /sì o no/],
      ['importo della quota', 'trenta', /«importo della quota».*per esempio 30/],
      ['importo della quota', 0, /«importo della quota»/],
      ['per i contanti, la mail fa da ricevuta', 'boh', /sì o no/],
      ['link alle Istruzioni della segreteria', 'javascript:alert(1)', /https:\/\//],
      ['legge il Foglio soci', 'Mario Rossi', /una mail/],
    ]
    for (const [voce, value, message] of cases) {
      const read = () => settings([[voce, value]])
      expect(read, voce).toThrow(ContentError)
      expect(read, voce).toThrow(message)
    }
  })
})

describe('readMembers', () => {
  it('legge il socio con numero, nomi, mail, tipo e date', () => {
    const members = readMembers(
      table(SOCI_SHEETS.members, [
        [12, 'Ferri', 'Rossana', 'Rossana@Example.org', '333 1234567', 'Professionista', '2020-03-01', 'D-1', '', 'n'],
        ['13', 'Neri', 'Piero', '', '', 'sostenitore', new Date('2021-05-04T22:00:00Z'), '', '31/12/2025', ''],
        [14, 'Bassi', 'Ugo', 'ugo@example.org', '', '', '', '', '', ''],
      ]),
      romeDate,
    )
    expect(members).toEqual([
      {
        index: 1,
        number: '12',
        lastName: 'Ferri',
        firstName: 'Rossana',
        email: 'rossana@example.org',
        phone: '333 1234567',
        type: 'producer',
        admittedOn: '2020-03-01',
        leftOn: '',
      },
      {
        index: 2,
        number: '13',
        lastName: 'Neri',
        firstName: 'Piero',
        email: '',
        phone: '',
        type: 'supporter',
        admittedOn: '2021-05-05',
        leftOn: '2025-12-31',
      },
      {
        index: 3,
        number: '14',
        lastName: 'Bassi',
        firstName: 'Ugo',
        email: 'ugo@example.org',
        phone: '',
        type: '',
        admittedOn: '',
        leftOn: '',
      },
    ])
  })

  it('un numero che manca o ripetuto, o una data che non si legge, ferma tutto con la riga', () => {
    const read = (rows: unknown[][]) => () => readMembers(table(SOCI_SHEETS.members, rows), romeDate)
    expect(read([['', 'Ferri', 'Rossana', '', '', '', '', '', '', '']])).toThrow(/«Soci», riga 2: manca il numero/)
    expect(
      read([
        [12, 'Ferri', 'Rossana', '', '', '', '', '', '', ''],
        ['12', 'Neri', 'Piero', '', '', '', '', '', '', ''],
      ]),
    ).toThrow(/«Soci», riga 3: il numero 12 c’è già alla riga 2/)
    expect(read([[12, 'Ferri', 'Rossana', '', '', '', '', '', 'ieri', '']])).toThrow(
      /«Soci», riga 2: la data «ieri» in «receduto il» non la leggo/,
    )
  })

  it('senza la colonna «ammesso il» ferma tutto: ogni socio sembrerebbe nuovo, e la quota passerebbe all’anno dopo', () => {
    const columns = SOCI_SHEETS.members.columns.filter((column) => column !== 'ammesso il')
    const workbook = memoryWorkbook({ [SOCI_SHEETS.members.name]: [[...columns], [12, 'Ferri', 'Rossana']] })
    expect(() => readTable(workbook, SOCI_SHEETS.members)).toThrow(
      new ContentError('«Soci»: manca la colonna «ammesso il».'),
    )
  })
})

describe('readPayments', () => {
  const payments = (rows: unknown[][]) => readPayments(table(SOCI_SHEETS.payments, rows), romeDate)
  const line = (values: Partial<Record<string, unknown>>) =>
    SOCI_SHEETS.payments.columns.map((name) => values[name] ?? '')

  it('legge un pagamento, con importo e anno da numero o da testo', () => {
    const [payment] = payments([
      line({
        id: 'P-2026-0001',
        'numero socio': 12,
        "vale per l'anno": '2027',
        importo: '30,00',
        data: new Date('2026-10-15T22:00:00Z'),
        modo: 'Bonifico',
        riferimento: 8841,
        'registrato da': 'Rossana Ferri',
        account: 'segreteria@example.org',
        'registrato il': '2026-10-16',
        stato: 'registrato',
        'motivo o nota': 'quota',
        'chiave della registrazione': 'k1',
      }),
    ])
    expect(payment).toEqual({
      index: 1,
      id: 'P-2026-0001',
      memberNumber: '12',
      validYear: 2027,
      amount: 30,
      date: '2026-10-16',
      method: 'transfer',
      reference: '8841',
      collectedBy: '',
      recordedBy: 'Rossana Ferri',
      account: 'segreteria@example.org',
      recordedOn: '2026-10-16',
      cashReceivedOn: '',
      status: 'recorded',
      note: 'quota',
      requestKey: 'k1',
    })
  })

  it('lo stato vuoto è registrato; una parola che non conosce non conta, come in attesa', () => {
    const read = (stato: string) =>
      payments([
        line({ id: 'P-1', 'numero socio': 1, "vale per l'anno": 2026, importo: 30, modo: 'contanti', stato }),
      ])[0]?.status
    expect(read('')).toBe('recorded')
    expect(read('Annullato')).toBe('cancelled')
    expect(read('in attesa del tesoriere')).toBe('pendingTreasurer')
    expect(read('registratto')).toBe('pendingTreasurer')
  })

  it('le quote del libro soci non hanno data né importo', () => {
    const [payment] = payments([
      line({ id: 'L-2026-0001', 'numero socio': 3, "vale per l'anno": 2026, modo: 'libro soci' }),
    ])
    expect(payment).toMatchObject({ method: 'register', date: '', amount: 0, status: 'recorded' })
  })

  it('un anno, un importo, una data o un modo che non si leggono fermano tutto con la riga', () => {
    const base = { id: 'P-1', 'numero socio': 1, "vale per l'anno": 2026, importo: 30, modo: 'bonifico' }
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ "vale per l'anno": 'duemila' }, /«Pagamenti», riga 2: l’anno «duemila» in «vale per l'anno» non lo leggo/],
      [{ "vale per l'anno": '' }, /«Pagamenti», riga 2: l’anno «» in «vale per l'anno» non lo leggo/],
      [{ importo: 'trenta' }, /«Pagamenti», riga 2: l’importo «trenta» non lo leggo/],
      [{ data: '32/10/2026' }, /«Pagamenti», riga 2: la data «32\/10\/2026» in «data» non la leggo/],
      [
        { modo: 'assegno' },
        /«Pagamenti», riga 2: il modo «assegno» non lo conosco: scrivi bonifico, contanti o libro soci/,
      ],
    ]
    for (const [change, message] of cases) expect(() => payments([line({ ...base, ...change })])).toThrow(message)
  })

  it('un id ripetuto ferma tutto con le due righe; gli id vuoti non sono doppioni', () => {
    const base = { 'numero socio': 1, "vale per l'anno": 2026, importo: 30, modo: 'bonifico' }
    expect(() =>
      payments([
        line({ ...base, id: 'P-2026-0003' }),
        line({ ...base, id: 'P-2026-0004' }),
        line({ ...base, id: ' P-2026-0003' }),
      ]),
    ).toThrow(new ContentError('«Pagamenti», riga 4: il numero P-2026-0003 c’è già alla riga 2.'))
    expect(payments([line({ ...base, id: '' }), line({ ...base, id: '' })])).toHaveLength(2)
  })

  it('le parole delle celle tornano dai codici', () => {
    expect(paymentMethodCell('transfer')).toBe('bonifico')
    expect(paymentMethodCell('register')).toBe('libro soci')
    expect(paymentStatusCell('pendingTreasurer')).toBe('in attesa del tesoriere')
  })
})
