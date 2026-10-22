import { describe, expect, it } from 'vitest'
import {
  deadlineCounts,
  deadlineSignals,
  deadlinesToWatch,
  isDriveUrl,
  lateDutiesDone,
  lateDutiesYears,
  type Deadline,
} from './deadlines.ts'

const today = '2026-10-19'
const deadline = (fields: Partial<Deadline> & { id: string }): Deadline => ({
  what: `Scadenza ${fields.id}`,
  kind: 'duty',
  dueOn: '2026-11-01',
  ownerRole: 'il tesoriere',
  doneOn: null,
  ...fields,
})

describe('deadlineSignals', () => {
  it('conta i giorni che mancano', () => {
    expect(deadlineSignals(deadline({ id: 'a', dueOn: '2026-11-18' }), today).daysLeft).toBe(30)
  })

  it('un adempimento passato e non fatto è in ritardo, da quanti giorni', () => {
    const signals = deadlineSignals(deadline({ id: 'a', dueOn: '2026-10-09' }), today)
    expect(signals.lateByDays).toBe(10)
    expect(signals.expired).toBe(false)
  })

  it.each(['duty', 'tax', 'assembly'] as const)('anche un «%s» è un adempimento', (kind) => {
    expect(deadlineSignals(deadline({ id: 'a', kind, dueOn: '2026-10-18' }), today).lateByDays).toBe(1)
  })

  it('un adempimento con la data di oggi non è in ritardo', () => {
    expect(deadlineSignals(deadline({ id: 'a', dueOn: today }), today).lateByDays).toBeNull()
  })

  it('una scadenza fatta non è in ritardo, anche se la data è passata', () => {
    const signals = deadlineSignals(deadline({ id: 'a', dueOn: '2026-10-01', doneOn: '2026-10-05' }), today)
    expect(signals.lateByDays).toBeNull()
  })

  it.each(['call', 'event'] as const)('un «%s» passato e non fatto è scaduto, non in ritardo', (kind) => {
    const signals = deadlineSignals(deadline({ id: 'a', kind, dueOn: '2026-10-09' }), today)
    expect(signals.expired).toBe(true)
    expect(signals.lateByDays).toBeNull()
  })

  it('una misura passata e non fatta è passata, ma non in ritardo né scaduta', () => {
    const signals = deadlineSignals(deadline({ id: 'a', kind: 'measure', dueOn: '2026-10-09' }), today)
    expect(signals.overdueByDays).toBe(10)
    expect(signals.lateByDays).toBeNull()
    expect(signals.expired).toBe(false)
  })

  it('senza chi la segue, non la segue nessuno', () => {
    expect(deadlineSignals(deadline({ id: 'a', ownerRole: '' }), today).unowned).toBe(true)
    expect(deadlineSignals(deadline({ id: 'a' }), today).unowned).toBe(false)
  })
})

describe('deadlinesToWatch', () => {
  const ids = (deadlines: Deadline[]) => deadlinesToWatch(deadlines, today).map((item) => item.deadline.id)

  it('fra 30 giorni compare; fra 31 giorni no', () => {
    expect(ids([deadline({ id: '30', dueOn: '2026-11-18' }), deadline({ id: '31', dueOn: '2026-11-19' })])).toEqual([
      '30',
    ])
  })

  it('una scadenza fatta non compare', () => {
    expect(ids([deadline({ id: 'fatta', dueOn: '2026-10-25', doneOn: '2026-10-18' })])).toEqual([])
  })

  it('gli adempimenti in ritardo stanno in cima, dal più vecchio; poi le altre, dalla più vicina', () => {
    const list = [
      deadline({ id: 'fra-dieci', dueOn: '2026-10-29' }),
      deadline({ id: 'misura-passata', kind: 'measure', dueOn: '2026-10-15' }),
      deadline({ id: 'ritardo-2', dueOn: '2026-10-17' }),
      deadline({ id: 'domani', kind: 'event', dueOn: '2026-10-20' }),
      deadline({ id: 'ritardo-9', kind: 'tax', dueOn: '2026-10-10' }),
    ]
    expect(ids(list)).toEqual(['ritardo-9', 'ritardo-2', 'misura-passata', 'domani', 'fra-dieci'])
  })

  it('i bandi e gli eventi scaduti escono', () => {
    expect(ids([deadline({ id: 'bando', kind: 'call', dueOn: '2026-10-18' })])).toEqual([])
  })
})

describe('deadlineCounts', () => {
  it('conta le scadenze dei prossimi 30 giorni e quelle senza nessuno', () => {
    const counts = deadlineCounts(
      [
        deadline({ id: 'a', dueOn: '2026-10-20' }),
        deadline({ id: 'b', dueOn: '2026-11-18', ownerRole: '' }),
        deadline({ id: 'c', dueOn: '2026-11-19', ownerRole: '' }),
        deadline({ id: 'in-ritardo', dueOn: '2026-10-10', ownerRole: '' }),
        deadline({ id: 'fatta', dueOn: '2026-10-25', doneOn: '2026-10-18', ownerRole: '' }),
      ],
      today,
    )
    // «c» è fra 31 giorni; quella in ritardo non è fra i prossimi 30 giorni, ma è nella lista e non la segue nessuno.
    expect(counts).toEqual({ next: 2, unowned: 2 })
  })
})

describe('lateDutiesDone', () => {
  it('conta gli adempimenti dell’anno fatti dopo la data', () => {
    const list = [
      deadline({ id: 'tardi', dueOn: '2026-03-31', doneOn: '2026-04-02' }),
      deadline({ id: 'fiscale-tardi', kind: 'tax', dueOn: '2026-06-30', doneOn: '2026-07-01' }),
      deadline({ id: 'in-tempo', dueOn: '2026-03-31', doneOn: '2026-03-31' }),
      deadline({ id: 'evento-tardi', kind: 'event', dueOn: '2026-05-01', doneOn: '2026-05-03' }),
      deadline({ id: 'misura-tardi', kind: 'measure', dueOn: '2026-05-01', doneOn: '2026-05-03' }),
      deadline({ id: 'anno-prima', dueOn: '2025-12-20', doneOn: '2026-01-05' }),
      deadline({ id: 'non-fatta', dueOn: '2026-10-01' }),
    ]
    expect(lateDutiesDone(list, '2026')).toBe(2)
  })
})

describe('lateDutiesYears', () => {
  it('conta l’anno di oggi; a gennaio anche quello prima, che si è appena chiuso', () => {
    expect(lateDutiesYears('2026-10-19')).toEqual(['2026'])
    expect(lateDutiesYears('2027-01-31')).toEqual(['2027', '2026'])
    expect(lateDutiesYears('2027-02-01')).toEqual(['2027'])
  })
})

describe('isDriveUrl', () => {
  it('accetta i link al Drive e ai documenti di Google', () => {
    expect(isDriveUrl('https://drive.google.com/file/d/abc/view')).toBe(true)
    expect(isDriveUrl('https://docs.google.com/document/d/abc/edit')).toBe(true)
  })

  it.each(['http://drive.google.com/file/d/abc', 'https://drive.google.com.example.org/x', 'javascript:alert(1)', 42])(
    'rifiuta %s',
    (value) => {
      expect(isDriveUrl(value)).toBe(false)
    },
  )
})
