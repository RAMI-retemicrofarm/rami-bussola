import { describe, expect, it } from 'vitest'
import { DEFAULT_DUES_SETTINGS, type DuesPayment } from './dues.ts'
import { RENEWAL_TARGET_PERCENT, renewals, renewalsLabel, type Renewals } from './renewals.ts'

let seq = 0
const label = (result: Renewals | null) => (result ? renewalsLabel(result) : '')
const payment = (memberNumber: string, validYear: number, date: string, fields: Partial<DuesPayment> = {}) => ({
  id: `P-${String(++seq).padStart(4, '0')}`,
  memberNumber,
  validYear,
  amount: 30,
  date,
  method: 'transfer' as const,
  reference: '',
  status: 'recorded' as const,
  ...fields,
})

/**
 * Il caso del criterio: 260 soci 2026 (receduti esclusi), 150 dei quali con la quota 2027 entro il 31/3. In più un
 * socio 2026 receduto, chi si iscrive il 20/10/2026 con la quota 2027, e un socio 2026 che paga il 2027 il 1/4/2027.
 */
function fixture() {
  const members: { memberNumber: string; leftOn: string }[] = []
  const payments: DuesPayment[] = []
  for (let n = 1; n <= 260; n++) {
    members.push({ memberNumber: String(n), leftOn: '' })
    payments.push(payment(String(n), 2026, '2026-02-10'))
    if (n <= 150) payments.push(payment(String(n), 2027, n % 2 ? '2027-01-15' : '2027-03-31'))
  }
  // Receduto il 30/6/2026, con la quota 2026 e persino la 2027: non conta da nessuna parte.
  members.push({ memberNumber: '300', leftOn: '2026-06-30' })
  payments.push(payment('300', 2026, '2026-01-20'), payment('300', 2027, '2027-01-05'))
  // Nuovo socio del 20/10/2026: la sua prima quota vale per il 2027, non è un socio 2026.
  members.push({ memberNumber: '301', leftOn: '' })
  payments.push(payment('301', 2027, '2026-10-20'))
  // Socio 2026 che registra la quota 2027 il 1/4/2027: dopo la grazia, non è un rinnovo.
  members.push({ memberNumber: '302', leftOn: '' })
  payments.push(payment('302', 2026, '2026-03-01'), payment('302', 2027, '2027-04-01'))
  return { members, payments }
}

describe('renewals', () => {
  const { members, payments } = fixture()
  const settings = DEFAULT_DUES_SETTINGS

  it.each(['2027-01-01', '2027-02-14', '2027-03-31', '2027-04-30'])(
    'da gennaio ad aprile (%s) conta i rinnovi',
    (today) => {
      // 261 soci 2026 non receduti (i 260 più il 302), 150 rinnovi: il 302 ha pagato dopo il 31/3.
      const result = renewals(members, payments, settings, today)
      expect(result).toEqual({ year: 2027, renewed: 150, base: 261, percent: 57, until: '03-31' })
    },
  )

  it('il caso del criterio, 150 su 260, si legge come «Rinnovi 2027: 150 su 260 (58%)»', () => {
    const without302 = {
      members: members.filter((member) => member.memberNumber !== '302'),
      payments: payments.filter((candidate) => candidate.memberNumber !== '302'),
    }
    const result = renewals(without302.members, without302.payments, settings, '2027-02-01')
    expect(result).toEqual({ year: 2027, renewed: 150, base: 260, percent: 58, until: '03-31' })
    expect(label(result)).toBe('Rinnovi 2027: 150 su 260 (58%) · bersaglio: oltre il 92% al 31/3')
    expect(RENEWAL_TARGET_PERCENT).toBe(92)
  })

  it('un socio 2026 receduto non conta né fra i soci né fra i rinnovi', () => {
    const result = renewals(members, payments, settings, '2027-02-01')
    const withoutLeft = renewals(
      members.filter((member) => member.memberNumber !== '300'),
      payments.filter((candidate) => candidate.memberNumber !== '300'),
      settings,
      '2027-02-01',
    )
    expect(result).toEqual(withoutLeft)
  })

  it('chi si iscrive il 20/10/2026 con la quota 2027 non è un socio 2026 e non conta', () => {
    const only = renewals(
      [{ memberNumber: '301', leftOn: '' }],
      [payment('301', 2027, '2026-10-20')],
      settings,
      '2027-02-01',
    )
    expect(only).toEqual({ year: 2027, renewed: 0, base: 0, percent: 0, until: '03-31' })
  })

  it('un socio 2026 che registra la quota 2027 il 1/4/2027 non è un rinnovo, ma è un socio 2026', () => {
    const only = renewals(
      [{ memberNumber: '302', leftOn: '' }],
      [payment('302', 2026, '2026-03-01'), payment('302', 2027, '2027-04-01')],
      settings,
      '2027-04-10',
    )
    expect(only).toEqual({ year: 2027, renewed: 0, base: 1, percent: 0, until: '03-31' })
  })

  it('una quota 2027 senza data, venuta dal libro soci con la migrazione, è un rinnovo: è stata pagata prima', () => {
    const register = { method: 'register' as const }
    const only = renewals(
      [
        { memberNumber: '1', leftOn: '' },
        { memberNumber: '2', leftOn: '' },
      ],
      [
        payment('1', 2026, '', { id: 'L-2026-0001', ...register }),
        payment('1', 2027, '', { id: 'L-2027-0001', ...register }),
        payment('2', 2026, '', { id: 'L-2026-0002', ...register }),
      ],
      settings,
      '2027-04-10',
    )
    expect(only).toEqual({ year: 2027, renewed: 1, base: 2, percent: 50, until: '03-31' })
  })

  it('una quota «libro soci» scritta a mano senza data non è un rinnovo: si può scrivere anche dopo la grazia', () => {
    const member = [{ memberNumber: '1', leftOn: '' }]
    const before = payment('1', 2026, '', { id: 'L-2026-0001', method: 'register' })
    const renewed = (quota: DuesPayment) => renewals(member, [before, quota], settings, '2027-04-20')?.renewed
    // Senza data conta solo la quota della migrazione, L-<anno>-NNNN: le altre seguono la data.
    expect(renewed(payment('1', 2027, '', { id: 'L-2027-0001', method: 'register' }))).toBe(1)
    expect(renewed(payment('1', 2027, '', { id: 'P-2027-0009', method: 'register' }))).toBe(0)
    expect(renewed(payment('1', 2027, '2027-03-31', { method: 'register' }))).toBe(1)
    expect(renewed(payment('1', 2027, '2027-04-01', { method: 'register' }))).toBe(0)
    for (const status of ['pendingTreasurer', 'cancelled'] as const)
      expect(renewed(payment('1', 2027, '', { id: 'L-2027-0001', method: 'register', status })), status).toBe(0)
  })

  it('un bonifico o dei contanti 2027 senza data non sono un rinnovo: la data può mancare anche dopo la grazia', () => {
    // Per esempio un pagamento della migrazione con la data che non si legge, abbinato al socio il 20/4/2027.
    for (const method of ['transfer', 'cash'] as const) {
      const only = renewals(
        [{ memberNumber: '1', leftOn: '' }],
        [
          payment('1', 2026, '', { id: 'L-2026-0001', method: 'register' }),
          payment('1', 2027, '', { id: 'L-2027-0002', method }),
        ],
        settings,
        '2027-04-20',
      )
      expect(only, method).toEqual({ year: 2027, renewed: 0, base: 1, percent: 0, until: '03-31' })
    }
  })

  it('la grazia segue le impostazioni: con «fine della grazia» al 30/4 il 1/4 è ancora un rinnovo', () => {
    const only = renewals(
      [{ memberNumber: '302', leftOn: '' }],
      [payment('302', 2026, '2026-03-01'), payment('302', 2027, '2027-04-01')],
      { ...settings, graceUntil: '04-30' },
      '2027-04-10',
    )
    expect(only?.renewed).toBe(1)
    expect(label(only)).toBe('Rinnovi 2027: 1 su 1 (100%) · bersaglio: oltre il 92% al 30/4')
  })

  it('una quota 2027 in attesa del tesoriere o annullata non è un rinnovo', () => {
    for (const status of ['pendingTreasurer', 'cancelled'] as const) {
      const only = renewals(
        [{ memberNumber: '1', leftOn: '' }],
        [payment('1', 2026, '2026-03-01'), payment('1', 2027, '2027-01-10', { status })],
        settings,
        '2027-02-01',
      )
      expect(only, status).toEqual({ year: 2027, renewed: 0, base: 1, percent: 0, until: '03-31' })
    }
  })

  it('da maggio a dicembre la riga non c’è', () => {
    for (const today of ['2026-12-31', '2027-05-01', '2027-10-20'])
      expect(renewals(members, payments, settings, today)).toBeNull()
  })
})
