import { describe, expect, it } from 'vitest'
import {
  countsTowardsDues,
  DEFAULT_DUES_SETTINGS,
  findPossibleDuplicate,
  firstFreeYear,
  isFirstQuota,
  matchesFilter,
  memberCounts,
  memberStatus,
  nextPaymentId,
  statusLabel,
  validYearFor,
  type DuesPayment,
  type MemberFilter,
  type MemberStatus,
} from './dues.ts'

const today = '2026-10-20'
let seq = 0
const payment = (fields: Partial<DuesPayment>): DuesPayment => ({
  id: `P-2026-${String(++seq).padStart(4, '0')}`,
  memberNumber: 'M01',
  validYear: 2026,
  amount: 30,
  date: '2026-03-01',
  method: 'transfer',
  reference: '',
  status: 'recorded',
  ...fields,
})

describe('countsTowardsDues', () => {
  it('conta un pagamento registrato con un socio, anche se viene dal libro soci', () => {
    expect(countsTowardsDues(payment({}))).toBe(true)
    expect(countsTowardsDues(payment({ method: 'register', date: '' }))).toBe(true)
  })

  it('non conta in attesa del tesoriere, annullato o senza socio', () => {
    expect(countsTowardsDues(payment({ status: 'pendingTreasurer' }))).toBe(false)
    expect(countsTowardsDues(payment({ status: 'cancelled' }))).toBe(false)
    expect(countsTowardsDues(payment({ memberNumber: '' }))).toBe(false)
    expect(countsTowardsDues(payment({ memberNumber: '  ' }))).toBe(false)
  })
})

describe('memberStatus', () => {
  it('con la quota dell’anno è in regola', () => {
    expect(memberStatus('', [payment({ validYear: 2026 })], today)).toBe('inGoodStanding')
  })

  it('con la quota dell’anno e dell’anno dopo è in regola, non «già in regola per l’anno dopo»', () => {
    expect(memberStatus('', [payment({ validYear: 2026 }), payment({ validYear: 2027 })], today)).toBe('inGoodStanding')
  })

  it('con la sola quota dell’anno dopo è già in regola per l’anno dopo', () => {
    expect(memberStatus('', [payment({ validYear: 2027 })], today)).toBe('paidAhead')
  })

  it('con la sola quota dell’anno prima è da rinnovare', () => {
    expect(memberStatus('', [payment({ validYear: 2025 })], today)).toBe('dueForRenewal')
  })

  it('con quote più vecchie o senza quote non è in regola', () => {
    expect(memberStatus('', [payment({ validYear: 2024 })], today)).toBe('notInGoodStanding')
    expect(memberStatus('', [], today)).toBe('notInGoodStanding')
  })

  it('un receduto con la quota dell’anno resta receduto, anche dal giorno stesso', () => {
    expect(memberStatus('2026-05-01', [payment({ validYear: 2026 })], today)).toBe('left')
    expect(memberStatus(today, [payment({ validYear: 2026 })], today)).toBe('left')
  })

  it('un receduto con la data futura non lo è ancora', () => {
    expect(memberStatus('2026-12-31', [payment({ validYear: 2026 })], today)).toBe('inGoodStanding')
  })

  it('usa solo i pagamenti che contano', () => {
    expect(memberStatus('', [payment({ validYear: 2026, status: 'pendingTreasurer' })], today)).toBe(
      'notInGoodStanding',
    )
    expect(memberStatus('', [payment({ validYear: 2026, status: 'cancelled' })], today)).toBe('notInGoodStanding')
  })

  it('annullato un pagamento, il socio torna allo stato di prima', () => {
    const before = [payment({ validYear: 2025 })]
    const added = payment({ validYear: 2026 })
    expect(memberStatus('', [...before, added], today)).toBe('inGoodStanding')
    expect(memberStatus('', [...before, { ...added, status: 'cancelled' }], today)).toBe('dueForRenewal')
  })

  it('cambiato l’anno di validità, lo stato segue l’anno nuovo', () => {
    const before = [payment({ validYear: 2025 })]
    const added = payment({ validYear: 2026 })
    expect(memberStatus('', [...before, added], today)).toBe('inGoodStanding')
    expect(memberStatus('', [...before, { ...added, validYear: 2027 }], today)).toBe('paidAhead')
  })
})

describe('isFirstQuota', () => {
  it('è la prima quota se il socio non ha pagamenti che contano', () => {
    const payments = [
      payment({ memberNumber: 'M01', status: 'cancelled' }),
      payment({ memberNumber: 'M01', status: 'pendingTreasurer' }),
      payment({ memberNumber: 'M02' }),
    ]
    expect(isFirstQuota({ memberNumber: 'M01', admittedOn: '' }, today, payments)).toBe(true)
    expect(isFirstQuota({ memberNumber: 'M02', admittedOn: '' }, today, payments)).toBe(false)
  })

  it('un pagamento senza socio è trattato come prima quota', () => {
    expect(isFirstQuota({ memberNumber: '', admittedOn: '' }, today, [payment({ memberNumber: '' })])).toBe(true)
  })

  it('chi è stato ammesso in un anno prima rinnova, anche senza quote nel registro', () => {
    expect(isFirstQuota({ memberNumber: 'M09', admittedOn: '2020-03-01' }, '2026-10-20', [])).toBe(false)
    expect(isFirstQuota({ memberNumber: 'M09', admittedOn: '2025-12-31' }, '2026-10-20', [])).toBe(false)
  })

  it('chi è ammesso quest’anno, o non ha ancora la data di ammissione, paga la prima quota', () => {
    expect(isFirstQuota({ memberNumber: 'M09', admittedOn: '2026-01-01' }, '2026-10-20', [])).toBe(true)
    expect(isFirstQuota({ memberNumber: 'M09', admittedOn: '2026-10-25' }, '2026-10-20', [])).toBe(true)
    expect(isFirstQuota({ memberNumber: 'M09', admittedOn: '' }, '2026-10-20', [])).toBe(true)
  })
})

describe('validYearFor', () => {
  it('un nuovo socio che paga il 14/10 vale per l’anno, dal 15/10 per l’anno dopo', () => {
    expect(validYearFor('2026-10-14', true, DEFAULT_DUES_SETTINGS)).toBe(2026)
    expect(validYearFor('2026-10-15', true, DEFAULT_DUES_SETTINGS)).toBe(2027)
    expect(validYearFor('2026-12-31', true, DEFAULT_DUES_SETTINGS)).toBe(2027)
    expect(validYearFor('2026-01-01', true, DEFAULT_DUES_SETTINGS)).toBe(2026)
  })

  it('cambiando il giorno di cambio anno cambia il giorno', () => {
    const settings = { ...DEFAULT_DUES_SETTINGS, yearSwitchDay: '11-01' }
    expect(validYearFor('2026-10-15', true, settings)).toBe(2026)
    expect(validYearFor('2026-10-31', true, settings)).toBe(2026)
    expect(validYearFor('2026-11-01', true, settings)).toBe(2027)
  })

  it('di partenza un rinnovo tardivo vale per l’anno solare', () => {
    expect(validYearFor('2026-10-20', false, DEFAULT_DUES_SETTINGS)).toBe(2026)
  })

  it('con newMemberOnly false la regola vale per ogni pagamento', () => {
    expect(validYearFor('2026-10-20', false, { ...DEFAULT_DUES_SETTINGS, newMemberOnly: false })).toBe(2027)
  })
})

describe('il rinnovo tardivo e il nuovo socio di ottobre', () => {
  const settle = (memberNumber: string, history: DuesPayment[], settings = DEFAULT_DUES_SETTINGS) => {
    const validYear = validYearFor(today, isFirstQuota({ memberNumber, admittedOn: '' }, today, history), settings)
    const paid = payment({ memberNumber, validYear, date: today })
    return { validYear, status: memberStatus('', [...history, paid], today) }
  }

  it('chi ha la 2025 e paga il 20/10/2026: di partenza vale per il 2026 ed è in regola', () => {
    const history = [payment({ memberNumber: 'M01', validYear: 2025, date: '2025-02-10' })]
    expect(settle('M01', history)).toEqual({ validYear: 2026, status: 'inGoodStanding' })
  })

  it('chi ha la 2025 e paga il 20/10/2026: con newMemberOnly false vale per il 2027', () => {
    const history = [payment({ memberNumber: 'M01', validYear: 2025, date: '2025-02-10' })]
    expect(settle('M01', history, { ...DEFAULT_DUES_SETTINGS, newMemberOnly: false })).toEqual({
      validYear: 2027,
      status: 'paidAhead',
    })
  })

  it('un nuovo socio che paga il 20/10/2026 è già in regola per il 2027, non da rinnovare', () => {
    expect(settle('M99', [])).toEqual({ validYear: 2027, status: 'paidAhead' })
  })
})

describe('findPossibleDuplicate', () => {
  const existing = payment({ memberNumber: 'M01', validYear: 2026, reference: 'CRO 123' })

  it('stesso socio e stesso anno è un possibile doppione', () => {
    expect(findPossibleDuplicate({ memberNumber: 'M01', validYear: 2026, reference: '' }, [existing])).toBe(existing)
  })

  it('stesso socio e stesso riferimento con anno diverso è un possibile doppione', () => {
    expect(findPossibleDuplicate({ memberNumber: 'M01', validYear: 2027, reference: 'CRO 123' }, [existing])).toBe(
      existing,
    )
  })

  it('il riferimento si confronta senza spazi ai lati e senza maiuscole', () => {
    expect(findPossibleDuplicate({ memberNumber: 'M01', validYear: 2027, reference: '  cro 123 ' }, [existing])).toBe(
      existing,
    )
  })

  it('lo stesso riferimento con soci diversi non è mai un doppione', () => {
    expect(findPossibleDuplicate({ memberNumber: 'M02', validYear: 2026, reference: 'CRO 123' }, [existing])).toBe(null)
  })

  it('un pagamento annullato non fa doppione, uno in attesa del tesoriere sì', () => {
    const cancelled = { ...existing, status: 'cancelled' as const }
    const pending = { ...existing, status: 'pendingTreasurer' as const }
    const candidate = { memberNumber: 'M01', validYear: 2026, reference: 'CRO 123' }
    expect(findPossibleDuplicate(candidate, [cancelled])).toBe(null)
    expect(findPossibleDuplicate(candidate, [pending])).toBe(pending)
  })

  it('un candidato senza socio non è mai un doppione', () => {
    const unmatched = payment({ memberNumber: '', validYear: 2026, reference: 'CRO 123' })
    expect(findPossibleDuplicate({ memberNumber: '', validYear: 2026, reference: 'CRO 123' }, [unmatched])).toBe(null)
  })

  it('un riferimento vuoto (contanti) fa doppione solo per l’anno', () => {
    const cash = payment({ memberNumber: 'M01', validYear: 2026, method: 'cash', reference: '' })
    expect(findPossibleDuplicate({ memberNumber: 'M01', validYear: 2027, reference: '' }, [cash])).toBe(null)
    expect(findPossibleDuplicate({ memberNumber: 'M01', validYear: 2026, reference: '' }, [cash])).toBe(cash)
  })

  it('se ce n’è più d’uno, prima quello con lo stesso anno', () => {
    const sameReference = payment({ memberNumber: 'M01', validYear: 2025, reference: 'CRO 9' })
    const sameYear = payment({ memberNumber: 'M01', validYear: 2026, reference: 'CRO 1' })
    expect(
      findPossibleDuplicate({ memberNumber: 'M01', validYear: 2026, reference: 'CRO 9' }, [sameReference, sameYear]),
    ).toBe(sameYear)
  })
})

describe('firstFreeYear', () => {
  it('«è un altro pagamento»: la quota di due anni va al primo anno libero', () => {
    const payments = [payment({ memberNumber: 'M01', validYear: 2027 })]
    expect(firstFreeYear('M01', 2027, payments)).toBe(2028)
  })

  it('salta anche gli anni in attesa del tesoriere, non quelli annullati né quelli di altri soci', () => {
    const payments = [
      payment({ memberNumber: 'M01', validYear: 2027 }),
      payment({ memberNumber: 'M01', validYear: 2028, status: 'pendingTreasurer' }),
      payment({ memberNumber: 'M01', validYear: 2029, status: 'cancelled' }),
      payment({ memberNumber: 'M02', validYear: 2030 }),
    ]
    expect(firstFreeYear('M01', 2027, payments)).toBe(2029)
  })

  it('se il doppione era solo per il riferimento, l’anno resta', () => {
    const payments = [payment({ memberNumber: 'M01', validYear: 2026, reference: 'CRO 123' })]
    expect(firstFreeYear('M01', 2027, payments)).toBe(2027)
  })
})

describe('nextPaymentId', () => {
  it('il primo dell’anno è P-AAAA-0001', () => {
    expect(nextPaymentId(2026, [])).toBe('P-2026-0001')
  })

  it('segue il più alto dell’anno, ignorando gli altri anni e le altre forme', () => {
    const ids = ['P-2026-0007', 'P-2026-0041', 'P-2025-0099', 'L-2026-0500', 'P-2026-41b', '']
    expect(nextPaymentId(2026, ids)).toBe('P-2026-0042')
    expect(nextPaymentId(2025, ids)).toBe('P-2025-0100')
    expect(nextPaymentId(2027, ids)).toBe('P-2027-0001')
  })

  it('oltre 9999 cresce', () => {
    expect(nextPaymentId(2026, ['P-2026-9999'])).toBe('P-2026-10000')
    expect(nextPaymentId(2026, ['P-2026-10000', 'P-2026-9999'])).toBe('P-2026-10001')
  })
})

describe('statusLabel', () => {
  it('dice lo stato con le parole a schermo', () => {
    expect(statusLabel('left', 2026)).toBe('Receduto')
    expect(statusLabel('inGoodStanding', 2026)).toBe('In regola')
    expect(statusLabel('paidAhead', 2026)).toBe('Già in regola per il 2027')
    expect(statusLabel('dueForRenewal', 2026)).toBe('Da rinnovare')
    expect(statusLabel('notInGoodStanding', 2026)).toBe('Non in regola')
  })
})

describe('trenta pagamenti su ventuno soci', () => {
  // Oggi è il 20/10/2026: l'anno è il 2026, l'anno dopo il 2027, quello prima il 2025.
  const members: { number: string; leftOn: string }[] = [
    { number: 'M01', leftOn: '' }, // 2026 e 2027 annullato → in regola
    { number: 'M02', leftOn: '' }, // 2025 e 2026 → in regola
    { number: 'M03', leftOn: '' }, // 2025 e 2026 → in regola
    { number: 'M04', leftOn: '' }, // 2026 e 2027 → in regola
    { number: 'M05', leftOn: '' }, // 2026 dal libro soci → in regola
    { number: 'M06', leftOn: '' }, // 2027, nuovo socio di ottobre → già in regola per il 2027
    { number: 'M07', leftOn: '' }, // 2027 → già in regola per il 2027
    { number: 'M08', leftOn: '' }, // 2025 → da rinnovare
    { number: 'M09', leftOn: '' }, // 2025 dal libro soci → da rinnovare
    { number: 'M10', leftOn: '' }, // 2025 e 2026 annullato → da rinnovare
    { number: 'M11', leftOn: '' }, // 2025 e 2026 in attesa del tesoriere → da rinnovare
    { number: 'M12', leftOn: '' }, // 2024 → non in regola
    { number: 'M13', leftOn: '' }, // solo 2026 annullato → non in regola
    { number: 'M14', leftOn: '' }, // solo 2026 in attesa del tesoriere → non in regola
    { number: 'M15', leftOn: '' }, // 2024 e 2025 → da rinnovare
    { number: 'M16', leftOn: '2026-05-01' }, // 2026, receduto a maggio → receduto
    { number: 'M17', leftOn: '2026-12-31' }, // 2026, recede a fine anno → ancora in regola
    { number: 'M18', leftOn: '' }, // 2025 e 2027 → già in regola per il 2027
    { number: 'M19', leftOn: '' }, // 2023 → non in regola
    { number: 'M20', leftOn: '' }, // 2026 → in regola
    { number: 'M21', leftOn: '' }, // nessun pagamento → non in regola
  ]
  const payments: DuesPayment[] = [
    payment({ memberNumber: 'M01', validYear: 2026 }),
    payment({ memberNumber: 'M01', validYear: 2027, status: 'cancelled' }),
    payment({ memberNumber: 'M02', validYear: 2025, date: '2025-01-20' }),
    payment({ memberNumber: 'M02', validYear: 2026 }),
    payment({ memberNumber: 'M03', validYear: 2025, date: '2025-02-11' }),
    payment({ memberNumber: 'M03', validYear: 2026, method: 'cash' }),
    payment({ memberNumber: 'M04', validYear: 2026 }),
    payment({ memberNumber: 'M04', validYear: 2027, date: '2026-09-30' }),
    payment({ memberNumber: 'M05', validYear: 2026, method: 'register', date: '' }),
    payment({ memberNumber: 'M06', validYear: 2027, date: '2026-10-16' }),
    payment({ memberNumber: 'M07', validYear: 2027, date: '2026-10-18' }),
    payment({ memberNumber: 'M08', validYear: 2025, date: '2025-03-01' }),
    payment({ memberNumber: 'M09', validYear: 2025, method: 'register', date: '' }),
    payment({ memberNumber: 'M10', validYear: 2025, date: '2025-04-01' }),
    payment({ memberNumber: 'M10', validYear: 2026, status: 'cancelled' }),
    payment({ memberNumber: 'M11', validYear: 2025, date: '2025-04-02' }),
    payment({ memberNumber: 'M11', validYear: 2026, status: 'pendingTreasurer' }),
    payment({ memberNumber: 'M12', validYear: 2024, date: '2024-05-01' }),
    payment({ memberNumber: 'M13', validYear: 2026, status: 'cancelled' }),
    payment({ memberNumber: 'M14', validYear: 2026, status: 'pendingTreasurer' }),
    payment({ memberNumber: 'M15', validYear: 2024, date: '2024-01-15' }),
    payment({ memberNumber: 'M15', validYear: 2025, date: '2025-01-15' }),
    payment({ memberNumber: 'M16', validYear: 2026 }),
    payment({ memberNumber: 'M17', validYear: 2026 }),
    payment({ memberNumber: 'M18', validYear: 2025, date: '2025-06-01' }),
    payment({ memberNumber: 'M18', validYear: 2027, date: '2026-10-19' }),
    payment({ memberNumber: 'M19', validYear: 2023, date: '2023-02-01' }),
    payment({ memberNumber: 'M20', validYear: 2026 }),
    payment({ memberNumber: '', validYear: 2026, reference: 'BONIFICO SENZA NOME' }),
    payment({ memberNumber: '', validYear: 2026, method: 'cash' }),
  ]
  const statuses = members.map((member) =>
    memberStatus(
      member.leftOn,
      payments.filter((paid) => paid.memberNumber === member.number),
      today,
    ),
  )

  it('sono trenta pagamenti', () => {
    expect(payments).toHaveLength(30)
  })

  it('i numeri tornano con il conto fatto a mano', () => {
    // In regola: M01, M02, M03, M04, M05, M17, M20 = 7. Già in regola per il 2027: M06, M07, M18 = 3.
    // Da rinnovare: M08, M09, M10, M11, M15 = 5. Non in regola: M12, M13, M14, M19, M21 = 5. Receduto: M16 = 1.
    // I soci non receduti: 7 + 3 + 5 + 5 = 20. I due pagamenti senza socio non toccano nessuno.
    expect(memberCounts(statuses)).toEqual({
      inGoodStanding: 7,
      paidAhead: 3,
      dueForRenewal: 5,
      notInGoodStanding: 5,
      left: 1,
      members: 20,
    })
  })

  it('la somma dei quattro stati è il totale dei soci non receduti', () => {
    const counts = memberCounts(statuses)
    const notLeft = members.filter((member) => !member.leftOn || member.leftOn > today).length
    expect(counts.inGoodStanding + counts.paidAhead + counts.dueForRenewal + counts.notInGoodStanding).toBe(notLeft)
    expect(counts.members).toBe(notLeft)
  })

  it('ogni socio ha uno stato solo, fra quelli previsti', () => {
    expect(statuses).toHaveLength(members.length)
  })

  it.each([
    // Tutti: i 21 soci, anche il receduto. In regola: i 7 di sopra, senza i 3 già in regola per il 2027.
    // Da rinnovare: i 5 di sopra.
    ['all', 21],
    ['inGoodStanding', 7],
    ['dueForRenewal', 5],
  ] as [MemberFilter, number][])('il filtro «%s» tiene %i soci', (filter, expected) => {
    expect(statuses.filter((status) => matchesFilter(status, filter))).toHaveLength(expected)
  })
})

describe('matchesFilter', () => {
  const all: MemberStatus[] = ['left', 'inGoodStanding', 'paidAhead', 'dueForRenewal', 'notInGoodStanding']

  it('«Tutti» tiene ogni stato, anche il receduto', () => {
    expect(all.every((status) => matchesFilter(status, 'all'))).toBe(true)
  })

  it('«In regola» non tiene «già in regola per l’anno dopo», «Da rinnovare» tiene solo da rinnovare', () => {
    expect(all.filter((status) => matchesFilter(status, 'inGoodStanding'))).toEqual(['inGoodStanding'])
    expect(all.filter((status) => matchesFilter(status, 'dueForRenewal'))).toEqual(['dueForRenewal'])
  })
})
