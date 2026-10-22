import { describe, expect, it } from 'vitest'
import { daysBetween, freshProjects, isCalendarDate, projectSignals, romeDate, stageStep } from './projects.ts'

describe('isCalendarDate', () => {
  it('accetta un giorno che esiste, anche il 29 febbraio di un anno bisestile', () => {
    expect(isCalendarDate('2026-10-19')).toBe(true)
    expect(isCalendarDate('2028-02-29')).toBe(true)
  })

  it.each(['2026-02-30', '2026-04-31', '2026-02-29', '2026-13-01', '2026-10-1', 'oggi', 20261019])(
    'rifiuta %s',
    (value) => {
      expect(isCalendarDate(value)).toBe(false)
    },
  )
})

describe('romeDate', () => {
  it('dà il giorno di Roma, anche quando in UTC è ancora ieri', () => {
    expect(romeDate(new Date('2026-10-17T22:30:00Z'))).toBe('2026-10-18')
  })

  it('tiene conto dell’ora legale', () => {
    expect(romeDate(new Date('2026-07-01T21:59:00Z'))).toBe('2026-07-01')
    expect(romeDate(new Date('2026-07-01T22:00:00Z'))).toBe('2026-07-02')
  })
})

describe('daysBetween', () => {
  it('conta i giorni di calendario, anche a cavallo del cambio d’ora', () => {
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(30)
    expect(daysBetween('2026-10-18', '2026-10-18')).toBe(0)
    expect(daysBetween('2026-10-18', '2026-10-17')).toBe(-1)
  })
})

describe('stageStep', () => {
  it('dà il passo dei quattro stati di lavoro', () => {
    expect(stageStep('start')).toBe(1)
    expect(stageStep('ongoing')).toBe(2)
    expect(stageStep('review')).toBe(3)
    expect(stageStep('closing')).toBe(4)
  })

  it('un cantiere chiuso non ha passo', () => {
    expect(stageStep('closed')).toBeNull()
  })
})

describe('projectSignals', () => {
  const today = '2026-10-31'
  const project = (updatedOn: string | null, dueOn: string | null = null) => ({ updatedOn, dueOn })

  it('aggiornato 30 giorni fa, il cantiere è fermo da 30 giorni', () => {
    const signals = projectSignals(project('2026-10-01'), today, 30)
    expect(signals.stale).toBe(true)
    expect(signals.daysSinceUpdate).toBe(30)
    expect(signals.needsUpdate).toBe(true)
  })

  it('aggiornato 29 giorni fa, non è fermo', () => {
    const signals = projectSignals(project('2026-10-02'), today, 30)
    expect(signals.stale).toBe(false)
    expect(signals.needsUpdate).toBe(false)
  })

  it('con la scadenza passata da 10 giorni, è in ritardo di 10 giorni', () => {
    const signals = projectSignals(project('2026-10-30', '2026-10-21'), today, 30)
    expect(signals.lateByDays).toBe(10)
    expect(signals.needsUpdate).toBe(true)
  })

  it('con la scadenza oggi, non è in ritardo', () => {
    expect(projectSignals(project('2026-10-30', today), today, 30).lateByDays).toBeNull()
  })

  it('senza scadenza, non è in ritardo', () => {
    expect(projectSignals(project('2026-10-30'), today, 30).lateByDays).toBeNull()
  })

  it('mai aggiornato, è fermo', () => {
    const signals = projectSignals(project(null), today, 30)
    expect(signals.daysSinceUpdate).toBeNull()
    expect(signals.stale).toBe(true)
  })

  it('i giorni per «fermo» vengono dalle impostazioni', () => {
    expect(projectSignals(project('2026-10-11'), today, 20).stale).toBe(true)
  })

  it('una data di aggiornamento nel futuro conta come oggi', () => {
    expect(projectSignals(project('2026-11-02'), today, 30).daysSinceUpdate).toBe(0)
  })
})

describe('freshProjects', () => {
  const today = '2026-10-31'
  const updated = (updatedOn: string | null) => ({ updatedOn })

  it('su 15 cantieri aperti, 12 aggiornati da meno di 30 giorni', () => {
    const projects = [
      ...Array.from({ length: 12 }, () => updated('2026-10-02')),
      updated('2026-10-01'),
      updated('2026-09-01'),
      updated(null),
    ]
    expect(freshProjects(projects, today)).toEqual({ fresh: 12, open: 15, percent: 80 })
  })

  it('vale 30 giorni anche se «fermo» nelle impostazioni è diverso', () => {
    expect(freshProjects([updated('2026-10-11')], today).fresh).toBe(1)
  })

  it('senza cantieri aperti non c’è percentuale', () => {
    expect(freshProjects([], today)).toEqual({ fresh: 0, open: 0, percent: null })
  })

  it('arrotonda la percentuale', () => {
    expect(freshProjects([updated('2026-10-30'), updated('2026-10-30'), updated(null)], today).percent).toBe(67)
  })
})
